const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

function mountCall(type = 'call', buffered = []) {
    const effects = [];
    const added = [];
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
        '@chakra-ui/react': { useToast: () => () => {} },
        '../../recoil/atom': { websocketstate: 'socket', user: 'user' },
        recoil: { useRecoilValue: atom => atom === 'socket' ? websocket : { name: 'Test' } },
        './Calling': {},
        './LiveCall': {},
        'react-router-dom': {
            useLocation: () => ({ state: { type, userId: 'sender', offer: { type: 'offer' }, icecandidate: buffered } }),
            useNavigate: () => () => {},
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
        clearInterval() {},
    };
    vm.runInNewContext(outputText, context);
    context.exports.default();
    // Install the call's signaling and ICE handlers without accessing a camera.
    effects[3]();
    return {
        peer, added, effects,
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
