// TASKS P2-07: re-pricing preview. The sandbox API never commits.
import { expect, test } from '@playwright/test';

const USER = process.env.E2E_USER;
const PASSWORD = process.env.E2E_PASSWORD;

test('P2-07: re-pricing preview lists open DOs past the rate lock', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('User ID').fill(USER);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good/);
  await page.goto('/orders/repricing');
  await page.getByRole('combobox', { name: 'Product' }).click();
  await page
    .getByRole('option', { name: /^OPC ·/ })
    .first()
    .click();
  await page.getByLabel('New net rate / ton').fill('26000');
  await page.getByLabel('Effective from').fill('2027-01-31');
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByText(/open DO\(s\) past the rate lock/)).toBeVisible();
});
