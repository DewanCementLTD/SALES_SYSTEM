// Health, readiness and Prometheus metrics (API_SPEC §17, PRD §5 observability).
import fp from 'fastify-plugin';
import { Histogram, Registry, collectDefaultMetrics } from '@prometheus-io/client';

export default fp(async (app) => {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'dcl_api_' });
  const httpDuration = new Histogram({
    name: 'dcl_api_http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.025, 0.05, 0.1, 0.3, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });

  app.addHook('onResponse', async (request, reply) => {
    httpDuration.observe(
      {
        method: request.method,
        route: request.routeOptions.url ?? 'unknown',
        status: String(reply.statusCode),
      },
      reply.elapsedTime / 1000,
    );
  });

  app.get('/health/live', { config: { public: true }, schema: { hide: true } }, async () => ({
    status: 'ok',
  }));

  app.get(
    '/health/ready',
    { config: { public: true }, schema: { hide: true } },
    async (request, reply) => {
      const checks = {};
      try {
        checks.db = (await app.db.ping()) ? 'ok' : 'fail';
      } catch (err) {
        request.log.warn({ err }, 'db not ready');
        checks.db = 'fail';
      }
      if (app.redis) {
        try {
          checks.redis = (await app.redis.ping()) === 'PONG' ? 'ok' : 'fail';
        } catch {
          checks.redis = 'fail';
        }
      }
      const ok = Object.values(checks).every((v) => v === 'ok');
      return reply.status(ok ? 200 : 503).send({ status: ok ? 'ok' : 'fail', checks });
    },
  );

  // Internal network only: block at the reverse proxy (RUNBOOK).
  app.get(
    '/metrics',
    { config: { public: true }, schema: { hide: true } },
    async (request, reply) => {
      reply.type(registry.contentType);
      return registry.metrics();
    },
  );
});
