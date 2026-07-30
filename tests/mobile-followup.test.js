import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const mobileJsPath = path.resolve('src/public/mobile.js');
const mobileCssPath = path.resolve('src/public/mobile.css');

test('mobile followup keeps prompt-only fallback for unsupported actions', async () => {
  const source = await readFile(mobileJsPath, 'utf8');

  assert.equal(
    source.includes('.filter((item) => !item.action_key || isSupportedMobileAction(item))'),
    false,
  );
  assert.ok(source.includes('const canExecuteAction = Boolean(suggestion.action_key && isSupportedMobileAction(suggestion));'));
  assert.ok(source.includes('delete payloadSuggestion.action_key;'));
  assert.ok(source.includes('delete payloadSuggestion.skill_key;'));
  assert.ok(source.includes('message: prompt,'));
  assert.ok(source.includes('reenter_chat: !canExecuteAction'));
});

test('mobile action result unwraps skill envelope instead of fallback text', async () => {
  const source = await readFile(mobileJsPath, 'utf8');

  assert.ok(source.includes('body?.result_type === "skill_run" && body.envelope'));
  assert.ok(source.includes('{ ...body.envelope, action_result: { ...body, envelope: undefined } }'));
});

test('mobile supports travel route server skill actions', async () => {
  const source = await readFile(mobileJsPath, 'utf8');

  assert.ok(source.includes('"travel_route.compare_destinations"'));
  assert.ok(source.includes('"travel_route.check_availability"'));
  assert.ok(source.includes('"travel_route.calculate_budget"'));
});

test('mobile pending bubbles show running indicator and are cleared on response', async () => {
  const source = await readFile(mobileJsPath, 'utf8');
  const css = await readFile(mobileCssPath, 'utf8');

  assert.ok(source.includes('renderPendingBubbleContent'));
  assert.ok(source.includes('{ pending: true }'));
  assert.ok(source.includes('last.classList.remove("pending-bubble");'));
  assert.ok(css.includes('.pending-run-icon'));
  assert.ok(css.includes('@keyframes pending-spin'));
});

test('mobile persists and replays html card bubbles', async () => {
  const source = await readFile(mobileJsPath, 'utf8');

  assert.ok(source.includes('function sanitizeHtmlCard'));
  assert.ok(source.includes('function recoverHtmlCardFromSource'));
  assert.ok(source.includes('decodeBasicHtmlEntities'));
  assert.ok(source.includes('recoverHtmlCardFromSource(message.html || message.content || "")'));
  assert.ok(source.includes('html: options.html ? sanitizeHtmlCard(options.html) : ""'));
  assert.ok(source.includes('lastMessage.html = options.html ? sanitizeHtmlCard(options.html) : "";'));
  assert.ok(source.includes('html-card-bubble'));
});
