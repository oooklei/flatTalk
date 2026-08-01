import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { dispatchAction } from '../src/core/actions/action-dispatcher.js';
import { loadEnv } from '../src/config/env.js';
import { TABLE_SCHEMAS } from '../src/services/table-data/schemas.js';

test('env exposes main chain configuration fields', () => {
  const env = loadEnv();
  for (const key of [
    'host',
    'port',
    'runtimeMode',
    'pgUrl',
    'redisUrl',
    'knowledgeBaseUrl',
    'knowledgeApiKey',
    'knowledgeSpace',
    'modelMode',
    'openaiBaseUrl',
    'openaiApiKey',
    'openaiModel',
  ]) {
    assert.ok(Object.hasOwn(env, key), key);
  }
});

test('table schemas include planned PG-backed runtime tables', () => {
  for (const table of [
    'elder_profile',
    'meal_rules',
    'diet_contraindications',
    'gxy_travel_route_plan',
    'model_configs',
    'skill_configs',
    'interface_configs',
    'conversation_turns',
  ]) {
    assert.ok(TABLE_SCHEMAS[table], table);
  }

  const migration = fs.readFileSync(path.join(process.cwd(), 'src/services/table-data/migrations/001_init.sql'), 'utf8');
  const seed = fs.readFileSync(path.join(process.cwd(), 'src/services/table-data/seeds/meal_plan.sql'), 'utf8');
  assert.ok(migration.includes('flattalk_conversation_turns'));
  assert.ok(migration.includes('flattalk_gxy_travel_route_plan'));
  assert.ok(seed.includes('meal_rules'));
  assert.ok(seed.includes('gxy_travel_route_plan'));
});

test('action dispatcher classifies action types', async () => {
  const clientOnly = await dispatchAction({ action_key: 'sos.call_120' });
  assert.equal(clientOnly.action_type, 'client_only');
  assert.equal(clientOnly.result_type, 'client_ack');

  const invalid = await dispatchAction({ action_key: 'orders.create' });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.status, 400);

  const serverSkill = await dispatchAction({ action_key: 'meal_plan.generate_weekly_plan' }, {
    runSkill: async (request) => ({ ok: true, skill_key: request.skill_key, message: request.message }),
  });
  assert.equal(serverSkill.action_type, 'server_skill');
  assert.equal(serverSkill.envelope.skill_key, 'meal_plan');

  const travelSkill = await dispatchAction({ action_key: 'travel_route.compare_destinations' }, {
    runSkill: async (request) => ({ ok: true, skill_key: request.skill_key, message: request.message }),
  });
  assert.equal(travelSkill.action_type, 'server_skill');
  assert.equal(travelSkill.envelope.skill_key, 'travel_route');
});

test('admin table alias and debug API cover the main chain', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flattalk-debug-'));
  const { baseUrl, close } = await startTestServer({
    runtimeMode: 'test',
    loggerOptions: { logPath: path.join(tempDir, 'runtime-events.log') },
  });
  try {
    const createResponse = await fetch(`${baseUrl}/api/admin/table/model_configs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ config_id: 'test_model', provider: 'mock', model_id: 'mock', is_active: true }),
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 201);
    assert.equal(created.item.config_id, 'test_model');

    const patchResponse = await fetch(`${baseUrl}/api/admin/table/model_configs/test_model`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ is_default: false }),
    });
    const patched = await patchResponse.json();
    assert.equal(patchResponse.status, 200);
    assert.equal(patched.item.is_default, false);

    const chatResponse = await fetch(`${baseUrl}/api/chat/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: 'req_debug_1',
        conversation_id: 'conv_debug_1',
        turn_id: 'turn_debug_1',
        skill_key: 'meal_plan',
        message: 'diabetes breakfast meal plan',
        role: 'elder_family',
      }),
    });
    const chat = await chatResponse.json();
    assert.equal(chat.ok, true);

    const debugResponse = await fetch(`${baseUrl}/api/debug/logs?limit=5`);
    const debug = await debugResponse.json();
    assert.equal(debugResponse.status, 200);
    assert.equal(debug.ok, true);
    assert.equal(debug.items.some((item) => item.type === 'chat_turn' && item.request_id === 'req_debug_1'), true);
  } finally {
    await close();
  }
});

async function startTestServer(env = { runtimeMode: 'test' }) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const server = http.createServer(createApp(env));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!isFetchBlockedPort(address.port)) {
      return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
      };
    }
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
  throw new Error('failed to allocate fetch-safe test port');
}

function isFetchBlockedPort(port) {
  return new Set([
    1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
    87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
    139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
    540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720,
    1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
    6669, 6697, 10080,
  ]).has(Number(port));
}
