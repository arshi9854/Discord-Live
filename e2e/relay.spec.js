import { test, expect } from '@playwright/test';

test('demo streams to two browsers; notes are visible immediately and search/pause work', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#connection-text')).toHaveText('Live connection');
  await expect(page.locator('#mode-badge')).toBeVisible();
  await expect(page.locator('.message').first()).toBeVisible();
  const firstNote = await page.locator('.message-content').first().boundingBox();
  expect(firstNote.y).toBeLessThan(page.viewportSize().height - 50);
  await expect(page.locator('#browser-state')).toHaveText('Browser stream: connected');
  const secondPage = await context.newPage();
  await secondPage.goto('/');
  await expect(secondPage.locator('#connection-text')).toHaveText('Live connection');
  const initial = await page.locator('.message').count();
  await expect.poll(() => page.locator('.message').count(), { timeout: 16000 }).toBeGreaterThan(initial);
  await expect(secondPage.locator('.message-content').first()).toHaveText(await page.locator('.message-content').first().textContent());
  await secondPage.close();
  await page.getByRole('button', { name: 'Pause' }).click();
  const paused = await page.locator('.message').allTextContents();
  await expect(page.locator('#search')).toBeDisabled();
  await expect(page.locator('#footer-status')).toContainText('View paused');
  await expect(page.locator('.message')).toHaveText(paused);
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.getByRole('searchbox').fill('no-match-7b39e');
  await expect(page.getByRole('heading', { name: 'No matching messages' })).toBeVisible();
  await page.getByRole('searchbox').fill('Maya');
  await expect(page.locator('.message').first()).toContainText('Maya');
  await page.getByRole('searchbox').fill('');
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('mobile layout fits viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#connection-text')).toHaveText('Live connection');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(page.locator('.message-content').first()).toBeVisible();
  const firstNote = await page.locator('.message-content').first().boundingBox();
  expect(firstNote.y).toBeLessThan(794);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});

test('rendered content stays text and edits/deletes reconcile', async ({ page }) => {
  await page.addInitScript(() => {
    window.EventSource = class extends EventTarget {
      constructor() { super(); window.testStream = this; }
    };
  });
  await page.goto('/');
  const message = {
    id: '1', author: { name: 'Tester', avatarUrl: null },
    content: '<img src=x onerror="window.compromised=true">',
    createdAt: new Date().toISOString(), editedAt: null,
    attachments: [{ name: 'unsafe', url: 'javascript:alert(1)' }], url: null,
  };
  const dispatch = (name, data) => page.evaluate(({ name, data }) => {
    window.testStream.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(data) }));
  }, { name, data });
  await dispatch('snapshot', { messages: [message], status: { mode: 'discord', connected: true, channelName: 'test', guildName: 'Test' } });
  await expect(page.locator('.message-content')).toHaveText(message.content);
  await expect(page.locator('.message-content img')).toHaveCount(0);
  await expect(page.locator('.attachment')).toHaveCount(0);
  await dispatch('message', { ...message, content: 'edited', editedAt: new Date().toISOString() });
  await expect(page.locator('.message')).toHaveCount(1);
  await expect(page.locator('.message-content')).toHaveText('edited');
  await page.getByRole('button', { name: 'Pause' }).click();
  await dispatch('message', { ...message, id: '2', content: 'arrived while paused' });
  await expect(page.locator('.message')).toHaveCount(1);
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.locator('.message')).toHaveCount(2);
  await dispatch('snapshot', { messages: [message], status: { mode: 'discord', connected: false, error: 'Discord unavailable' } });
  await expect(page.locator('.message')).toHaveCount(1);
  await expect(page.locator('#connection-text')).toHaveText('Source offline');
  await expect(page.locator('#notice')).toHaveText('Discord unavailable');
  await expect(page.locator('#browser-state')).toHaveText('Browser stream: connected');
  await expect(page.locator('#discord-state')).toHaveText('Discord: offline / connecting');
  await page.evaluate(() => window.testStream.onerror());
  await expect(page.locator('#browser-state')).toHaveText('Browser stream: reconnecting');
  await dispatch('snapshot', { messages: [message], status: { mode: 'discord', connected: true, channelName: 'test', guildName: 'Test' } });
  await expect(page.locator('.message')).toHaveCount(1);
  await expect(page.locator('#discord-state')).toHaveText('Discord: connected');
  await expect(page.locator('#last-update')).toContainText('Last update received');
  await dispatch('delete', { id: '1' });
  await expect(page.locator('.message')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/empty.png', fullPage: true });
});

test('bookmarks persist, download, and follow source edits and deletions', async ({ page }) => {
  await page.addInitScript(() => {
    window.EventSource = class extends EventTarget {
      constructor() { super(); window.testStream = this; }
    };
  });
  await page.goto('/');
  const make = (id, name, content) => ({ id, content, author: { name, avatarUrl: null }, createdAt: new Date(Number(id) * 1000).toISOString(), attachments: [], url: 'https://discord.com/channels/111/222/' + id });
  const messages = [make('1', 'Maya', 'So happy you are here!'), make('2', 'Sam', 'Happy birthday, Arshiya!'), make('3', 'Jordan', 'Sending a little sunshine.')];
  const status = { mode: 'discord', connected: true, channelName: 'live-feed', guildName: 'Test' };
  const dispatch = (name, data) => page.evaluate(({ name, data }) => {
    window.testStream.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(data) }));
  }, { name, data });
  await dispatch('snapshot', { messages, status });
  await expect(page.locator('#write-note')).toHaveAttribute('href', 'https://discord.com/channels/111/222');
  await page.getByRole('button', { name: 'Bookmark message from Sam', exact: true }).click();
  await expect(page.locator('#saved-count')).toHaveText('1');
  await page.locator('#saved-tab').click();
  await expect(page.locator('.message')).toHaveCount(1);
  await expect(page.locator('.message-content')).toHaveText('Happy birthday, Arshiya!');
  const downloaded = page.waitForEvent('download');
  await page.locator('#download-button').click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('pocket-post-bookmarks.txt');
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(await download.path(), 'utf8');
  expect(text).toContain('Happy birthday, Arshiya!');
  expect(text).not.toContain('Sending a little sunshine.');
  await page.reload();
  await dispatch('snapshot', { messages, status });
  await expect(page.locator('#saved-count')).toHaveText('1');
  await page.locator('#saved-tab').click();
  await dispatch('message', { ...messages[1], content: 'Happy birthday, lovely friend!', editedAt: new Date().toISOString() });
  await expect(page.locator('.message-content')).toHaveText('Happy birthday, lovely friend!');
  await page.screenshot({ path: 'test-results/keepsakes.png', fullPage: true });
  await dispatch('delete', { id: '2' });
  await expect(page.locator('.message')).toHaveCount(0);
  await expect(page.locator('#saved-count')).toHaveText('0');
  await expect(page.locator('#download-button')).toBeDisabled();
  await page.locator('#all-tab').click();
  await expect(page.locator('.message')).toHaveCount(2);
});
