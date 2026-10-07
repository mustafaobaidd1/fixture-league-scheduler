import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ready, showTab, solved } from './helpers';

async function audit(page: Page) {
  // Let entrance animations finish: contrast is judged on the settled page.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
  );
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    blocking.map(
      (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
    ),
  ).toEqual([]);
}

test('has no serious or critical WCAG 2.2 AA violations', async ({ page }) => {
  await ready(page);
  await solved(page);
  await audit(page);
});

test('stays accessible in the other views and states', async ({ page }) => {
  await ready(page);
  await solved(page);
  await page.getByRole('button', { name: 'Teams', exact: true }).click();
  await audit(page);
  await page.getByRole('button', { name: 'Statistics', exact: true }).click();
  await audit(page);
  await showTab(page, 'Rules');
  await audit(page);
  await showTab(page, 'League');
  await audit(page);
  await page.getByRole('button', { name: 'How it works' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await audit(page);
});

test('the explanation of an impossible league is accessible', async ({ page }) => {
  // Two clubs at home in round 2 while meeting each other in round 2.
  const setup = {
    v: 1,
    n: 'Clash',
    f: 's',
    s: '2026-08-15',
    i: 7,
    t: [
      ['North', '1b2a4a', 'f3eee4'],
      ['South', 'c8202f', 'ffffff'],
      ['East', '1f6b3a', 'f2c230'],
      ['West', '5b2a86', 'f5d33f'],
    ],
    c: [
      ['v', 1, 0, 2, 'h'],
      ['v', 1, 1, 2, 'h'],
      ['f', 1, 0, 1, 2, 'e'],
    ],
  };
  const hash = '#s=' + Buffer.from(JSON.stringify(setup)).toString('base64url');
  await ready(page, hash);
  await expect(page.locator('.explain')).toBeVisible({ timeout: 25_000 });
  await audit(page);
});
