// TASKS P1-03: customers — search legacy data, create (code from geography, pending approval).
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

async function pick(page, label, optionText) {
  await page.getByRole('combobox', { name: new RegExp(`^${label}`) }).click();
  await page.getByRole('option', { name: optionText }).first().click();
}

test('P1-03: find a legacy customer and open its tabs', async ({ page }) => {
  await login(page);
  await page.goto('/customers');
  await page.getByLabel('Search customers').fill('102-04');
  await page.getByLabel('Search customers').press('Enter');
  await page.getByRole('link', { name: '102-04' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('S.B. CEMENT AGENCY');
  await expect(page.getByText('approved', { exact: true }).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Sales tax' }).click();
  await expect(page.getByLabel('Sales tax type')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/13-customer-detail.png` });
  await page.getByRole('tab', { name: 'Blocks' }).click();
  await expect(page.getByText('Legacy block groups (read-only)')).toBeVisible();
});

test('P1-03: create a customer — code preview, pending approval, contacts normalised', async ({
  page,
}) => {
  await login(page);
  await page.goto('/customers/new');
  await pick(page, 'Zone', /KARACHI/);
  await pick(page, 'Territory', /KHI-5/);
  await pick(page, 'Area', /DISTRICT WEST/);
  await expect(page.getByText(/^1-12-01-\d{3}$/)).toBeVisible();
  await pick(page, 'Customer zone', /KARACHI/);
  await page.getByLabel('Customer name').fill('E2E CEMENT TRADERS');
  await pick(page, 'Channel', /DIRECT DEALER/);
  await page.getByLabel('Mobile').fill('0300 1234567');
  await page.screenshot({ path: `${SHOTS}/14-customer-new.png` });
  await page.getByRole('button', { name: 'Save & send for approval' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('E2E CEMENT TRADERS');
  await expect(page.getByText('pending approval').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Contacts' }).click();
  await expect(page.getByLabel('Mobile')).toHaveValue('03001234567');

  await page.getByRole('tab', { name: 'Security' }).click();
  await page.getByLabel('Description').fill('CASH DEPOSIT');
  await page.getByLabel('Amount (PKR)').fill('150000');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('cell', { name: 'CASH DEPOSIT' })).toBeVisible();
  await expect(page.getByText(/Total security deposit/)).toContainText('150,000');
});
