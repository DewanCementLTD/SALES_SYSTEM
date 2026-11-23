// Talks to the sales API as a device (API_SPEC §2 /devices/token, §11 /plant/weigh-readings):
// signed token request, token renewed 10 minutes before expiry or on 401.
import { signTokenRequest } from '@dcl/shared';

export class ApiClient {
  /**
   * @param {{ apiUrl: string, deviceId: string, secret: string, fetch?: typeof fetch,
   *   now?: () => Date, timeoutMs?: number }} o
   */
  constructor({
    apiUrl,
    deviceId,
    secret,
    fetch: f = globalThis.fetch,
    now = () => new Date(),
    timeoutMs = 8000,
  }) {
    this.base = apiUrl.replace(/\/+$/, '');
    this.deviceId = deviceId;
    this.secret = secret;
    this.fetch = f;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.token = null;
    this.tokenUntil = 0;
  }

  async call(method, path, body) {
    const res = await this.fetch(`${this.base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json };
  }

  async signIn() {
    this.token = null;
    const req = await signTokenRequest(this.deviceId, this.secret, this.now());
    const r = await this.call('POST', '/api/v1/devices/token', req);
    if (r.status !== 200) throw new ApiError(r.status, r.json?.detail ?? 'Device sign-in refused');
    this.token = r.json.token;
    this.tokenUntil = this.now().getTime() + (r.json.expiresIn - 600) * 1000;
    return r.json;
  }

  async authed(method, path, body) {
    if (!this.token || this.now().getTime() > this.tokenUntil) await this.signIn();
    let r = await this.call(method, path, body);
    if (r.status === 401) {
      await this.signIn();
      r = await this.call(method, path, body);
    }
    return r;
  }

  /** The device record with its configuration (Admin › Devices). */
  async me() {
    const r = await this.authed('GET', '/api/v1/devices/me');
    if (r.status !== 200) throw new ApiError(r.status, r.json?.detail ?? 'Cannot read the device');
    return r.json;
  }

  /** Upload one signed reading. Returns { ok } or { ok: false, permanent, message }. */
  async uploadReading(body) {
    const r = await this.authed('POST', '/api/v1/plant/weigh-readings', body);
    if (r.status === 200 || r.status === 201) return { ok: true, duplicate: r.json?.duplicate };
    const permanent = r.status >= 400 && r.status < 500 && r.status !== 429 && r.status !== 401;
    return { ok: false, permanent, message: `${r.status} ${r.json?.detail ?? ''}`.trim() };
  }
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
