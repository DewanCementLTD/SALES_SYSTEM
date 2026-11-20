// Fastify application (TASKS P0-06). Routes do HTTP only; services hold rules; repos hold SQL.
import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { systemClock } from '@dcl/shared';
import authPlugin from './plugins/auth.js';
import errorsPlugin from './plugins/errors.js';
import idempotencyPlugin from './plugins/idempotency.js';
import opsPlugin from './plugins/ops.js';
import ssePlugin from './plugins/sse.js';
import { registerModules } from './modules/index.js';

/** pino options: request id, user, branch; secrets and CNIC redacted (CLAUDE.md rule 13). */
export function loggerOptions(level) {
  return {
    level,
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-csrf-token"]',
        'res.headers["set-cookie"]',
        '*.password',
        '*.currentPassword',
        '*.newPassword',
        '*.token',
        '*.secret',
        '*.refreshToken',
        '*.accessToken',
        '*.cnic',
        '*.driverCnic',
      ],
      censor: '[redacted]',
    },
    serializers: {
      req: (req) => ({ method: req.method, url: req.url, ip: req.ip }),
    },
  };
}

/**
 * @param {{ config: import('./config.js').AppConfig, db: import('./lib/oracle/db.js').Db, clock?: { now: () => Date }, redis?: any, logger?: any }} deps
 */
export async function buildApp({ config, db, clock = systemClock, redis = null, logger }) {
  const app = Fastify({
    logger: logger ?? (config.LOG_LEVEL === 'silent' ? false : loggerOptions(config.LOG_LEVEL)),
    genReqId: (req) => {
      const h = req.headers['x-request-id'];
      return typeof h === 'string' && /^[\w-]{8,64}$/.test(h) ? h : randomUUID();
    },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
    ajv: undefined,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('clock', clock);
  app.decorate('redis', redis);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  await app.register(errorsPlugin);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 5 } });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'DCL Sales & Dispatch API', version: '0.1.0' },
      servers: [{ url: '/' }],
    },
    transform: jsonSchemaTransform,
  });
  if (config.NODE_ENV !== 'production') {
    await app.register(swaggerUi, { routePrefix: '/api/v1/docs' });
  }

  await app.register(authPlugin);
  await app.register(idempotencyPlugin);
  await app.register(opsPlugin);
  await app.register(ssePlugin);

  app.get('/api/v1/openapi.json', { config: { public: true }, schema: { hide: true } }, async () =>
    app.swagger(),
  );

  await registerModules(app);
  return app;
}
