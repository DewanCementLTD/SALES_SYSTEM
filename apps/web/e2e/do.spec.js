// TASKS P2-06: DO list, outstanding view and detail with actions. The sandbox API never commits.
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

test('P2-06: outstanding DOs → DO detail with print, hold and cancel actions', async ({ page }) => {
  await login(page);
  await page.goto('/delivery/outstanding');
  await expect(page.getByRole('heading', { level: 1, name: 'Outstanding DOs' })).toBeVisible();
  await page
    .getByRole('cell', { name: /^\d{11}$/ })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: /^Delivery order \d{11}/ }),
  ).toBeVisible();
  await expect(page.getByText('Remaining', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Print DO' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Put on hold' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel DO' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/27-do-detail.png` });
});

test('P2-08: cancellation advices list orders and receipts', async ({ page }) => {
  await login(page);
  await page.goto('/orders/cancellations');
  await expect(page.getByRole('heading', { level: 1, name: 'Cancellation advices' })).toBeVisible();
  await expect(page.getByRole('cell').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Receipts (BRV)' }).click();
  await expect(page).toHaveURL(/kind=receipt/);
});

test('P2-09: admin message templates and print texts list the seeded rows', async ({ page }) => {
  await login(page);
  await page.goto('/admin/templates');
  await expect(page.getByRole('heading', { level: 1, name: 'Message templates' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'DO_ISSUED' }).first()).toBeVisible();
  await page.goto('/admin/print-texts');
  await expect(page.getByRole('heading', { level: 1, name: 'Print texts' })).toBeVisible();
});
