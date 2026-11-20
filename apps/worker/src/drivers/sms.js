// SMS adapter (ARCHITECTURE §2; provider not chosen yet: OPEN-Q7).
//   console      → logs the message (dev/test)
//   http-generic → GET/POST to SMS_URL_TEMPLATE with {to} and {text} placeholders

/** 03001234567 → 0300*****67 for logs (CLAUDE.md rule 13). */
export const maskMobile = (m) => String(m ?? '').replace(/^(\d{4})\d+(\d{2})$/, '$1*****$2');

/**
 * @param {{ SMS_DRIVER?: string, SMS_URL_TEMPLATE?: string }} env
 * @param {{ info: Function }} log
 */
export function createSmsDriver(env, log) {
  const driver = env.SMS_DRIVER ?? 'console';
  if (driver === 'console') {
    return {
      name: 'console',
      async send(to, text) {
        log.info({ to: maskMobile(to), chars: text.length }, `SMS (console driver): ${text}`);
        return { providerRef: `console-${Date.now()}` };
      },
    };
  }
  if (driver === 'http-generic') {
    const tpl = env.SMS_URL_TEMPLATE;
    if (!tpl) throw new Error('SMS_URL_TEMPLATE is required for SMS_DRIVER=http-generic');
    return {
      name: 'http-generic',
      async send(to, text) {
        const url = tpl
          .replace('{to}', encodeURIComponent(to))
          .replace('{text}', encodeURIComponent(text));
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`SMS gateway answered ${res.status}`);
        return { providerRef: res.headers.get('x-message-id') ?? null };
      },
    };
  }
  throw new Error(`Unknown SMS_DRIVER ${driver}`);
}
