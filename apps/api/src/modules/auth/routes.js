// /api/v1/auth/* (API_SPEC §2)
import { BRANCHES, fiscalYearOf, zBrnch, zFiscalYear } from '@dcl/shared';
import { z } from 'zod';
import { SettingsReader } from '../settings/service.js';
import { fiscalYears } from './repo.js';
import * as auth from './service.js';
import { ACCESS_TTL_SEC, COOKIE, REFRESH_TTL_SEC, newCsrfToken } from './tokens.js';

const zMeResponse = z.object({
  user: z.object({
    userId: z.number(),
    usrid: z.string(),
    fullName: z.string(),
    designation: z.string().nullable(),
    email: z.string().nullable(),
  }),
  branch: z.number(),
  fiscalYear: z.number(),
  mustChangePassword: z.boolean(),
  branches: z.array(
    z.object({
      brnch: z.number(),
      name: z.string(),
      isDefault: z.boolean(),
      roles: z.array(z.string()),
      fiscalYears: z.array(z.object({ year: z.number(), label: z.string(), closed: z.boolean() })),
    }),
  ),
  permissions: z.array(z.string()),
});

const zOk = z.object({ ok: z.literal(true) });

/** @param {import('fastify').FastifyInstance} app */
export default async function authRoutes(app) {
  const secure = app.config.COOKIE_SECURE;

  function setSessionCookies(reply, { accessToken, refreshToken }) {
    const base = { httpOnly: true, secure, sameSite: 'lax' };
    reply.setCookie(COOKIE.access, accessToken, { ...base, path: '/', maxAge: ACCESS_TTL_SEC });
    reply.setCookie(COOKIE.refresh, refreshToken, {
      ...base,
      path: '/api/v1/auth',
      maxAge: REFRESH_TTL_SEC,
    });
    reply.setCookie(COOKIE.csrf, newCsrfToken(), {
      httpOnly: false,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: REFRESH_TTL_SEC,
    });
  }

  function clearSessionCookies(reply) {
    reply.clearCookie(COOKIE.access, { path: '/' });
    reply.clearCookie(COOKIE.refresh, { path: '/api/v1/auth' });
    reply.clearCookie(COOKIE.csrf, { path: '/' });
  }

  const deps = (request, tx) => ({
    tx,
    settings: new SettingsReader(tx),
    clock: app.clock,
    jwtSecret: app.config.JWT_SECRET,
    audit: request.ctx(),
  });

  /** Run a command whose failure must still be committed (login counter, token reuse). */
  async function commitThenFail(request, action, fn) {
    const res = await app.db.withTx((tx) => fn(deps(request, tx)), request.txOpts(action));
    if (res?.fail) throw res.fail;
    return res;
  }

  app.get(
    '/login-options',
    {
      config: { public: true },
      schema: {
        tags: ['auth'],
        summary: 'Branches and fiscal years for the login form',
        response: {
          200: z.object({
            branches: z.array(
              z.object({
                brnch: z.number(),
                name: z.string(),
                fiscalYears: z.array(
                  z.object({ year: z.number(), label: z.string(), closed: z.boolean() }),
                ),
              }),
            ),
            defaultFiscalYear: z.number(),
          }),
        },
      },
    },
    async (request) => {
      const years = await app.db.read((tx) => fiscalYears(tx), request.txOpts('login-options'));
      return {
        branches: BRANCHES.map((b) => ({
          brnch: b.brnch,
          name: b.name,
          fiscalYears: years
            .filter((y) => y.brnch === b.brnch)
            .slice(0, 6)
            .map((y) => ({ year: y.year, label: y.label, closed: y.closed })),
        })),
        defaultFiscalYear: fiscalYearOf(app.clock.now()),
      };
    },
  );

  app.post(
    '/login',
    {
      config: {
        public: true,
        csrf: false,
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['auth'],
        summary: 'Sign in with user id, password, branch and fiscal year',
        body: z.object({
          usrid: z.string().trim().min(1).max(20),
          password: z.string().min(1).max(200),
          brnch: zBrnch,
          fiscalYear: zFiscalYear,
        }),
        response: { 200: zMeResponse },
      },
    },
    async (request, reply) => {
      const res = await commitThenFail(request, 'login', (d) =>
        auth.login(d, {
          ...request.body,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        }),
      );
      setSessionCookies(reply, res);
      const session = {
        userId: res.userId,
        brnch: request.body.brnch,
        fiscalYear: request.body.fiscalYear,
        mustChangePassword: res.mustChangePassword,
      };
      return app.db.read((tx) => auth.me(tx, session), request.txOpts('me'));
    },
  );

  app.post(
    '/refresh',
    {
      config: { public: true, csrf: false, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { tags: ['auth'], summary: 'Rotate the refresh token', response: { 200: zOk } },
    },
    async (request, reply) => {
      try {
        const res = await commitThenFail(request, 'refresh', (d) =>
          auth.refresh(d, {
            refreshToken: request.cookies?.[COOKIE.refresh],
            ip: request.ip,
            userAgent: request.headers['user-agent'],
          }),
        );
        setSessionCookies(reply, res);
        return { ok: true };
      } catch (err) {
        clearSessionCookies(reply);
        throw err;
      }
    },
  );

  app.post(
    '/logout',
    {
      config: { public: true, csrf: false },
      schema: {
        tags: ['auth'],
        summary: 'Sign out (revokes the refresh token family)',
        response: { 200: zOk },
      },
    },
    async (request, reply) => {
      await app.db.withTx(
        (tx) =>
          auth.logout(deps(request, tx), {
            refreshToken: request.cookies?.[COOKIE.refresh],
            session: request.session,
          }),
        request.txOpts('logout'),
      );
      clearSessionCookies(reply);
      return { ok: true };
    },
  );

  app.post(
    '/change-password',
    {
      config: { allowMustChange: true, rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        summary: 'Change own password',
        body: z.object({
          currentPassword: z.string().min(1).max(200),
          newPassword: z.string().min(1).max(200),
        }),
        response: { 200: zOk },
      },
    },
    async (request, reply) => {
      const res = await app.db.withTx(
        (tx) =>
          auth.changePassword(deps(request, tx), { session: request.session, ...request.body }),
        request.txOpts('change-password'),
      );
      setSessionCookies(reply, res);
      return { ok: true };
    },
  );

  app.post(
    '/switch-branch',
    {
      schema: {
        tags: ['auth'],
        summary: 'Change current branch and fiscal year',
        body: z.object({ brnch: zBrnch, fiscalYear: zFiscalYear }),
        response: { 200: zMeResponse },
      },
    },
    async (request, reply) => {
      const res = await app.db.withTx(
        (tx) =>
          auth.switchBranch(deps(request, tx), {
            session: request.session,
            ...request.body,
            refreshToken: request.cookies?.[COOKIE.refresh],
            ip: request.ip,
            userAgent: request.headers['user-agent'],
          }),
        request.txOpts('switch-branch'),
      );
      setSessionCookies(reply, res);
      const session = {
        ...request.session,
        ...request.body,
        mustChangePassword: res.mustChangePassword,
      };
      return app.db.read((tx) => auth.me(tx, session), request.txOpts('me'));
    },
  );

  app.get(
    '/me',
    {
      config: { allowMustChange: true },
      schema: {
        tags: ['auth'],
        summary: 'Current user, branches, roles and permissions',
        response: { 200: zMeResponse },
      },
    },
    async (request) => app.db.read((tx) => auth.me(tx, request.session), request.txOpts('me')),
  );
}
