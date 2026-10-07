import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { ready, showTab, solve, solved } from './helpers';

test('the example league solves to a verified, proven optimum', async ({ page }) => {
  await ready(page);
  await solved(page);
  await expect(page.locator('.status-title')).toHaveText('Optimal (proven)');
  await expect(page.locator('.status-detail')).toContainText('18 breaks');
  // The independent RUP checker re-derives the optimality proof.
  await expect(page.locator('.certificate.is-ok')).toContainText('Optimality proof checked', {
    timeout: 20_000,
  });
  // 14 rounds of 4 matches each.
  await expect(page.locator('.ticket')).toHaveCount(56);
  // Every rule card is ticked by the validator.
  await showTab(page, 'Rules');
  await expect(page.locator('.rule .badge--ok')).toHaveCount(8);
});

test('contradictory rules produce a minimal explanation, and relaxing one makes it solvable', async ({
  page,
}) => {
  await ready(page);
  await solved(page);
  await showTab(page, 'Rules');
  const add = (label: string) =>
    page.getByRole('group', { name: 'Add a constraint' }).getByRole('button', { name: label });

  // Kestrel Vale and Harbour Lights both at home in round 2 …
  await add('Home or away').click();
  let card = page.locator('.rule').last();
  await card
    .getByRole('combobox', { name: 'Team', exact: true })
    .selectOption({ label: 'Kestrel Vale' });
  await card.getByRole('combobox', { name: 'Venue rule', exact: true }).selectOption('home');
  await card.getByRole('combobox', { name: 'Round', exact: true }).selectOption('2');
  await add('Home or away').click();
  card = page.locator('.rule').last();
  await card
    .getByRole('combobox', { name: 'Team', exact: true })
    .selectOption({ label: 'Harbour Lights' });
  await card.getByRole('combobox', { name: 'Venue rule', exact: true }).selectOption('home');
  await card.getByRole('combobox', { name: 'Round', exact: true }).selectOption('2');
  // … while meeting each other in round 2.
  await add('Fixed match').click();
  card = page.locator('.rule').last();
  await card
    .getByRole('combobox', { name: 'First team', exact: true })
    .selectOption({ label: 'Kestrel Vale' });
  await card
    .getByRole('combobox', { name: 'Second team', exact: true })
    .selectOption({ label: 'Harbour Lights' });
  await card.getByRole('combobox', { name: 'Venue', exact: true }).selectOption('either');
  await card.getByRole('combobox', { name: 'Round', exact: true }).selectOption('2');

  await showTab(page, 'Schedule');
  await solve(page);
  const explain = page.locator('.explain');
  await expect(explain).toBeVisible({ timeout: 25_000 });
  await expect(explain.locator('.explain-title')).toHaveText('These 3 constraints cannot all hold');
  await expect(explain.locator('.explain-text')).toHaveText([
    'Kestrel Vale must play at home in round 2.',
    'Harbour Lights must play at home in round 2.',
    'Kestrel Vale and Harbour Lights must meet in round 2.',
  ]);
  // The structural rule involved is named.
  await expect(explain).toContainText('In every match one team is at home and the other away.');
  await expect(page.locator('.status-title')).toHaveText('No schedule exists');

  // One click relaxes the second rule and re-solves.
  await explain.locator('.explain-item').nth(1).getByRole('button', { name: 'Switch off' }).click();
  await solved(page);
  await expect(page.locator('.explain')).toHaveCount(0);
});

test('clicking a match pins it, and the pin becomes a rule', async ({ page }) => {
  await ready(page);
  await solved(page);
  const ticket = page.locator('.ticket').nth(5);
  await expect(ticket).toHaveAttribute('aria-pressed', 'false');
  await ticket.click();
  await expect(ticket).toHaveAttribute('aria-pressed', 'true');
  await showTab(page, 'Rules');
  await expect(page.locator('.rule')).toHaveCount(9);
  await expect(page.locator('.rule').last()).toContainText('Fixed match');
  // The current schedule already satisfies its own pin.
  await expect(page.locator('.rule').last().locator('.badge--ok')).toBeVisible();
});

