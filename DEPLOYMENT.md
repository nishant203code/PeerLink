# PeerLink deployment: one Render Docker service

## Status and scope

Local preparation is complete. No Render service has been created, no Git push
has been made by the assistant, and nothing has been deployed.
Docker image execution and live browser/media verification remain outstanding.

The approved target is one Docker Web Service serving the existing React build,
Express API, and WebSocket signaling on one HTTPS `.onrender.com` origin. No
separate Static Site or custom domain is required. The UI and `SameSite=Lax`,
HttpOnly, Secure cookie settings are preserved.

## Changes

- `dockerfile`: builds both projects from source with lockfile-based `npm ci`,
  uses Node 24, copies only compiled output into the runtime image, installs
  production backend dependencies, and runs as the existing `node` image user.
- `.dockerignore`: excludes dependency directories, previous builds, environment
  files, logs, TypeScript build metadata, and Git history from the build context.
- `build.bat`: builds from the repository directory using the explicit lowercase
  Dockerfile path and returns failure if Docker fails. The image builds both apps.
- `Auth.tsx`: owns the socket across dashboard/call navigation, retries abnormal
  closure with delays from 1 to 30 seconds, resets delay after connection, and
  cancels the socket/timer on unmount. Normal server closure is not retried, avoiding
  retry loops for rejected credentials or replacement by another tab.
- `MainDashboard.tsx`: consumes the shared socket without owning its connection.
- `atom.ts`: retains the current host port when forming same-origin WS URLs.
- `frontend/test/websocket.test.cjs`: tests the real Auth effect with controlled
  sockets and timers using Node's test runner and the existing TypeScript package.

## Local verification commands

Run from the repository root, stopping on any failed command:

```powershell
npm --prefix backend test
node --test frontend/test/websocket.test.cjs
npm --prefix backend run build
npm --prefix frontend run build
```

Results: all three backend signaling tests and four frontend lifecycle tests pass;
both production builds pass on local Node 24.22.1. Changed-file lint reports no new
findings compared with HEAD: Auth and atom pass; MainDashboard retains seven existing
errors and one warning. Existing frontend bundle-size and Browserslist warnings remain.
The lifecycle tests are isolated effect tests, not full React/browser integration tests.

The updated compiled application also passed HTTP checks on temporary port 3002:
home, registration, dashboard, and referenced assets; two approved test-account
logins; authenticated profile/contacts requests; and authenticated WebSocket
connections. The temporary server was stopped after verification. A scan of 72
build artifacts found no matches for the configured database URI or signing secret.
These checks do not verify HTTPS cookies or actual audio/video in a browser.

## Required image verification

Docker is not installed on the current machine; these commands have NOT been run.
Run them where Docker is available before authorizing deployment:

```powershell
docker build -f dockerfile -t peerlink .
docker run --rm --name peerlink-check --env-file backend/.env --env PORT=3000 --env CLIENT_ORIGIN=http://localhost:3001 -p 3001:3000 peerlink
```

Use only the approved test database in that environment file. Visit
`http://localhost:3001`, verify login, contacts, navigation, and signaling, then
stop the foreground container with Ctrl+C. Do not upload the environment file.
The test server's HTTP `/health` response does not establish database readiness.

## Render settings (apply only after deployment approval)

Connect the existing GitHub repository through Render's GitHub integration.
Create one Web Service with:

| Setting | Value |
| --- | --- |
| Branch | `main` |
| Language/runtime | Docker |
| Root directory | repository root (leave blank) |
| Dockerfile path | `./dockerfile` |
| Docker build context | `.` |
| Docker command | leave blank; use the image CMD |
| Health check path | `/health` |
| Instance count | one; signaling uses an in-memory connection map |
| Auto-Deploy | On Commit, once deployment is authorized |

Select an instance plan explicitly before creating the service; no paid plan has
been authorized. Service creation can trigger the initial build/deployment.
Render's TLS endpoint serves the frontend, `/api`, and WebSocket upgrades together.
The existing Express SPA fallback handles client routes; no static-site rewrite is needed.

Set private runtime variables in Render:

| Variable | Value |
| --- | --- |
| `DATABASE` | approved production MongoDB URI |
| `SECRET_KEY` | strong production JWT signing secret |
| `CLIENT_ORIGIN` | exact assigned `https://<service>.onrender.com` origin, no trailing slash |
| `NODE_ENV` | `production` (also set by the image) |
| `PORT` | use Render's provided value; the server already honors it |

Do not set `VITE_API_URL` or `VITE_WS_URL`: the build defaults to relative API
requests and the current host with `wss` under HTTPS. Runtime variables do not
rewrite Vite assets. Never put database credentials or signing secrets in Vite
variables. Ensure MongoDB permits connections from the Render service and use a
least-privilege database user. No production data or secrets have been changed.

## Release and rollback procedure

1. Review the diff, complete Docker verification, and approve the verified release.
2. Stage and commit only with the user's explicit authorization. The user pushes
   the selected commits to `main` manually.
3. Separate authorization is required before creating/deploying the Render service:
   "Approved. Deploy the verified version."
4. Apply the settings above, confirm the deployed commit, and inspect build/runtime
   logs without exposing secrets. Verify the assigned HTTPS URL and database login.
5. Test two independent authenticated browsers: contacts, offer/answer, ICE exchange,
   audio/video, hangup, and recovery of signaling after a controlled service restart.
6. Confirm On Commit auto-deploy. Subsequent user pushes to `main` trigger releases;
   the assistant does not push on the user's behalf.
7. If a release fails verification, disable auto-deploy and use Render's rollback
   control for a previously verified deploy. There is no prior deploy to roll back
   to for the first release. Do not reset Git or modify database data to roll back.

## Remaining limitations

- No live URL, production credentials, selected instance plan, or live verification yet.
- Docker's Linux runtime and image build are untested locally despite passing Node builds.
- Browser/screen access was stopped at the user's request. No new screen inspection
  or complete two-browser media test was performed during this stage.
- Reconnecting signaling does not automatically restore an interrupted WebRTC call.
- STUN-only calls can fail on restrictive networks; TURN infrastructure needs separate approval.
- Existing unrelated lint findings and dashboard duplicate-key warnings remain.
- `/health` is a liveness check only, not a MongoDB readiness check.

## References

- [Render Docker builds](https://render.com/docs/docker)
- [Render automatic deploys](https://render.com/docs/deploys)
- [Render WebSockets](https://render.com/docs/websocket)
- [Node.js supported releases](https://nodejs.org/en/about/previous-releases)
