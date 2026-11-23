// TASKS P1-01: masters are browsable (migrated data), created, edited and deactivated in the UI.
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

test('P1-01: channels — browse, create, edit, deactivate', async ({ page }) => {
  await login(page);
  await page.goto('/masters/channels');
  await expect(page.getByRole('heading', { level: 1, name: 'Channels' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'DIRECT DEALER', exact: true })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/10-masters-channels.png` });

  await page.getByRole('button', { name: 'New channel' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Channel code').fill('z5');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(
    dialog.getByText('Too small').or(dialog.getByText(/expected string|Invalid/)),
  ).toBeVisible();
  await dialog.getByLabel('Description').fill('E2E CHANNEL');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('cell', { name: 'E2E CHANNEL', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Edit Z5' }).click();
  await page.getByRole('dialog').getByLabel('Description').fill('E2E CHANNEL 2');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'E2E CHANNEL 2', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Deactivate Z5' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Created by the e2e test');
  await page.getByRole('dialog').getByRole('button', { name: 'Deactivate' }).click();
  await expect(page.getByRole('cell', { name: 'E2E CHANNEL 2', exact: true })).toBeHidden();
});

test('P1-01: products & periods are read-only and show the effective-period note', async ({
  page,
}) => {
  await login(page);
  await page.goto('/masters/products');
  await expect(page.getByRole('tab', { name: 'Products & periods' })).toBeVisible();
  await expect(page.getByText('BR-TAX-10').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /New product period/ })).toHaveCount(0);
  await page.getByLabel('Search Products & periods').fill('OPC');
  await page.getByLabel('Search Products & periods').press('Enter');
  await expect(page.getByRole('cell', { name: 'OPC', exact: true }).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/11-masters-products.png` });

  await page.getByRole('tab', { name: 'Product types' }).click();
  await expect(page.getByRole('cell', { name: 'Local Bulk', exact: true })).toBeVisible();
});

test('screens of later phases still show the planned screen', async ({ page }) => {
  await login(page);
  await page.goto('/delivery/adjustment');
  await expect(page.getByText(/Planned for P2/)).toBeVisible();
});

test('P1-02: geography — browse the hierarchy, add a zone, review legacy codes', async ({
  page,
}) => {
  await login(page);
  await page.goto('/masters/geography');
  await expect(page.getByRole('heading', { level: 1, name: 'Geography' })).toBeVisible();
  await expect(page.getByText('Customers without geography')).toBeVisible();
  const zones = page.getByRole('list', { name: 'Zones' });
  await zones.getByRole('button').first().click();
  await expect(
    page.getByRole('list', { name: 'Territories' }).getByRole('button').first(),
  ).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/12-masters-geography.png` });

  await page.getByRole('button', { name: 'New zone' }).click();
  await page.getByRole('dialog').getByLabel('Code').fill('e2');
  await page.getByRole('dialog').getByLabel('Name').fill('E2E Zone');
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
  await expect(zones.getByRole('button', { name: /E2E Zone/ })).toBeVisible();

  await page.getByRole('tab', { name: 'Legacy codes' }).click();
  await expect(page.getByRole('cell', { name: 'CITY', exact: true }).first()).toBeVisible();
});

test('P1-05: tax rates — WHT tab and product periods', async ({ page }) => {
  await login(page);
  await page.goto('/masters/tax-rates');
  await expect(page.getByRole('heading', { level: 1, name: 'Tax rates' })).toBeVisible();
  await page.getByLabel('Rate %').fill('0.1');
  await page.getByLabel('Effective from').fill('2026-07-01');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByRole('cell', { name: 'pending approval' }).first()).toBeVisible();
  await page.getByRole('tab', { name: 'FED & sales tax' }).click();
  await page.getByRole('combobox', { name: 'Product' }).click();
  await page.getByRole('option', { name: /^OPC ·/ }).click();
  await expect(page.getByRole('cell', { name: '4000.00' }).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/16-tax-rates.png` });
});

test('P1-06: trade prices — list, history, import panel', async ({ page }) => {
  await login(page);
  await page.goto('/masters/trade-prices');
  await expect(page.getByRole('heading', { level: 1, name: 'Trade prices' })).toBeVisible();
  await expect(page.getByRole('cell').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/17-trade-prices.png` });
  await page
    .getByRole('button', { name: /^History of / })
    .first()
    .click();
  await expect(page.getByRole('dialog')).toContainText('Price history');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Import from Excel' }).click();
  await expect(page.getByLabel('Workbook (.xlsx)')).toBeVisible();
});

test('P1-07: city rate sheets and freight sheets', async ({ page }) => {
  await login(page);
  await page.goto('/masters/rate-sheets');
  await expect(page.getByRole('heading', { level: 1, name: 'City rate sheets' })).toBeVisible();
  // wait for real rows (the first cell is the loading row until the list arrives)
  await page
    .getByRole('cell', { name: /^(open|approved)$/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 2, name: /^Sheet \d+/ })).toBeVisible();
  await expect(page.getByText(/Net booking/).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/18-rate-sheet.png` });
  await page.goto('/masters/freight');
  await expect(page.getByRole('heading', { level: 1, name: 'Freight sheets' })).toBeVisible();
});
