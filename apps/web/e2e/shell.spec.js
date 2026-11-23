// TASKS P0-14 AC: login → switch branch → logout. Also captures review screenshots
// (SCREENSHOT_DIR, default test-results/screens).
import { expect, test } from '@playwright/test';

const USER = process.env.E2E_USER;
const PASSWORD = process.env.E2E_PASSWORD;
const SHOTS = process.env.SCREENSHOT_DIR ?? 'test-results/screens';

async function login(page) {
  await page.goto('/login');
  await page.getByLabel('User ID').fill(USER);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    /Good (morning|afternoon|evening)/,
  );
}

test('login page', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByLabel('Fiscal year')).toContainText('2026 - 2027');
  await page.screenshot({ path: `${SHOTS}/01-login.png` });
});

test('wrong password shows the API message', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('User ID').fill(USER);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  // (Next's route announcer is also role=alert, so match the message itself)
  await expect(
    page.getByRole('alert').filter({ hasText: 'Wrong user id or password' }),
  ).toBeVisible();
});

test('P0-16: admin screens load with data from the API', async ({ page }) => {
  await login(page);
  const screens = [
    ['/admin/users', 'Users & branch access', '04-admin-users'],
    ['/admin/roles', 'Roles & permissions', '05-admin-roles'],
    ['/admin/settings', 'Settings', '06-admin-settings'],
    ['/approvals/rules', 'Approval rules', '07-approval-rules'],
    ['/admin/audit', 'Audit log', '08-audit-log'],
    ['/admin/devices', 'Devices', '31-admin-devices'],
    ['/approvals', 'My approvals', '09-approvals-inbox'],
  ];
  for (const [path, title, shot] of screens) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: /./ })).toHaveCount(0);
    // no networkidle: live updates keep an EventSource open; wait for a rendered table/section
    // (the sandbox keeps one transaction per run: the inbox may already list requests as cards)
    await expect(page.locator('main section, main a[href^="/approvals/"]').first()).toBeVisible();
    await expect(page.getByLabel('Loading')).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: false });
  }
  // data really came back: seeded settings and rules are listed
  await page.goto('/admin/settings');
  await expect(page.getByText('WEIGHT_TOLERANCE_KG')).toBeVisible();
  await page.goto('/approvals/rules');
  await expect(page.getByText('Weight variance outside tolerance')).toBeVisible();
});

test('P0-14: login → switch branch → logout', async ({ page }) => {
  await login(page);
  await expect(page.getByTestId('branch-switcher')).toContainText('Karachi');
  await expect(page.getByRole('navigation', { name: 'Main' })).toContainText('Admin');
  await expect(page.getByText('…', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/02-dashboard.png` });

  await page.getByTestId('branch-switcher').click();
  await page.getByRole('menuitemradio', { name: /Hattar/ }).click();
  await expect(page.getByTestId('branch-switcher')).toContainText('Hattar');
  await expect(page.getByRole('heading', { level: 1 }).locator('..')).toContainText('(.2)');

  await page.getByTestId('user-menu').click();
  await page.getByTestId('sign-out').click();
  await expect(page).toHaveURL(/\/login/);
  // the session is gone: protected pages bounce back to login
  await page.goto('/admin/users');
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fusers/);
});

test('planned screens show their phase; command palette navigates', async ({ page }) => {
  await login(page);
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/Type a screen name/).fill('order confirmation');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/orders\/oc$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Order confirmations' })).toBeVisible();
  await page.goto('/admin/gl-map');
  await expect(page.getByText('Planned for P3')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/03-planned-screen.png` });
});
