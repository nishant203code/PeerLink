const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

function mountCall(type = 'call', buffered = [], options = {}) {
    const effects = [];
    const added = [];
    const requests = [];
    const connections = [];
    const toasts = [];
    const redirects = [];
    const websocket = { send() {} };
    const peer = {
        remoteDescription: null,
        addTrack() {},
        async setRemoteDescription(description) { this.remoteDescription = description; },
        async createAnswer() { return { type: 'answer' }; },
        async setLocalDescription() {},
        async addIceCandidate(candidate) {
            assert.ok(this.remoteDescription, 'Remote description must be ready before adding ICE');
            added.push(candidate);
        },
    };
    const states = [peer, { getTracks: () => [] }, 0];
    let stateIndex = 0;
    const modules = {
        react: {
            useState: () => [states[stateIndex++], () => {}],
            useRef: value => ({ current: value }),
            useEffect: effect => effects.push(effect),
        },
        'react/jsx-runtime': { jsx: () => null, jsxs: () => null },
        '@chakra-ui/react': { useToast: () => toast => toasts.push(toast) },
        '../../recoil/atom': { websocketstate: 'socket', user: 'user', apiURL: 'api' },
        recoil: { useRecoilValue: atom => atom === 'socket' ? websocket : atom === 'api' ? '' : { name: 'Test' } },
        axios: { default: {
            get: (url, config) => {
                requests.push({ url, config });
                return options.getIceServers ? options.getIceServers() : Promise.resolve({ data: { iceServers: [] } });
            },
        } },
        './Calling': {},
        './LiveCall': {},
        'react-router-dom': {
            useLocation: () => ({ state: { type, userId: 'sender', offer: { type: 'offer' }, icecandidate: buffered } }),
            useNavigate: () => url => redirects.push(url),
        },
    };
    const source = fs.readFileSync(path.join(__dirname, '../src/component/VideoCall/videocall.tsx'), 'utf8');
    const { outputText } = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    });
    const context = {
        exports: {},
        require: name => {
            assert.ok(name in modules, `Unexpected import: ${name}`);
            return modules[name];
        },
        RTCIceCandidate: class { constructor(candidate) { Object.assign(this, candidate); } },
        RTCPeerConnection: class {
            constructor(config) {
                this.config = config;
                connections.push(this);
            }
            close() { this.closed = true; }
        },
        AbortController,
        clearInterval() {},
    };
    vm.runInNewContext(outputText, context);
    context.exports.default();
    // Install the call's signaling and ICE handlers without accessing a camera.
    effects[3]();
    return {
        peer, added, effects, requests, connections, toasts, redirects,
        message: data => websocket.onmessage({ data: JSON.stringify(data) }),
    };
}

test('buffers caller candidates until the remote answer is applied', async () => {
    const call = mountCall();
    await call.message({ type: 'ICEcandidate', candidate: { candidate: 'early' } });
    assert.equal(call.added.length, 0);
    await call.message({ type: 'answer', answer: { type: 'answer' } });
    assert.deepEqual(call.added.map(candidate => candidate.candidate), ['early']);
    await call.message({ type: 'ICEcandidate', candidate: { candidate: 'late' } });
    assert.deepEqual(call.added.map(candidate => candidate.candidate), ['early', 'late']);
});

test('applies candidates received on the dashboard after accepting the offer', async () => {
    const call = mountCall('offer', [{ candidate: 'dashboard' }]);
    call.effects[4]();
    assert.equal(call.added.length, 0);
    call.effects[0]();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(call.added.map(candidate => candidate.candidate), ['dashboard']);
    call.effects[4]();
    assert.equal(call.added.length, 1);
});

test('buffers candidates while setting the remote description is still pending', async () => {
    const call = mountCall();
    let finishDescription;
    call.peer.setRemoteDescription = description => new Promise(resolve => {
        finishDescription = () => {
            call.peer.remoteDescription = description;
            resolve();
        };
    });
    const answer = call.message({ type: 'answer', answer: { type: 'answer' } });
    await call.message({ type: 'ICEcandidate', candidate: { candidate: 'during-answer' } });
    assert.equal(call.added.length, 0);
    finishDescription();
    await answer;
    assert.deepEqual(call.added.map(candidate => candidate.candidate), ['during-answer']);
});

test('loads authenticated TURN credentials before creating a peer connection', async () => {
    const iceServers = [{ urls: ['turns:turn.example.com:443'], username: 'temporary', credential: 'temporary' }];
    const call = mountCall('call', [], { getIceServers: async () => ({ data: { iceServers } }) });
    const cleanup = call.effects[2]();
    assert.equal(call.connections.length, 0);
    assert.equal(call.requests[0].url, '/api/ice-servers');
    assert.equal(call.requests[0].config.withCredentials, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(call.connections.length, 1);
    assert.equal(call.connections[0].config.iceServers, iceServers);
    cleanup();
    assert.equal(call.connections[0].closed, true);
    assert.equal(call.requests[0].config.signal.aborted, true);
});

test('shows a call setup error when credentials cannot be loaded', async () => {
    const call = mountCall('call', [], { getIceServers: async () => { throw Error('Provider unavailable'); } });
    const cleanup = call.effects[2]();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(call.connections.length, 0);
    assert.equal(call.toasts[0].status, 'error');
    assert.deepEqual(call.redirects, ['/dashboard']);
    cleanup();
});

test('does not create a connection if the user leaves while credentials are loading', async () => {
    let resolveRequest;
    const call = mountCall('call', [], { getIceServers: () => new Promise(resolve => { resolveRequest = resolve; }) });
    const cleanup = call.effects[2]();
    cleanup();
    resolveRequest({ data: { iceServers: [] } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(call.connections.length, 0);
    assert.equal(call.toasts.length, 0);
    assert.equal(call.requests[0].config.signal.aborted, true);
});
