const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const test = require('node:test');
const WebSocket = require('ws');

process.env.SECRET_KEY = 'peerlink-isolated-test-secret';
require('ts-node/register/transpile-only');
const { createToken } = require('../src/utils/jwt');
const { WS_SERVER, userSocket } = require('../src/ws/ws');

async function startServer(t) {
  const server = http.createServer();
  const clients = [];
  WS_SERVER(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  t.after(async () => {
    clients.forEach(client => client.terminate());
    await new Promise(resolve => server.close(resolve));
    userSocket.clear();
  });

  return async (id) => {
    const client = new WebSocket(`ws://127.0.0.1:${server.address().port}`, {
      headers: id ? { Cookie: `token=${createToken(id)}` } : {},
    });
    clients.push(client);
    await once(client, 'open');
    return client;
  };
}

test('relays call messages with the authenticated sender identity', { timeout: 5000 }, async (t) => {
  const connect = await startServer(t);
  const sender = await connect('sender');
  const receiver = await connect('receiver');

  for (const payload of [
    { type: 'offer', offer: { type: 'offer', sdp: 'test' }, name: 'Sender' },
    { type: 'answer', answer: { type: 'answer', sdp: 'test' } },
    { type: 'ICEcandidate', candidate: { candidate: 'test' } },
    { type: 'call-rejected' },
    { type: 'call-ended' },
  ]) {
    const message = once(receiver, 'message', { signal: AbortSignal.timeout(2000) });
    sender.send(JSON.stringify({ ...payload, userId: 'receiver' }));
    const [data] = await message;
    assert.deepEqual(JSON.parse(data.toString()), { ...payload, userId: 'sender' });
  }
});

test('keeps a replacement connection reachable after the old socket closes', { timeout: 5000 }, async (t) => {
  const connect = await startServer(t);
  const sender = await connect('sender');
  await connect('receiver');
  const oldClosed = once(userSocket.get('receiver'), 'close');
  const receiver = await connect('receiver');
  await oldClosed;

  const message = Promise.race([
    once(receiver, 'message', { signal: AbortSignal.timeout(2000) }),
    once(sender, 'message', { signal: AbortSignal.timeout(2000) }),
  ]);
  sender.send(JSON.stringify({ type: 'offer', userId: 'receiver', offer: 'test', name: 'Sender' }));
  const [data] = await message;
  assert.equal(JSON.parse(data.toString()).type, 'offer');
});

test('ignores malformed messages and continues serving valid signaling', { timeout: 5000 }, async (t) => {
  const connect = await startServer(t);
  const sender = await connect('sender');
  const receiver = await connect('receiver');
  for (const message of ['{', 'null', '[]', '42', '{}', '{"type":"offer","userId":42}']) {
    sender.send(message);
  }
  const message = once(receiver, 'message', { signal: AbortSignal.timeout(2000) });
  sender.send(JSON.stringify({ type: 'call-ended', userId: 'receiver' }));
  const [data] = await message;
  assert.deepEqual(JSON.parse(data.toString()), { type: 'call-ended', userId: 'sender' });
});
