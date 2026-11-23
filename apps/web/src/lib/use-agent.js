'use client';

// Weighbridge agent on this PC (apps/weighbridge-agent, ws://127.0.0.1:7071): live weight, STABLE,
// indicator/API status, and capture → { deviceId, readingId, weightKg, uploaded }. Reconnects
// every 3 s. The agent only accepts pages from its allowedOrigins.
import { useCallback, useEffect, useRef, useState } from 'react';

const URL = process.env.NEXT_PUBLIC_AGENT_WS ?? 'ws://127.0.0.1:7071';

export function useAgent() {
  const ws = useRef(null);
  const pending = useRef(new Map());
  const [state, setState] = useState({
    connected: false,
    kg: null,
    stable: false,
    online: false,
    status: null,
  });

  useEffect(() => {
    let stop = false;
    let retry = null;
    const connect = () => {
      const s = new WebSocket(URL);
      ws.current = s;
      s.onopen = () => setState((x) => ({ ...x, connected: true }));
      s.onclose = () => {
        setState((x) => ({ ...x, connected: false, online: false, stable: false }));
        for (const p of pending.current.values()) p.reject(new Error('Agent disconnected'));
        pending.current.clear();
        if (!stop) retry = setTimeout(connect, 3000);
      };
      s.onerror = () => {};
      s.onmessage = (e) => {
        let m;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        if (m.type === 'reading')
          setState((x) => ({ ...x, kg: m.kg, stable: m.stable, online: m.online, error: m.error }));
        else if (m.type === 'hello' || m.type === 'status')
          setState((x) => ({
            ...x,
            status: m.status,
            online: m.status?.indicatorOnline ?? x.online,
          }));
        else if ((m.type === 'captured' || m.type === 'error') && m.requestId) {
          const p = pending.current.get(m.requestId);
          if (p) {
            pending.current.delete(m.requestId);
            if (m.type === 'captured') p.resolve(m);
            else p.reject(new Error(m.message));
          }
        }
      };
    };
    connect();
    return () => {
      stop = true;
      clearTimeout(retry);
      ws.current?.close();
    };
  }, []);

  /** Ask the agent for the current stable weight (signed and uploaded by the agent). */
  const capture = useCallback(
    () =>
      new Promise((resolve, reject) => {
        const s = ws.current;
        if (!s || s.readyState !== WebSocket.OPEN) {
          reject(new Error('The weighbridge agent is not running on this PC'));
          return;
        }
        const requestId = crypto.randomUUID();
        pending.current.set(requestId, { resolve, reject });
        s.send(JSON.stringify({ type: 'capture', requestId }));
        setTimeout(() => {
          if (pending.current.delete(requestId)) reject(new Error('The agent did not answer'));
        }, 10000);
      }),
    [],
  );

  return { ...state, capture };
}
