import { describe, expect, it, vi } from 'vitest';
import { createSmsDriver, maskMobile } from './sms.js';

describe('SMS driver (OPEN-Q7: provider adapter)', () => {
  it('masks mobile numbers in logs', () => {
    expect(maskMobile('03001234567')).toBe('0300*****67');
  });

  it('console driver logs instead of sending', async () => {
    const log = { info: vi.fn() };
    const d = createSmsDriver({ SMS_DRIVER: 'console' }, log);
    await d.send('03001234567', 'Your DO 123 is issued');
    expect(log.info).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.info.mock.calls[0][0])).not.toContain('1234567');
  });

  it('http-generic needs a URL template; unknown drivers are refused', () => {
    expect(() => createSmsDriver({ SMS_DRIVER: 'http-generic' }, { info() {} })).toThrow(
      /SMS_URL_TEMPLATE/,
    );
    expect(() => createSmsDriver({ SMS_DRIVER: 'pigeon' }, { info() {} })).toThrow(/Unknown/);
  });
});
