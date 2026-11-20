// Server-Sent Events hub (ADR-9): GET /api/v1/events?channels=approvals,notifications
// Messages are branch-scoped: a client only receives events of branches it may see (BR-BR-04),
// and user-targeted events only for its own user id. In-process hub (single API instance);
// a Redis pub/sub bridge is needed before running several API instances.
import fp from 'fastify-plugin';

export const SSE_CHANNELS = Object.freeze([
  'plant.board',
  'approvals',
  'notifications',
  'dashboard.sales',
  'dashboard.plant',
  'dashboard.management',
]);

export class SseHub {
  constructor() {
    /** @type {Set<{ send: (ev: string, data: unknown) => void, channels: Set<string>, branches: number[], userId: number }>} */
    this.clients = new Set();
  }

  /**
   * @param {string} channel
   * @param {{ brnch?: number|null, userId?: number|null }} scope
   * @param {unknown} data
   */
  publish(channel, scope, data) {
    for (const c of this.clients) {
      if (!c.channels.has(channel)) continue;
      if (scope.userId && scope.userId !== c.userId) continue;
      if (scope.brnch && !c.branches.includes(scope.brnch)) continue;
      c.send(channel, data);
    }
  }

  get size() {
    return this.clients.size;
  }
}

export default fp(async (app) => {
  const hub = new SseHub();
  app.decorate('sse', hub);

  app.get(
    '/api/v1/events',
    { config: { allowMustChange: false }, schema: { hide: true } },
    async (request, reply) => {
      const wanted = String(request.query?.channels ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => SSE_CHANNELS.includes(s));
      const branches = await request.authz.allowedBranches();
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      const client = {
        channels: new Set(wanted),
        branches,
        userId: request.session.userId,
        send: (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`),
      };
      hub.clients.add(client);
      res.write(`event: ready\ndata: ${JSON.stringify({ channels: wanted })}\n\n`);
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      request.raw.on('close', () => {
        clearInterval(ping);
        hub.clients.delete(client);
      });
    },
  );
});
