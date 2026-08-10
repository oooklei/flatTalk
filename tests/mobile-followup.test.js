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

test('mobile followup labels strip entity-encoded html tags before display', async () => {
  const source = await readFile(mobileJsPath, 'utf8');

  assert.ok(source.includes('function visibleActionText'));
  assert.ok(source.includes('return decodeBasicHtmlEntities(value)'));
  assert.ok(source.includes('.replace(/<[^>]*>/g, "")'));
});

test('mobile visible action labels do not fall back to raw action_key', async () => {
  const source = await readFile(mobileJsPath, 'utf8');

  assert.ok(source.includes('"meal_plan.adjust_for_condition": "按健康状况调整"'));
  assert.ok(source.includes('action = localizeActionItem(action);'));
  assert.equal(source.includes('item.label || item.action_key'), false);
  assert.equal(source.includes('action.label || action.action_key'), false);
  assert.equal(source.includes('action.user_prompt || action.label || action.action_key'), false);
});

test('mobile handles SOS phone actions without sending them to the backend first', async () => {
  const source = await readFile(mobileJsPath, 'utf8');

  assert.ok(source.includes('function isLikelyDialCapableDevice'));
  assert.ok(source.includes('handlePhoneDial(phone'));
  assert.ok(source.includes('handleSosPhoneAction(action'));
  assert.ok(source.includes('if (isSosPhoneAction(action) && this.handleSosPhoneAction(action)) return;'));
  assert.ok(source.includes('当前浏览器无法直接拨号，请使用手机拨打 120'));
  assert.ok(source.includes('type === \'flattalk_phone_dial\''));
});

test('mobile conversation backend sync is compact and backs off on failures', async () => {
  const source = await readFile(mobileJsPath, 'utf8');

  assert.ok(source.includes('function serializeConversationForSync'));
  assert.ok(source.includes('function serializeMessageForSync'));
  assert.ok(source.includes('serializeConversationForSync(c, this.auth)'));
  assert.ok(source.includes('this._syncInFlight'));
  assert.ok(source.includes('this._syncDisabledUntil'));
  assert.ok(source.includes('BACKEND_SYNC_MAX_BACKOFF_MS'));
  assert.equal(source.includes('messages: c.messages'), false);
});
