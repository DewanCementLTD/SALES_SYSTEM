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

test('P4-02: balance transfer A → B saved as a draft credit note to B', async ({ page }) => {
  await login(page);
  await page.goto('/accounts/transfers');
  await expect(page.getByRole('heading', { level: 1, name: 'Balance transfers' })).toBeVisible();
  await page.getByRole('button', { name: 'New transfer' }).click();
  const dlg = page.getByRole('dialog');
  for (const [name, code] of [
    ['From (debited)', '102-04'],
    ['To (credited)', '912-351'],
  ]) {
    await dlg.getByRole('combobox', { name, exact: true }).click();
    await page.getByRole('combobox', { name: 'Search customers' }).fill(code);
    await page
      .getByRole('option', { name: new RegExp(code) })
      .first()
      .click();
  }
  await dlg.getByLabel('Amount (PKR)').fill('50000');
  await dlg.getByLabel('Particular').fill('Advance of sister concern');
  await page.screenshot({ path: `${SHOTS}/42-transfer-new.png` });
  await dlg.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Credit note \d+/ })).toBeVisible();
  await expect(page.getByText('102-04 → 912-351')).toBeVisible();
});

test('P4-03: incentive scheme → preview (no invoices in the sandbox period)', async ({ page }) => {
  await login(page);
  await page.goto('/accounts/incentives');
  await expect(page.getByRole('heading', { level: 1, name: 'Incentive runs' })).toBeVisible();
  await page.getByRole('button', { name: 'New scheme' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Memo #').fill('MKT/INC/E2E');
  await dlg.getByLabel('Period from').fill('2020-01-01');
  await dlg.getByLabel('Period to').fill('2020-01-31');
  await dlg.getByLabel('First customer code').fill('100-00');
  await dlg.getByLabel('Last customer code').fill('999-99');
  await dlg.getByRole('combobox', { name: 'Product 1' }).click();
  await page.getByRole('option', { name: /^OPC ·/ }).click();
  await dlg.getByLabel('Rate / t').fill('700');
  await page.screenshot({ path: `${SHOTS}/43-incentive-new.png` });
  await dlg.getByRole('button', { name: 'Save scheme' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: /^Incentive scheme INC \d+/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByText('No invoiced quantity in this period')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Commit' })).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/44-incentive-preview.png` });
});
