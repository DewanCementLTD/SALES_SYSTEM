// E-mail adapter (ARCHITECTURE §2, BR-NTF-01, TASKS P2-09). System mails go through the company
// SMTP account (SMTP_HOST/PORT/USER/PASSWORD/FROM); without SMTP_HOST the console driver logs the
// message instead (dev/test). Per-user SMTP accounts for report sharing come with P5-08.
import nodemailer from 'nodemailer';

/** a.b@x.com → a***@x.com for logs (CLAUDE.md rule 13). */
export const maskEmail = (e) => String(e ?? '').replace(/^(.).*(@.*)$/, '$1***$2');

/**
 * @param {{ SMTP_HOST?: string, SMTP_PORT?: string, SMTP_USER?: string, SMTP_PASSWORD?: string, SMTP_FROM?: string }} env
 * @param {{ info: Function }} log
 */
export function createEmailDriver(env, log) {
  if (!env.SMTP_HOST) {
    return {
      name: 'console',
      async send(to, subject, text) {
        log.info({ to: maskEmail(to), subject, chars: text.length }, 'e-mail (console driver)');
        return { providerRef: `console-${Date.now()}` };
      },
    };
  }
  const port = Number(env.SMTP_PORT ?? 587);
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });
  return {
    name: 'smtp',
    async send(to, subject, text) {
      const info = await transport.sendMail({
        from: env.SMTP_FROM || env.SMTP_USER,
        to,
        subject: subject ?? 'Dewan Cement Limited',
        text,
      });
      return { providerRef: info.messageId ?? null };
    },
  };
}
