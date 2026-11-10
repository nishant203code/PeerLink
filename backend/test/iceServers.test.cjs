const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const test = require('node:test');
const express = require('express');
const cookieParser = require('cookie-parser');

process.env.SECRET_KEY = 'peerlink-turn-test-secret';
require('ts-node/register/transpile-only');
const { createToken } = require('../src/utils/jwt');
const iceServers = require('../src/routes/iceServers').default;

const temporaryCredentials = {
    iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478'] },
        {
            urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'],
            username: 'temporary-user',
            credential: 'temporary-password',
        },
    ],
};
let server;

test.before(async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/ice-servers', iceServers);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
});

test.after(async () => {
    await new Promise(resolve => server.close(resolve));
});

test.beforeEach(() => {
    process.env.CLOUDFLARE_TURN_KEY_ID = 'test-turn-key';
    process.env.CLOUDFLARE_TURN_API_TOKEN = 'private-test-api-token';
});

function request(cookie = `token=${createToken('test-user')}`) {
    return new Promise((resolve, reject) => {
        const req = http.get({
            hostname: '127.0.0.1', port: server.address().port, path: '/api/ice-servers',
            headers: cookie ? { Cookie: cookie } : {}, signal: AbortSignal.timeout(3000),
        }, res => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        });
        req.on('error', reject);
    });
}

test('rejects unauthenticated credential requests before contacting Cloudflare', async t => {
    const fetch = t.mock.method(global, 'fetch', async () => { throw Error('Unexpected provider call'); });
    const response = await request('');
    assert.equal(response.status, 401);
    assert.equal(fetch.mock.callCount(), 0);
});

test('returns temporary ICE credentials without exposing the provider token', async t => {
    t.mock.method(global, 'fetch', async (url, options) => {
        assert.equal(url, 'https://rtc.live.cloudflare.com/v1/turn/keys/test-turn-key/credentials/generate-ice-servers');
        assert.equal(options.method, 'POST');
        assert.equal(options.headers.Authorization, 'Bearer private-test-api-token');
        assert.deepEqual(JSON.parse(options.body), { ttl: 86400 });
        assert.ok(options.signal instanceof AbortSignal);
        return new Response(JSON.stringify({ ...temporaryCredentials, internal: 'private-test-api-token' }), { status: 201 });
    });
    const response = await request();
    assert.equal(response.status, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(JSON.parse(response.body), temporaryCredentials);
    assert.equal(response.body.includes('private-test-api-token'), false);
});

test('preserves STUN-only development when neither TURN variable is set', async t => {
    delete process.env.CLOUDFLARE_TURN_KEY_ID;
    delete process.env.CLOUDFLARE_TURN_API_TOKEN;
    const fetch = t.mock.method(global, 'fetch', async () => { throw Error('Unexpected provider call'); });
    const response = await request();
    assert.equal(response.status, 200);
    assert.ok(JSON.parse(response.body).iceServers.every(server => server.urls.every(url => url.startsWith('stun:'))));
    assert.equal(fetch.mock.callCount(), 0);
});

test('rejects incomplete TURN configuration', async t => {
    delete process.env.CLOUDFLARE_TURN_API_TOKEN;
    t.mock.method(console, 'error', () => {});
    const fetch = t.mock.method(global, 'fetch', async () => { throw Error('Unexpected provider call'); });
    const response = await request();
    assert.equal(response.status, 503);
    assert.equal(fetch.mock.callCount(), 0);
});

test('handles provider errors without returning or logging credentials', async t => {
    const log = t.mock.method(console, 'error', () => {});
    t.mock.method(global, 'fetch', async () => new Response('private-test-api-token', { status: 401 }));
    const response = await request();
    assert.equal(response.status, 502);
    assert.equal(response.body.includes('private-test-api-token'), false);
    assert.equal(JSON.stringify(log.mock.calls).includes('private-test-api-token'), false);
});

test('handles a provider timeout with a safe error response', async t => {
    const log = t.mock.method(console, 'error', () => {});
    t.mock.method(global, 'fetch', async () => { throw new DOMException('private-test-api-token', 'TimeoutError'); });
    const response = await request();
    assert.equal(response.status, 502);
    assert.equal(response.body.includes('private-test-api-token'), false);
    assert.equal(JSON.stringify(log.mock.calls).includes('private-test-api-token'), false);
});

test('rejects a successful provider response that has no usable TURN credentials', async t => {
    t.mock.method(console, 'error', () => {});
    t.mock.method(global, 'fetch', async () => new Response(JSON.stringify({
        iceServers: [{ urls: ['turn:turn.cloudflare.com:3478'] }],
    }), { status: 201 }));
    const response = await request();
    assert.equal(response.status, 502);
});
