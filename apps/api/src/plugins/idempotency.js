// Idempotency-Key for POST commands (API_SPEC §1, BR-OFF-04).
// Same key + same body → stored response (header Idempotent-Replay: true).
// Same key + other body → 422. Concurrent duplicate while the first runs → 409.
// Route option `config.idempotency: 'required'` makes the header mandatory (plant/sync endpoints).
// The key row is reserved in its own committed transaction before the command runs.
import { createHash } from 'node:crypto';
import fp from 'fastify-plugin';
import oracledb from 'oracledb';
import { AppError, Errors } from '../lib/errors.js';

const KEY_RE = /^[A-Za-z0-9_-]{8,80}$/;
const hashBody = (body) =>
  createHash('sha256')
    .update(JSON.stringify(body ?? null))
    .digest('hex');

export default fp(async (app) => {
  app.decorateRequest('idemKey', null);

  app.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'POST') return;
    const cfg = request.routeOptions.config ?? {};
    const key = request.headers['idempotency-key'];
    if (!key) {
      if (cfg.idempotency === 'required')
        throw Errors.validation('Idempotency-Key header is required');
      return;
    }
    if (!KEY_RE.test(String(key)))
      throw Errors.validation('Idempotency-Key must be 8–80 letters, digits, - or _');
    const endpoint = `${request.method} ${request.routeOptions.url}`.slice(0, 200);
    const reqHash = hashBody(request.body);
    const userId = request.session?.userId ?? null;

    const existing = await app.db.withTx(async (tx) => {
      const row = await tx.one(
        `SELECT USER_ID, ENDPOINT, REQUEST_HASH, STATUS_CODE, RESPONSE_BODY FROM IDEMPOTENCY_KEY WHERE IDEM_KEY = :k FOR UPDATE`,
        { k: key },
      );
      if (row && row.STATUS_CODE === 0) {
        // previous attempt failed with a server error: allow a retry with the same key
        await tx.exec(
          `UPDATE IDEMPOTENCY_KEY SET STATUS_CODE = NULL, CREATED_ON = SYSDATE WHERE IDEM_KEY = :k`,
          { k: key },
        );
        return null;
      }
      if (!row) {
        await tx.exec(
          `INSERT INTO IDEMPOTENCY_KEY (IDEM_KEY, USER_ID, BRNCH, ENDPOINT, REQUEST_HASH) VALUES (:k, :u, :b, :e, :h)`,
          { k: key, u: userId, b: request.session?.brnch ?? null, e: endpoint, h: reqHash },
        );
        return null;
      }
      return row;
    }, request.txOpts('idempotency'));

    if (existing) {
      if (
        existing.USER_ID !== userId ||
        existing.ENDPOINT !== endpoint ||
        existing.REQUEST_HASH !== reqHash
      ) {
        throw new AppError(
          'validation_failed',
          422,
          'This Idempotency-Key was already used for a different request',
        );
      }
      if (existing.STATUS_CODE === null) {
        throw Errors.duplicate('The same request is still being processed');
      }
      reply.header('idempotent-replay', 'true');
      reply.status(existing.STATUS_CODE).type('application/json');
      return reply.send(existing.RESPONSE_BODY ? JSON.parse(existing.RESPONSE_BODY) : null);
    }
    request.idemKey = key;
  });

  app.addHook('onSend', async (request, reply, payload) => {
    if (!request.idemKey || reply.getHeader('idempotent-replay')) return payload;
    const status = reply.statusCode >= 500 ? 0 : reply.statusCode;
    await app.db
      .withTx(
        (tx) =>
          tx.exec(
            `UPDATE IDEMPOTENCY_KEY SET STATUS_CODE = :s, RESPONSE_BODY = :b WHERE IDEM_KEY = :k`,
            {
              k: request.idemKey,
              s: status,
              b: {
                type: oracledb.CLOB,
                val: typeof payload === 'string' ? payload : JSON.stringify(payload ?? null),
              },
            },
          ),
        request.txOpts('idempotency'),
      )
      .catch((err) => request.log.error({ err }, 'could not store idempotent response'));
    return payload;
  });
});
