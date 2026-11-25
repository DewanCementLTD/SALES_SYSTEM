// TASKS P4-01: credit / debit notes. New note with WHT → draft → submit → waits for the Finance
// Manager (NOTE_POST); the sandbox has one user, so approval itself is covered by the API tests.
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

test('P4-01: credit note with WHT → draft → submitted for approval', async ({ page }) => {
  await login(page);
  await page.goto('/accounts/notes/new');
  await expect(
    page.getByRole('heading', { level: 1, name: 'New credit / debit note' }),
  ).toBeVisible();
  await page.getByRole('combobox', { name: 'Type' }).click();
  await page.getByRole('option', { name: /^001 ·/ }).click();
  await page.getByRole('combobox', { name: 'Customer', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search customers' }).fill('102-04');
  await page
    .getByRole('option', { name: /102-04/ })
    .first()
    .click();
  await page.getByLabel('Remarks').fill('Commission Oct-26');
  await page.getByLabel('Particular 1').fill('Commission on 400 t');
  await page.getByLabel('Amount').fill('100000');
  await page.getByLabel('WHT %').fill('12');
  await page.getByRole('button', { name: 'Add line' }).click();
  await page.getByLabel('Particular 2').fill('Freight support');
  await page.getByLabel('Amount').nth(1).fill('5000');
  await expect(page.getByText('Credit to the customer').locator('..')).toContainText('93,000.00');
  await page.screenshot({ path: `${SHOTS}/40-note-new.png`, fullPage: true });
  await page.getByRole('button', { name: 'Save draft' }).click();

  await expect(page.getByRole('heading', { level: 1, name: /^Credit note \d+/ })).toBeVisible();
  await expect(page.getByText('draft', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('pending approval', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /request #\d+/ })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/41-note-submitted.png`, fullPage: true });

  await page.goto('/accounts/notes?status=PENDING_APPROVAL');
  await expect(page.getByRole('link', { name: /^CN \d+/ }).first()).toBeVisible();
});
