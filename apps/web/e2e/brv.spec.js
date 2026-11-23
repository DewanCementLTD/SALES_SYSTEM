// TASKS P2-04: BRV entry and verification queue. The sandbox has one user, so verifying its own
// BRV must be refused (BR-BRV-03); the two-user path is covered by the API tests.
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

test('P2-04: enter a BRV; the maker cannot verify it; it waits in the queue', async ({ page }) => {
  await login(page);
  await page.goto('/payments/brv/new');
  await page.getByRole('combobox', { name: 'Customer', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search customers' }).fill('102-04');
  await page
    .getByRole('option', { name: /102-04/ })
    .first()
    .click();
  await choose(page, 'Instrument', /^N ·/);
  await choose(page, 'Category', /^A ·/);
  await page.getByLabel('Cheque / reference #').fill('IBFT-E2E-1');
  await choose(page, 'Deposited in (company account)', /^HBL ·/);
  await page.getByLabel('Amount (PKR)').fill('250000');
  await page.screenshot({ path: `${SHOTS}/23-brv-new.png`, fullPage: true });
  await page.getByRole('button', { name: 'Save BRV' }).click();

  await expect(page.getByRole('heading', { level: 1, name: /^BRV \d+/ })).toBeVisible();
  await expect(page.getByText('entered', { exact: true })).toBeVisible();
  await expect(page.getByText(/does not count toward the customer/)).toBeVisible();
  const brvNo = (await page.getByRole('heading', { level: 1 }).textContent()).replace('BRV ', '');

  await page.getByRole('button', { name: 'Verify with bank' }).click();
  await page.getByLabel('Bank reference').fill('HBL call 11:00');
  await page.getByRole('dialog').getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('dialog').getByText(/another user must verify it/)).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto('/payments/verification');
  await expect(page.getByRole('heading', { level: 1, name: 'Bank verification' })).toBeVisible();
  await page.getByLabel('Search BRVs').fill(brvNo.trim());
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('button', { name: `Verify ${brvNo.trim()}` })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/24-brv-queue.png` });
});
