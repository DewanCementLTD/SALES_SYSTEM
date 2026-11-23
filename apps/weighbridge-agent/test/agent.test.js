// Agent end to end with a fake indicator and a fake API: live readings over the local socket,
// capture signs a stable weight, upload retried while the API is down, origin allow-list.
import { readingText, verifyDeviceSignature } from '@dcl/shared';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { Agent } from '../src/agent.js';
import { ApiClient } from '../src/api-client.js';
import { AgentStore } from '../src/store.js';
import { startWsServer } from '../src/ws-server.js';

const SECRET = 'agent-test-secret-000000000001';
const ORIGIN = 'http://localhost:3200';
let cleanup = [];
afterEach(async () => {
  for (const f of cleanup.reverse()) await f();
  cleanup = [];
});

function fakeSource() {
  const s = {
    name: 'test',
    push: null,
    start(onData) {
      s.push = onData;
    },
    stop() {},
  };
  return s;
}

async function setup({ apiDown = false } = {}) {
  const uploads = [];
  const api = {
    down: apiDown,
    async uploadReading(body) {
      if (this.down) throw new Error('fetch failed');
      uploads.push(body);
      return { ok: true };
    },
  };
  const store = new AgentStore(':memory:');
  const source = fakeSource();
  const agent = new Agent(
    {
      deviceId: 'KHI-WB-01',
      secret: SECRET,
      parser: 'st-gs',
      source: { type: 'simulator' },
      retryMs: 60000,
    },
    { api, store, source },
  );
  agent.start();
  const wss = await startWsServer(agent, { port: 0, allowedOrigins: [ORIGIN] });
  cleanup.push(
    () => store.close(),
    () => agent.stop(),
    () => new Promise((r) => wss.close(r)),
  );
  return { agent, api, uploads, source, port: wss.address().port };
}

function connect(port, origin = ORIGIN) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin });
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    inbox.push(m);
    for (const w of [...waiters]) {
      if (w.pred(m)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(m);
      }
    }
  });
  ws.on('error', () => {});
  const next = (pred) =>
    new Promise((resolve) => {
      const found = inbox.find(pred);
      if (found) resolve(found);
      else waiters.push({ pred, resolve });
    });
  cleanup.push(() => ws.terminate());
  const open = new Promise((res, rej) => {
    ws.once('open', res);
    ws.once('unexpected-response', (_req, r) => rej(new Error(`HTTP ${r.statusCode}`)));
    ws.once('error', rej);
  });
  return { ws, next, open };
}
const settle = (source, kg) => {
  for (let i = 0; i < 5; i += 1)
    source.push(`ST,GS,+${String(kg + (i % 2)).padStart(7, '0')}kg\r\n`);
};

describe('weighbridge agent (P3-02)', () => {
  it('BR-WGT-01: live readings to the screen; capture signs the stable weight and uploads it', async () => {
    const { source, uploads, port } = await setup();
    const c = connect(port);
    await c.open;
    expect((await c.next((m) => m.type === 'hello')).status.deviceId).toBe('KHI-WB-01');
    source.push('US,GS,+0020000kg\r\n');
    expect(await c.next((m) => m.type === 'reading')).toMatchObject({ kg: 20000, stable: false });
    c.ws.send(JSON.stringify({ type: 'capture', requestId: 'q1' }));
    expect(await c.next((m) => m.type === 'error' && m.requestId === 'q1')).toMatchObject({
      message: expect.stringMatching(/not stable/),
    });
    settle(source, 41250);
    await c.next((m) => m.type === 'reading' && m.stable);
    c.ws.send(JSON.stringify({ type: 'capture', requestId: 'q2' }));
    const cap = await c.next((m) => m.type === 'captured');
    expect(cap).toMatchObject({
      requestId: 'q2',
      deviceId: 'KHI-WB-01',
      weightKg: 41250,
      uploaded: true,
    });
    expect(uploads).toHaveLength(1);
    const { signature, ...signedPart } = uploads[0];
    expect(await verifyDeviceSignature(SECRET, readingText(signedPart), signature)).toBe(true);
  });

  it('API down: the capture is kept and uploaded on the next try', async () => {
    const { agent, api, source, uploads, port } = await setup({ apiDown: true });
    const c = connect(port);
    await c.open;
    settle(source, 15020);
    await c.next((m) => m.type === 'reading' && m.stable);
    c.ws.send(JSON.stringify({ type: 'capture', requestId: 'q1' }));
    expect(await c.next((m) => m.type === 'captured')).toMatchObject({ uploaded: false });
    expect(agent.status()).toMatchObject({ apiOnline: false, pending: 1 });
    api.down = false;
    await agent.flush();
    expect(uploads).toHaveLength(1);
    expect(agent.status()).toMatchObject({ apiOnline: true, pending: 0 });
  });

  it('pages from other origins cannot connect', async () => {
    const { port } = await setup();
    const c = connect(port, 'https://evil.example');
    await expect(c.open).rejects.toThrow(/401/);
  });
});

describe('API client', () => {
  it('signs in, uploads with the token, signs in again after a 401', async () => {
    const calls = [];
    let tokenNo = 0;
    let first = true;
    const fetch = async (url, init) => {
      calls.push([init.method, url.replace('http://api', ''), init.headers.authorization ?? null]);
      if (url.endsWith('/devices/token')) {
        tokenNo += 1;
        return new Response(JSON.stringify({ token: `t${tokenNo}`, expiresIn: 43200 }), {
          status: 200,
        });
      }
      if (first) {
        first = false;
        return new Response(JSON.stringify({ detail: 'expired' }), { status: 401 });
      }
      return new Response(JSON.stringify({ duplicate: false }), { status: 201 });
    };
    const c = new ApiClient({
      apiUrl: 'http://api/',
      deviceId: 'KHI-WB-01',
      secret: SECRET,
      fetch,
    });
    expect(await c.uploadReading({ readingId: 'r1' })).toEqual({ ok: true, duplicate: false });
    expect(calls).toEqual([
      ['POST', '/api/v1/devices/token', null],
      ['POST', '/api/v1/plant/weigh-readings', 'Bearer t1'],
      ['POST', '/api/v1/devices/token', null],
      ['POST', '/api/v1/plant/weigh-readings', 'Bearer t2'],
    ]);
  });
});
