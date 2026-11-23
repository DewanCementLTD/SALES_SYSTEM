// TASKS P3-04: gate-in screen (scan check, documents, truck form) and plant queue. Sandbox API.
import { expect, test } from '@playwright/test';

const USER = process.env.E2E_USER;
const PASSWORD = process.env.E2E_PASSWORD;
const SHOTS = process.env.SCREENSHOT_DIR ?? 'test-results/screens';

async function login(page) {
  await page.goto('/login');
  await page.getByLabel('User ID').fill(USER);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good/);
}

test('P3-04: gate-in refuses a non-DCL QR and keeps the issue button off without documents', async ({
  page,
}) => {
  await login(page);
  await page.goto('/plant/gate-in');
  await expect(page.getByRole('heading', { level: 1, name: 'Gate-in' })).toBeVisible();
  await expect(page.getByText('No DO yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Issue gate pass and DC' })).toBeDisabled();
  await page.getByLabel('Scan the DO QR (or paste it)').fill('HELLO-NOT-A-QR');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'This is not a DCL document QR' }),
  ).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/32-gate-in.png`, fullPage: true });
});

test('P3-04: plant queue lists the trucks inside', async ({ page }) => {
  await login(page);
  await page.goto('/plant/queue');
  await expect(page.getByRole('heading', { level: 1, name: 'Plant queue' })).toBeVisible();
  await expect(page.getByLabel('Loading')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/33-plant-queue.png` });
});

test('P3-05: weighing screen shows the agent state and the trucks to weigh', async ({ page }) => {
  await login(page);
  await page.goto('/plant/weighing');
  await expect(page.getByRole('heading', { level: 1, name: 'Weighing' })).toBeVisible();
  await expect(page.getByText('Weighbridge agent not running on this PC')).toBeVisible();
  await expect(page.getByLabel('Live weight')).toContainText('— — —');
  await page.screenshot({ path: `${SHOTS}/34-weighing.png` });
});

test('P3-08: exit screen refuses a QR that is not a gate pass', async ({ page }) => {
  await login(page);
  await page.goto('/plant/exit');
  await expect(page.getByRole('heading', { level: 1, name: 'Exit' })).toBeVisible();
  await page.getByLabel('Gate-pass QR').fill('NOT-A-GATE-PASS');
  await page.getByRole('button', { name: 'Check the gate pass' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: /gate-pass QR|not allowed|need/i }),
  ).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/35-exit.png` });
});
