// TASKS P2-01: SRF — create a draft (tons ↔ bags, priced destination, schedule), then submit to
// create the draft OC (BR-SRF-05). The sandbox API never commits.
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

async function choose(page, name, option) {
  await page.getByRole('combobox', { name }).click();
  await page.getByRole('option', { name: option }).first().click();
}

test('P2-01: new SRF → save draft → submit creates the draft OC', async ({ page }) => {
  await login(page);
  await page.goto('/orders/srf');
  await expect(page.getByRole('heading', { level: 1, name: 'Sales Request Forms' })).toBeVisible();
  await page.getByRole('link', { name: 'New SRF' }).click();

  await page.getByRole('combobox', { name: 'Customer', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search customers' }).fill('912-351');
  await page
    .getByRole('option', { name: /912-351/ })
    .first()
    .click();
  await choose(page, 'Product', /^OPC ·/);
  await choose(page, 'Destination city', /MRMOSDDU03/);
  await page.getByLabel('Quantity in tons').fill('35');
  await expect(page.getByLabel('Quantity in bags')).toHaveValue('700');
  await choose(page, 'Mode of transport', /^003 ·/);

  // schedule must add up (BR-SRF-02)
  await page.getByLabel('Schedule quantity 1').fill('20');
  await expect(page.getByText('15.00 t still to schedule')).toBeVisible();
  await page.getByRole('button', { name: 'Split quantity evenly' }).click();
  await expect(page.getByLabel('Schedule quantity 1')).toHaveValue('35.00');
  await page.screenshot({ path: `${SHOTS}/21-srf-new.png`, fullPage: true });

  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^SRF \d+/ })).toBeVisible();
  await expect(page.getByText('draft', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Submit (create OC)' }).click();
  await expect(
    page.getByText(/Draft OC \d+ created at the trade price \(MRMOSDDU03\)/),
  ).toBeVisible();
  await expect(page.getByText('submitted', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Open OC \d+/ })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/22-srf-submitted.png` });
});