test('calendar export: one ICS file with a VEVENT per match', async ({ page }) => {
  await ready(page);
  await solved(page);
  await page.getByRole('button', { name: /^Export/ }).click();
  const menu = page.locator('.export-menu');
  await menu.getByLabel(/One club’s calendar/).selectOption({ label: 'Lantern Hill' });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    menu.getByRole('button', { name: 'Download' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('lantern-hill-fixtures.ics');
  const text = await readFile((await download.path()) as string, 'utf8');
  expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
  expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(14);
  expect(text).toContain('SUMMARY:Lantern Hill v ');
});

test('CSV export lists every match', async ({ page }) => {
  await ready(page);
  await solved(page);
  await page.getByRole('button', { name: /^Export/ }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Fixture list/ }).click(),
  ]);
  const text = await readFile((await download.path()) as string, 'utf8');
  const lines = text.trimEnd().split('\r\n');
  expect(lines[0]).toBe('Round,Date,Home,Away,Home break,Away break,Notes');
  expect(lines).toHaveLength(57);
});

test('the URL hash carries the whole setup', async ({ page }) => {
  await ready(page);
  await solved(page);
  await showTab(page, 'League');
  await page.getByLabel('Name of team 1').fill('Kestrel Vale Rovers');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toMatch(/^#s=/);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
  await showTab(page, 'League');
  await expect(page.getByLabel('Name of team 1')).toHaveValue('Kestrel Vale Rovers');
});

test('a damaged share link falls back to the example with a message', async ({ page }) => {
  await ready(page, '#s=not-a-league');
  await expect(page.getByRole('alert')).toContainText('could not be opened');
  await solved(page);
});

test('over-booked fixed matches are reported as invalid input before solving', async ({ page }) => {
  await ready(page);
  await solved(page);
  await showTab(page, 'Rules');
  const add = page
    .getByRole('group', { name: 'Add a constraint' })
    .getByRole('button', { name: 'Fixed match' });
  for (const opponent of ['Harbour Lights', 'Millstone Athletic']) {
    await add.click();
    const card = page.locator('.rule').last();
    await card
      .getByRole('combobox', { name: 'First team', exact: true })
      .selectOption({ label: 'Kestrel Vale' });
    await card
      .getByRole('combobox', { name: 'Second team', exact: true })
      .selectOption({ label: opponent });
    await card.getByRole('combobox', { name: 'Round', exact: true }).selectOption('4');
  }
  await expect(page.locator('.rule--issue').first()).toContainText(
    'Kestrel Vale has two fixed matches in round 4.',
  );
  await showTab(page, 'Schedule');
  await expect(page.locator('.status-title')).toHaveText('Check the setup');
});

test('Ctrl+Enter solves from the keyboard, and Enter pins the focused match', async ({ page }) => {
  await ready(page);
  await solved(page);
  const first = page.locator('.ticket[tabindex="0"]');
  await first.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('.ticket.is-pinned')).toHaveCount(2);
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.status-title')).toHaveText('Optimal (proven)', { timeout: 25_000 });
});

test('team strips and statistics views', async ({ page }) => {
  await ready(page);
  await solved(page);
  await page.getByRole('button', { name: 'Teams', exact: true }).click();
  await expect(page.locator('table.strip tbody tr')).toHaveCount(8);
  await expect(page.locator('.strip-cell.is-break')).toHaveCount(18);
  await page.getByRole('button', { name: 'Statistics', exact: true }).click();
  await expect(page.locator('.tile--big dd')).toHaveText('18');
});

test('How it works opens as a dialog and closes with Escape', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'How it works' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('first-UIP');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('without Web Workers the solver runs on the page and still verifies', async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error simulate a browser without workers
    delete window.Worker;
  });
  await ready(page);
  await solved(page);
  await expect(
    page.getByRole('status').filter({ hasText: 'Background solving is unavailable' }),
  ).toBeVisible();
});
