// TASKS P3-10: camera QR scanning starts on a device with only a front camera (Chromium fake
// camera). Decoding itself is @zxing/browser's job.
import { expect, test } from '@playwright/test';

const USER = process.env.E2E_USER;
const PASSWORD = process.env.E2E_PASSWORD;
const SHOTS = process.env.SCREENSHOT_DIR ?? 'test-results/screens';

test.use({
  permissions: ['camera'],
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

test('P3-10: the camera starts and shows its picture', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('User ID').fill(USER);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good/);
  await page.goto('/plant/gate-in');
  await page.getByRole('button', { name: 'Scan the DO QR with the camera' }).click();
  const dlg = page.getByRole('dialog', { name: 'Scan the QR code' });
  await expect(dlg.locator('video')).toBeVisible();
  await expect
    .poll(() => dlg.locator('video').evaluate((v) => v.readyState >= 2 && v.videoWidth > 0))
    .toBe(true);
  await expect(dlg.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/39-camera.png` });
});
