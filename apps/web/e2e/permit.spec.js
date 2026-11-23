// TASKS P2-05: permit — areas from the approved rate sheet, save draft, issue against the balance.
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

test('P2-05: new permit → draft → issue (balance checked)', async ({ page }) => {
  await login(page);
  await page.goto('/permits');
  await expect(page.getByRole('heading', { level: 1, name: 'City-wise permits' })).toBeVisible();
  await page.getByRole('link', { name: 'New permit' }).click();
  await page.getByRole('combobox', { name: 'Customer', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search customers' }).fill('912-351');
  await page
    .getByRole('option', { name: /912-351/ })
    .first()
    .click();
  await page.getByRole('combobox', { name: 'Product' }).click();
  await page
    .getByRole('option', { name: /^OPC ·/ })
    .first()
    .click();
  await page.getByRole('combobox', { name: 'Add area' }).click();
  await page.getByRole('option').first().click();
  await page
    .getByLabel(/^Quantity /)
    .first()
    .fill('10');
  await page.screenshot({ path: `${SHOTS}/28-permit-new.png`, fullPage: true });
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Permit \d+\.1$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Issue permit' }).click();
  await expect(
    page
      .getByText(/Permit issued\. Balance after/)
      .or(page.getByText(/is less than the permit value/)),
  ).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/29-permit-issue.png`, fullPage: true });
});
