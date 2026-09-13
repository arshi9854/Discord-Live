import { test, expect } from '@playwright/test';

test('sidebar composer transfers request without starting AI and theme persists', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('#insight-request').fill('recap from Maya last 2 weeks');
  let requests = 0;
  page.on('request', req => { if (req.method() === 'POST') requests++; });
  await page.locator('#recap-open').click();
  await expect(page.locator('#recap-prompt')).toHaveValue('recap from Maya last 2 weeks');
  expect(requests).toBe(0);
  await page.screenshot({ path: 'test-results/light-recap.png' });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/light-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/light-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('topic clusters update from stream events and show safe evidence', async ({ page }) => {
  await page.addInitScript(() => { window.EventSource = class extends EventTarget { constructor() { super(); window.topicStream = this; } }; });
  await page.goto('/');
  await expect(page.locator('#pulse-topics')).toContainText('No recurring topics');
  await page.evaluate(() => {
    window.topicStream.dispatchEvent(new MessageEvent('snapshot', { data: JSON.stringify({ status: { connected: true, mode: 'demo' }, messages: ['1', '2'].map(id => ({ id, author: { id, name: 'Tester' }, content: 'Railway deployment <img src=x>', createdAt: new Date().toISOString(), attachments: [], url: 'https://discord.com/channels/1/2/' + id })) }) }));
  });
  await expect(page.locator('.topic-cluster')).toHaveCount(1);
  await page.locator('.topic-cluster summary').click();
  await expect(page.locator('.topic-cluster blockquote')).toHaveCount(2);
  await expect(page.locator('.topic-cluster img')).toHaveCount(0);
  await page.evaluate(() => window.topicStream.dispatchEvent(new MessageEvent('delete', { data: '{"id":"1"}' })));
  await expect(page.locator('#pulse-topics')).toContainText('No recurring topics');
});
