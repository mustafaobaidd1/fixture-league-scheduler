import { expect, type Page } from '@playwright/test';

export async function ready(page: Page, hash = '') {
  await page.goto('./' + hash);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
}

/** The phone layout uses tabs; on desktop every panel is already visible. */
export async function showTab(page: Page, name: 'League' | 'Rules' | 'Schedule') {
  const tab = page.locator('.tabs').getByRole('button', { name: new RegExp(`^\\d\\s*${name}`) });
  if (await tab.isVisible()) await tab.click();
}

export async function solved(page: Page) {
  await expect(page.locator('.status-banner')).toContainText(/Optimal|Feasible/, {
    timeout: 25_000,
  });
  await expect(page.locator('.stamp.is-verified')).toBeVisible();
}

/** Starts a solve with the visible Solve button (desktop panel or phone bar). */
export async function solve(page: Page) {
  await page.getByRole('button', { name: 'Solve', exact: true }).first().click();
}
