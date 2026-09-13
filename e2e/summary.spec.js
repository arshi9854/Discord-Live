import { test, expect } from '@playwright/test';

test('recap chat calls the real backend with range/member filters and labels demo history', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#connection-text')).toHaveText('Live connection');
  await page.locator('#recap-open').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '2 weeks', exact: true }).click();
  await page.locator('#recap-member').fill('Maya');
  await page.locator('#recap-send').click();
  await expect(page.locator('#recap-progress')).toContainText('Recap ready');
  await expect(page.locator('.recap-coverage')).toContainText('Demo only');
  await expect(page.locator('#recap-log blockquote').first()).toContainText('Maya');
  await expect(page.locator('#recap-days')).toHaveValue('14');
  await expect(page.locator('#insight-brief')).toContainText('Local recap');
  await page.screenshot({ path: 'test-results/recap-desktop.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('#recap-open')).toBeFocused();
});

test('sidebar reports retained-window facts and AI rendering stays inert with source links', async ({ page }) => {
  await page.route('**/api/summary/config', route => route.fulfill({ json: { provider: 'openrouter', configured: true, model: 'test/model' } }));
  await page.route('**/api/summary', async route => {
    expect(route.request().postDataJSON().allowExternal).toBe(true);
    return route.fulfill({ json: { days: 7, member: '', source: 'discord', complete: true, count: 1, overview: '1 message.', start: '2026-09-05', end: '2026-09-12', terms: [], members: [], note: 'Evidence', coverage: 'Accessible history.', mode: 'llm', model: 'test/model', aiNote: 'AI synthesis of selected excerpts.', aiPoints: [{ text: '<img src=x onerror=alert(1)>', sources: ['1'] }], excerpts: [{ id: '1', author: 'Tester', text: 'Deployment ready', createdAt: '2026-09-10', url: 'https://discord.com/channels/1/2/1' }] } });
  });
  await page.goto('/');
  await expect(page.locator('#pulse-count')).not.toHaveText('0');
  await expect(page.locator('#insights-scope')).toContainText('not weekly totals');
  await expect(page.locator('#insight-provider')).toHaveText('OPENROUTER / READY');
  await page.locator('#recap-open').click();
  await expect(page.locator('#allow-external')).not.toBeChecked();
  await page.locator('#allow-external').check();
  await page.locator('#recap-send').click();
  await expect(page.locator('#recap-progress')).toContainText('Recap ready');
  await expect(page.locator('#insight-brief')).toContainText('AI brief');
  await expect(page.locator('#insight-brief img')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Source: Tester ↗' })).toHaveAttribute('href', 'https://discord.com/channels/1/2/1');
  await page.keyboard.press('Escape');
  const feed = await page.locator('#guestbook').boundingBox();
  const sidebar = await page.locator('.insights').boundingBox();
  expect(sidebar.x).toBeGreaterThan(feed.x + feed.width);
});

test('mobile recap handles pending/error/partial results safely and can clear the conversation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let succeed = false;
  await page.route('**/api/summary', async route => {
    if (!succeed) return route.fulfill({ status: 429, json: { error: 'Wait a few seconds and try again.' } });
    return route.fulfill({ json: {
      days: 7, member: '', start: '2026-09-05T12:00:00.000Z', end: '2026-09-12T12:00:00.000Z',
      source: 'discord', complete: false, count: 1, overview: 'One message retrieved.', coverage: 'Partial coverage: message limit reached.',
      terms: ['deployment'], members: [], note: 'Local extractive recap.', excerpts: [{ author: 'Tester', createdAt: '2026-09-10T12:00:00.000Z', text: '<img src=x onerror=alert(1)>', url: 'javascript:alert(1)' }],
    } });
  });
  await page.goto('/');
  await page.locator('#recap-open').click();
  await page.locator('#recap-prompt').fill('summarize last 7 days');
  await page.locator('#recap-send').click();
  await expect(page.locator('.recap-error')).toContainText('Wait a few seconds');
  await expect(page.locator('#recap-prompt')).toHaveValue('summarize last 7 days');
  await expect(page.locator('#recap-send')).toBeEnabled();
  succeed = true;
  await page.locator('#recap-send').click();
  await expect(page.locator('.recap-coverage')).toContainText('Partial coverage');
  await expect(page.locator('#recap-log blockquote')).toContainText('<img');
  await expect(page.locator('#recap-log img')).toHaveCount(0);
  await expect(page.locator('#recap-log a')).toHaveCount(0);
  expect(await page.locator('#recap-dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/recap-mobile.png' });
  await page.locator('#recap-clear').click();
  await expect(page.locator('#recap-log .recap-bubble')).toHaveCount(1);
});
