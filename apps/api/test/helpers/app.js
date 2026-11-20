// API integration-test harness: the app runs on ONE Oracle connection; every db.withTx becomes a
// savepoint, and the whole test is rolled back in `close()`. Nothing is ever committed, so tests
// can create users, roles and documents on the shared SALES_NEW schema (user decision 19 Nov 2026).
import oracledb from 'oracledb';
import { buildApp } from '../../src/app.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { Tx, initOracleClient, translateOracleError } from '../../src/lib/oracle/db.js';
import { testConfig } from './db.js';

export class SavepointDb {
  /** @param {import('oracledb').Connection} conn */
  constructor(conn) {
    this.conn = conn;
    this.n = 0;
  }

  async withTx(fn, ctx = {}) {
    const sp = `SP_${(this.n += 1)}`;
    await this.conn.execute(`SAVEPOINT ${sp}`);
    try {
      const result = await fn(new Tx(this.conn));
      if (ctx.rollback) await this.conn.execute(`ROLLBACK TO SAVEPOINT ${sp}`);
      return result;
    } catch (err) {
      await this.conn.execute(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {});
      throw translateOracleError(err);
    }
  }

  read(fn, ctx = {}) {
    return this.withTx(fn, { ...ctx, rollback: true });
  }

  async ping() {
    return true;
  }

  async close() {}
}

/** A clock tests can move. */
export function movableClock(start = '2026-11-20T05:00:00Z') {
  let t = new Date(start).getTime();
  return {
    now: () => new Date(t),
    advance: (ms) => {
      t += ms;
    },
    set: (iso) => {
      t = new Date(iso).getTime();
    },
  };
}

export async function buildTestApp({ clock = movableClock() } = {}) {
  const config = testConfig();
  initOracleClient(config);
  const conn = await oracledb.getConnection({
    user: config.DATABASE_USER,
    password: config.DATABASE_PASSWORD,
    connectString: config.DATABASE_CONNECT_STRING,
  });
  const db = new SavepointDb(conn);
  const app = await buildApp({ config, db, clock });
  await app.ready();
  return {
    app,
    db,
    clock,
    async close() {
      await app.close();
      await conn.rollback();
      await conn.close();
    },
  };
}

let seq = 0;
/**
 * Create a user (not committed). `roles`: { 1: ['FINANCE'], 2: ['MARKETING'] }.
 * @param {SavepointDb} db
 */
export async function createUser(
  db,
  {
    usrid,
    password = 'Passw0rd!Test',
    roles = { 1: ['FINANCE'] },
    mustChange = false,
    status = 'ACTIVE',
    allowedFrom = null,
    allowedTo = null,
  } = {},
) {
  const id = usrid ?? `T${Date.now().toString(36).slice(-6)}${(seq += 1)}`.toUpperCase();
  const hash = await hashPassword(password);
  return db.withTx(async (tx) => {
    const userId = await tx.nextId('SEQ_APP_USER');
    await tx.exec(
      `INSERT INTO APP_USER (USER_ID, USRID, FULL_NAME, PASSWORD_HASH, MUST_CHANGE_PWD, PWD_CHANGED_ON, STATUS, HOME_BRNCH, ALLOWED_FROM, ALLOWED_TO, CREATED_BY)
       VALUES (:id, :u, :n, :h, :m, :pc, :s, :hb, :af, :at, 'test')`,
      {
        id: userId,
        u: id,
        n: `Test ${id}`,
        h: hash,
        m: mustChange ? 'Y' : 'N',
        pc: mustChange ? null : new Date('2026-11-19T00:00:00Z'),
        s: status,
        hb: Number(Object.keys(roles)[0] ?? 1),
        af: allowedFrom,
        at: allowedTo,
      },
    );
    for (const [b, codes] of Object.entries(roles)) {
      await tx.exec(
        `INSERT INTO APP_USER_BRANCH (USER_ID, BRNCH, IS_DEFAULT) VALUES (:id, :b, 'N')`,
        { id: userId, b: Number(b) },
      );
      for (const c of codes) {
        await tx.exec(
          `INSERT INTO APP_USER_ROLE (USER_ID, BRNCH, ROLE_CODE, GRANTED_BY) VALUES (:id, :b, :c, 'test')`,
          {
            id: userId,
            b: Number(b),
            c,
          },
        );
      }
    }
    return { userId, usrid: id, password };
  });
}

/** Minimal cookie jar around fastify.inject. */
export class Client {
  constructor(app) {
    this.app = app;
    this.cookies = new Map();
  }

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async request(method, url, { body, headers = {} } = {}) {
    const res = await this.app.inject({
      method,
      url,
      payload: body,
      headers: {
        ...(this.cookies.size ? { cookie: this.cookieHeader() } : {}),
        ...(this.cookies.get('csrf') && method !== 'GET'
          ? { 'x-csrf-token': this.cookies.get('csrf') }
          : {}),
        ...headers,
      },
    });
    for (const c of res.cookies) {
      if (
        c.value === '' ||
        (c.maxAge !== undefined && c.maxAge <= 0) ||
        (c.expires && new Date(c.expires) < new Date())
      ) {
        this.cookies.delete(c.name);
      } else {
        this.cookies.set(c.name, c.value);
      }
    }
    return res;
  }

  get(url, opts) {
    return this.request('GET', url, opts);
  }

  post(url, body, opts = {}) {
    return this.request('POST', url, { ...opts, body });
  }

  put(url, body, opts = {}) {
    return this.request('PUT', url, { ...opts, body });
  }

  async login(usrid, password, { brnch = 1, fiscalYear = 2027 } = {}) {
    const res = await this.post('/api/v1/auth/login', { usrid, password, brnch, fiscalYear });
    if (res.statusCode !== 200) throw new Error(`login failed ${res.statusCode}: ${res.body}`);
    return res.json();
  }
}
