import { describe, expect, it } from 'vitest';
import { createEmailDriver, maskEmail } from './email.js';
import { waLink, waNumber } from './whatsapp.js';

describe('dealer notification drivers (P2-09)', () => {
  it('BR-NTF-01: WhatsApp click-to-chat link for Pakistani mobiles', () => {
    expect(waNumber('0300-1234567')).toBe('923001234567');
    expect(waNumber('+92 300 1234567')).toBe('923001234567');
    expect(waNumber('021-111-222-333')).toBeNull();
    expect(waLink('03001234567', 'DO 1 issued')).toBe(
      'https://wa.me/923001234567?text=DO%201%20issued',
    );
  });

  it('e-mail falls back to the console driver without SMTP and masks the address in logs', async () => {
    const logged = [];
    const d = createEmailDriver({}, { info: (o, m) => logged.push([o, m]) });
    expect(d.name).toBe('console');
    await d.send('dealer@example.com', 'Subject', 'Body');
    expect(logged[0][0]).toMatchObject({ to: 'd***@example.com', subject: 'Subject' });
    expect(maskEmail('ab@x.pk')).toBe('a***@x.pk');
  });
});
