// TASKS P2-00 / P1-08: balance card on the customer page and the customer ledger statement.
// The sandbox API never commits.
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

test('P1-08: customer balance card → ledger statement (R13 / R1)', async ({ page }) => {
  await login(page);
  await page.goto('/customers/1/102-04');
  await expect(page.getByText('Available balance')).toBeVisible();
  await expect(page.getByText('DC ledger balance')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/19-customer-balance.png` });

  await page.getByRole('link', { name: 'Open ledger' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Customer ledger' })).toBeVisible();
  await expect(page.getByText(/^Opening /)).toBeVisible();
  await expect(page.getByText('Closing balance', { exact: false })).toBeVisible();
  await page.getByRole('tab', { name: 'DO based (R1)' }).click();
  await expect(page).toHaveURL(/type=DO/);
  await page.screenshot({ path: `${SHOTS}/20-customer-ledger.png` });
});

test('P2-00: ledger page asks for a customer first; the picker searches', async ({ page }) => {
  await login(page);
  await page.goto('/accounts/ledger');
  await expect(page.getByText('Choose a customer')).toBeVisible();
  await page.getByRole('combobox', { name: 'Customer', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search customers' }).fill('102-04');
  await page
    .getByRole('option', { name: /102-04/ })
    .first()
    .click();
  await expect(page).toHaveURL(/customer=102-04/);
  await expect(page.getByText('No postings in this range.')).toBeVisible();
});
