const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

// Run the actual route effect with controlled sockets and timers, without a browser.
function mountAuth(loggedIn = true) {
    const sockets = [];
    const timers = new Map();
    const effects = [];
    let currentSocket = null;
    let nextTimer = 0;
    class Socket {
        constructor(url) {
            this.url = url;
            sockets.push(this);
        }
        close() {
            this.closed = true;
            this.onclose?.({ code: 1000 });
        }
    }
    const modules = {
        react: { useEffect: effect => effects.push(effect) },
        'react/jsx-runtime': { jsx: () => null },
        '@chakra-ui/react': { useToast: () => () => {} },
        'react-router-dom': {},
        recoil: {
            useRecoilValue: atom => atom === 'logined' ? loggedIn : 'wss://peerlink.example',
            useSetRecoilState: () => socket => { currentSocket = socket; },
        },
        '../../recoil/atom': { logined: 'logined', wsURL: 'wsURL', websocketstate: 'socket' },
    };
    const source = fs.readFileSync(path.join(__dirname, '../src/component/Auth/Auth.tsx'), 'utf8');
    const { outputText } = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    });
    const context = {
        exports: {},
        require: name => {
            assert.ok(name in modules, `Unexpected import: ${name}`);
            return modules[name];
        },
        WebSocket: Socket,
        setTimeout: (callback, delay) => {
            const id = ++nextTimer;
            timers.set(id, { callback, delay });
            return id;
        },
        clearTimeout: id => timers.delete(id),
    };
    vm.runInNewContext(outputText, context);
    context.exports.default();
    const cleanup = effects[0]();
    return {
        sockets, timers, cleanup,
        currentSocket: () => currentSocket,
        retry: () => {
            assert.equal(timers.size, 1);
            const [id, timer] = timers.entries().next().value;
            timers.delete(id);
            timer.callback();
            return timer.delay;
        },
    };
}

test('retries failed connections with capped backoff and resets after reconnection', () => {
    const app = mountAuth();
    assert.equal(app.sockets[0].url, 'wss://peerlink.example');
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
        app.sockets.at(-1).onclose({ code: 1006 });
        assert.equal(app.retry(), delay);
    }
    const connected = app.sockets.at(-1);
    connected.onopen();
    assert.equal(app.currentSocket(), connected);
    connected.onclose({ code: 1012 });
    assert.equal(app.currentSocket(), null);
    assert.equal(app.retry(), 1000);
    app.cleanup();
});

test('unmount cancels retries and ignores late socket events', () => {
    const app = mountAuth();
    const socket = app.sockets[0];
    socket.onclose({ code: 1006 });
    app.cleanup();
    socket.onopen();
    socket.onclose({ code: 1006 });
    assert.equal(socket.closed, true);
    assert.equal(app.timers.size, 0);
    assert.equal(app.currentSocket(), null);
    assert.equal(app.sockets.length, 1);
});

test('normal server closure does not create competing connections', () => {
    const app = mountAuth();
    app.sockets[0].onopen();
    app.sockets[0].onclose({ code: 1000 });
    assert.equal(app.currentSocket(), null);
    assert.equal(app.timers.size, 0);
    app.cleanup();
});

test('unauthenticated routes do not open a socket', () => {
    const app = mountAuth(false);
    assert.equal(app.sockets.length, 0);
    assert.equal(app.cleanup, undefined);
});
