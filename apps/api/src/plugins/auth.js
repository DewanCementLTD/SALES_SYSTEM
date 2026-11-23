// Session from the `at` cookie, CSRF double-submit, and the permission preHandler
// (PERMISSIONS §4 P-1, P-4; API_SPEC §1). Route options live in `config`:
//   public: true                 → no session needed
//   permission: 'oc.confirm' | ['a','b']  → any of the keys, in the target branch
//   allowMustChange: true        → reachable while a password change is pending
//   csrf: false                  → skip CSRF (login/refresh are protected by SameSite + no session)
//   device: true                 → also callable with a device token (Authorization: Bearer, P-6):
//                                  only in the device's own branch, while the device is active;
//                                  device tokens are refused everywhere else
import fp from 'fastify-plugin';
import { Errors, AppError } from '../lib/errors.js';
import { userBranches, userPermissions } from '../modules/rbac/repo.js';
import { COOKIE, safeEqual, verifyAccessToken, verifyDeviceToken } from '../modules/auth/tokens.js';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Target branch of a request: path param, then body, then query, then session (P-1).
 * @returns {number}
 */
export function targetBranch(request) {
  const raw = request.params?.brnch ?? request.body?.brnch ?? request.query?.brnch;
  if (raw === undefined || raw === null || raw === '' || raw === 'all')
    return request.session.brnch;
  const b = Number(raw);
  if (!Number.isInteger(b)) throw Errors.validation('Branch must be a number');
  return b;
}

export default fp(async (app) => {
  app.decorateRequest('session', null);
  app.decorateRequest('authz', null);
  app.decorateRequest('device', null);

  app.addHook('onRequest', async (request) => {
    const token = request.cookies?.[COOKIE.access];
    const claims = token
      ? await verifyAccessToken(token, app.config.JWT_SECRET, app.clock.now())
      : null;
    request.session = claims;
    const auth = request.headers.authorization;
    if (!claims && typeof auth === 'string' && auth.startsWith('Bearer ')) {
      request.device = await verifyDeviceToken(
        auth.slice(7),
        app.config.JWT_SECRET,
        app.clock.now(),
      );
    }
  });

  app.addHook('preHandler', async (request) => {
    const cfg = request.routeOptions.config ?? {};
    // Swagger UI is only registered outside production (app.js)
    // no matched route → let the 404 handler answer
    if (!request.routeOptions.url) return;
    if (cfg.public || request.url.startsWith('/api/v1/docs')) return;
    if (request.device) {
      // P-6: devices reach only the plant endpoints of their own branch
      if (!cfg.device) throw Errors.forbidden('Devices can only call the plant endpoints');
      const dev = request.device;
      const row = await app.db.read(
        (tx) =>
          tx.one('SELECT BRNCH, ACTIVE FROM APP_DEVICE WHERE DEVICE_ID = :d', { d: dev.deviceId }),
        {
          usrid: `DEV ${dev.deviceId}`.slice(0, 20),
          action: 'authz.device',
          requestId: request.id,
        },
      );
      if (!row || row.ACTIVE !== 'Y' || Number(row.BRNCH) !== dev.brnch)
        throw Errors.unauthenticated();
      const raw = request.params?.brnch ?? request.body?.brnch ?? request.query?.brnch;
      if (raw !== undefined && raw !== null && raw !== '' && Number(raw) !== dev.brnch)
        throw Errors.branchForbidden(Number(raw));
      return;
    }
    const session = request.session;
    if (!session) throw Errors.unauthenticated();

    if (UNSAFE.has(request.method) && cfg.csrf !== false) {
      const header = request.headers['x-csrf-token'];
      if (!safeEqual(String(header ?? ''), String(request.cookies?.[COOKIE.csrf] ?? ''))) {
        throw Errors.forbidden('Missing or wrong CSRF token. Reload the page.');
      }
    }
    if (session.mustChangePassword && !cfg.allowMustChange) {
      throw new AppError('password_change_required', 403, 'Change your password to continue.');
    }

    // Authorisation data for this request, loaded ONCE here (one read, ≤ 2 branches) so route
    // code never opens a second unit of work from inside its transaction (nested DB calls hold a
    // second pooled connection and can deadlock under load).
    const loaded = await app.db.read(async (tx) => {
      const branches = (await userBranches(tx, session.userId)).map((b) => b.brnch);
      const perms = new Map();
      for (const b of branches) perms.set(b, await userPermissions(tx, session.userId, b));
      return { branches, perms };
    }, request.txOpts('authz'));
    const none = new Set();
    request.authz = {
      allowedBranches: async () => loaded.branches,
      permissions: async (brnch) => loaded.perms.get(brnch) ?? none,
      /** Branches (among allowed) where the user holds `key` (list endpoints with brnch=all). */
      branchesWith: async (key) => loaded.branches.filter((b) => loaded.perms.get(b)?.has(key)),
    };

    // the session's own branch must still be allowed (role/branch removed since login)
    const allowed = await request.authz.allowedBranches();
    if (!allowed.includes(session.brnch)) throw Errors.branchForbidden(session.brnch);

    if (cfg.permission) {
      const keys = Array.isArray(cfg.permission) ? cfg.permission : [cfg.permission];
      const brnch = targetBranch(request);
      if (!allowed.includes(brnch)) throw Errors.branchForbidden(brnch);
      const perms = await request.authz.permissions(brnch);
      if (!keys.some((k) => perms.has(k))) {
        throw Errors.forbidden(`You need ${keys.join(' or ')} to do this`, { permission: keys });
      }
    }
  });

  /** Audit/DB context of a request. */
  app.decorateRequest('ctx', function ctx() {
    const s = this.session;
    const d = this.device;
    return {
      userId: s?.userId ?? null,
      usrid: s?.usrid ?? (d ? `DEV ${d.deviceId}`.slice(0, 20) : null),
      brnch: s?.brnch ?? d?.brnch ?? null,
      fiscalYear: s?.fiscalYear ?? null,
      ip: this.ip,
      requestId: this.id,
    };
  });

  /** Options for db.withTx from a request (DBA tracing). */
  app.decorateRequest('txOpts', function txOpts(action) {
    const usrid =
      this.session?.usrid ??
      (this.device ? `DEV ${this.device.deviceId}`.slice(0, 20) : 'anonymous');
    return { usrid, action, requestId: this.id };
  });
});
