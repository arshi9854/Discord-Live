import test from 'node:test';
import assert from 'node:assert/strict';
import { createLLMProvider } from '../server/llm.js';

const env = { SUMMARY_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'test-secret', OPENROUTER_MODEL: 'test/model' };
const recap = { mode: 'extractive', count: 8, focus: 'highlights', complete: false, start: 'start', end: 'end', excerpts: [{ id: '123', author: 'Tester', text: 'The deployment is ready.', createdAt: 'date' }] };
const success = () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ points: [{ text: 'Deployment is ready.', sources: ['123'] }] }) } }] });
test('OpenRouter is opt-in, requires configuration and explicit per-request consent', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return success(); };
  assert.equal((await createLLMProvider({}, fetcher).generate(recap)).mode, 'extractive');
  assert.match((await createLLMProvider({ SUMMARY_PROVIDER: 'openrouter' }, fetcher).generate(recap)).aiWarning, /not configured/);
  const provider = createLLMProvider(env, fetcher);
  assert.match((await provider.generate(recap)).aiWarning, /not selected/);
  assert.equal(calls, 0);
  assert.equal(JSON.stringify(provider.status).includes('test-secret'), false);
});
test('LLM request is bounded, has no tools and validates source IDs', async () => {
  const provider = createLLMProvider(env, async (url, options) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    const body = JSON.parse(options.body);
    assert.equal(body.max_tokens, 700); assert.equal(body.tools, undefined);
    assert.equal(body.messages.length, 2);
    assert.match(body.messages[0].content, /untrusted data/);
    assert.equal(JSON.parse(body.messages[1].content).excerpts[0].text, recap.excerpts[0].text);
    return success();
  });
  const result = await provider.generate(recap, undefined, true);
  assert.equal(result.mode, 'llm');
  assert.deepEqual(result.aiPoints[0].sources, ['123']);
  assert.match(result.aiNote, /not all 8/);
});
test('provider errors, malformed output, fabricated IDs and truncation visibly fall back', async () => {
  const responses = [
    () => new Response('private provider error', { status: 401 }),
    () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'not json' } }] }),
    () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"points":[{"text":"invented","sources":["999"]}]}' } }] }),
    () => Response.json({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }),
    () => new Response('x'.repeat(70_000)),
  ];
  for (const response of responses) {
    const result = await createLLMProvider(env, async () => response()).generate(recap, undefined, true);
    assert.equal(result.mode, 'extractive'); assert.ok(result.aiWarning);
    assert.doesNotMatch(result.aiWarning, /private provider/);
  }
});
test('hourly provider guard bounds spending attempts and empty data never calls AI', async () => {
  let calls = 0;
  const provider = createLLMProvider({ ...env, LLM_REQUESTS_PER_HOUR: '1' }, async () => { calls++; return success(); });
  await provider.generate({ ...recap, excerpts: [] }, undefined, true);
  await provider.generate(recap, undefined, true);
  assert.match((await provider.generate(recap, undefined, true)).aiWarning, /hourly/);
  assert.equal(calls, 1);
});
