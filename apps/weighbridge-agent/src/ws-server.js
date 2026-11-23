// Local WebSocket for the weighing screen (ARCHITECTURE §6.4, PRD 4.9): bound to 127.0.0.1 only,
// browser pages only from the allowed origins (the sales web app), so another web site open on the
// weighbridge PC cannot capture weights.
//
// Server → screen:  { type: 'hello', status }  { type: 'reading', kg, stable, motion, online, at,
//                   error? }  { type: 'status', status }  { type: 'captured', requestId, readingId,
//                   deviceId, weightKg, readOn, uploaded }  { type: 'error', requestId?, message }
// Screen → server:  { type: 'capture', requestId }   { type: 'status' }
import { WebSocketServer } from 'ws';

/**
 * @param {import('./agent.js').Agent} agent
 * @param {{ port?: number, host?: string, allowedOrigins?: string[], allowNoOrigin?: boolean,
 *   log?: any }} o
 * @returns {Promise<WebSocketServer>}
 */
export function startWsServer(
  agent,
  { port = 7071, host = '127.0.0.1', allowedOrigins = [], allowNoOrigin = false, log } = {},
) {
  const allowed = new Set(allowedOrigins.map((o) => o.replace(/\/+$/, '')));
  const wss = new WebSocketServer({
    port,
    host,
    maxPayload: 4096,
    verifyClient: ({ origin }) => (origin ? allowed.has(origin) : allowNoOrigin),
  });
  const send = (ws, msg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const broadcast = (msg) => {
    const text = JSON.stringify(msg);
    for (const c of wss.clients) if (c.readyState === c.OPEN) c.send(text);
  };
  const onReading = (r) =>
    broadcast({
      type: 'reading',
      kg: r.kg,
      stable: r.stable,
      motion: r.motion,
      online: r.online,
      at: r.at?.toISOString?.() ?? r.at,
      ...(r.error ? { error: r.error } : {}),
    });
  const onStatus = (s) => broadcast({ type: 'status', status: s });
  agent.on('reading', onReading);
  agent.on('status', onStatus);

  wss.on('connection', (ws) => {
    send(ws, { type: 'hello', status: agent.status() });
    ws.on('message', async (data) => {
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        send(ws, { type: 'error', message: 'Not JSON' });
        return;
      }
      if (msg?.type === 'status') send(ws, { type: 'status', status: agent.status() });
      else if (msg?.type === 'capture') {
        try {
          const r = await agent.capture();
          send(ws, { type: 'captured', requestId: msg.requestId ?? null, ...r });
        } catch (e) {
          send(ws, { type: 'error', requestId: msg.requestId ?? null, message: e.message });
        }
      } else send(ws, { type: 'error', message: `Unknown message ${msg?.type}` });
    });
  });
  wss.on('close', () => {
    agent.off('reading', onReading);
    agent.off('status', onStatus);
  });
  return new Promise((resolve, reject) => {
    wss.once('listening', () => {
      log?.info({ port, host }, 'weighing screen socket listening');
      resolve(wss);
    });
    wss.once('error', reject);
  });
}
