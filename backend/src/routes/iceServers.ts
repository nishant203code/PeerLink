import express from 'express';
import z from 'zod';
import jwtMiddleware from '../middleware/jwtMiddleware';

const router = express.Router();

const iceServerSchema = z.object({
    urls: z.array(z.string().regex(/^(stun|stuns|turn|turns):/)).nonempty(),
    username: z.string().optional(),
    credential: z.string().optional(),
});

const credentialsSchema = z.object({
    iceServers: z.array(iceServerSchema).nonempty().refine(servers =>
        servers.some(server => server.username && server.credential &&
            server.urls.some(url => /^turns?:/.test(url)))
    ),
});

router.get('/', jwtMiddleware, async(req, res) => {
    res.set('Cache-Control', 'no-store');
    const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
    const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;

    // Preserve local STUN-only calls until TURN is configured.
    if (!keyId && !apiToken) {
        res.json({ iceServers: [
            { urls: ['stun:stun1.l.google.com:19302'] },
            { urls: ['stun:stun2.l.google.com:19302'] },
        ] });
        return;
    }

    if (!keyId || !apiToken) {
        console.error('Both Cloudflare TURN environment variables are required');
        res.status(503).json({ message: 'Calling is temporarily unavailable. Please try again later.' });
        return;
    }

    try {
        const response = await fetch(
            `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
            {
                method: 'POST',
                headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ttl: 86400 }),
                signal: AbortSignal.timeout(10000),
            }
        );

        if (!response.ok) {
            console.error('Cloudflare TURN credential request failed with status:', response.status);
            res.status(502).json({ message: 'Calling is temporarily unavailable. Please try again later.' });
            return;
        }

        const credentials = credentialsSchema.parse(await response.json());
        res.json(credentials);
    } catch (error) {
        // Provider errors can contain credentials; log only the error category.
        console.error('Cloudflare TURN credential request failed:', error instanceof Error ? error.name : 'UnknownError');
        res.status(502).json({ message: 'Calling is temporarily unavailable. Please try again later.' });
    }
});

export default router;
