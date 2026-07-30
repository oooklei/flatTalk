import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';

test('chat message endpoint returns meal_plan envelope', async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const response = await fetch(`${baseUrl}/api/chat/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: 'req_app_1',
        conversation_id: 'conv_app_1',
        turn_id: 'turn_app_1',
        message: '糖尿病老人早餐怎么吃',
        role: 'elder_family',
      }),
    });
    const envelope = await response.json();

    assert.equal(response.status, 200);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.template_id, 'diet_card');
    assert.equal(envelope.conversation_id, 'conv_app_1');
    assert.equal(envelope.llm.template_id, 'diet_card');
    assert.equal(envelope.card.templateId, 'diet_card');
    assert.ok(envelope.card.pages[0].includes('<!doctype html>'));
    assert.ok(envelope.rendered_html.includes('gxy-html-fallback'));
    assert.ok(envelope.rendered_html.includes('data-renderer="template-card-renderer"'));
  } finally {
    await close();
  }
});

test('chat message endpoint returns travel_route envelope', async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const response = await fetch(`${baseUrl}/api/chat/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: 'req_app_travel_1',
        conversation_id: 'conv_app_travel_1',
        turn_id: 'turn_app_travel_1',
        message: '帮老人规划广西巴马康养旅居路线',
        role: 'elder_family',
      }),
    });
    const envelope = await response.json();

    assert.equal(response.status, 200);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.skill_key, 'travel_route');
    assert.equal(envelope.template_id, 'route_card');
    assert.equal(envelope.card.templateId, 'route_card');
    assert.ok(envelope.rendered_html.includes('gxy-html-fallback'));
  } finally {
    await close();
  }
});

test('chat message endpoint routes baise bama tourism request to travel_route', async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const response = await fetch(`${baseUrl}/api/chat/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        request_id: 'req_app_travel_bama_tourism',
        conversation_id: 'conv_app_travel_bama_tourism',
        turn_id: 'turn_app_travel_bama_tourism',
        message: '\u6211\u60f3\u53bb\u767e\u8272\u5df4\u9a6c\u65c5\u6e38\uff0c\u8bf7\u5e2e\u89c4\u5212\u8def\u7ebf',
        role: 'elder_family',
      }),
    });
    const envelope = await response.json();

    assert.equal(response.status, 200);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.skill_key, 'travel_route');
    assert.equal(envelope.template_id, 'route_card');
    assert.equal(envelope.intent, 'travel_route_plan');
    assert.equal(envelope.route.scene_key, 'travel_route');
    assert.equal(envelope.route.routed, true);
  } finally {
    await close();
  }
});

test('chat message endpoint routes short baise travel route reference to travel_route', async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const response = await fetch(`${baseUrl}/api/chat/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        request_id: 'req_app_travel_baise_short',
        conversation_id: 'conv_app_travel_baise_short',
        turn_id: 'turn_app_travel_baise_short',
        message: '\u767e\u8272\u65c5\u884c\u8def\u7ebf\u53c2\u8003',
        role: 'elder_family',
      }),
    });
    const envelope = await response.json();

    assert.equal(response.status, 200);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.skill_key, 'travel_route');
    assert.equal(envelope.template_id, 'route_card');
    assert.equal(envelope.route.scene_key, 'travel_route');
    assert.equal(envelope.route.routed, true);
  } finally {
    await close();
  }
});

test('chat message endpoint routes short generic travel planning request to travel_route', async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const response = await fetch(`${baseUrl}/api/chat/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        request_id: 'req_app_travel_generic_short',
        conversation_id: 'conv_app_travel_generic_short',
        turn_id: 'turn_app_travel_generic_short',
        message: '\u5e2e\u6211\u89c4\u5212\u65c5\u5c45\u8def\u7ebf',
        role: 'elder_family',
      }),
    });
    const envelope = await response.json();

    assert.equal(response.status, 200);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.skill_key, 'travel_route');
    assert.equal(envelope.template_id, 'route_card');
    assert.equal(envelope.intent, 'travel_route_plan');
    assert.equal(envelope.route.scene_key, 'travel_route');
    assert.equal(envelope.route.routed, true);
  } finally {
    await close();
  }
});

test('chat message endpoint routes assistant usage to policy_card', async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const response = await fetch(`${baseUrl}/api/chat/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: 'req_app_usage_1',
        conversation_id: 'conv_app_usage_1',
        turn_id: 'turn_app_usage_1',
        message: '养老助手怎么用?',
        role: 'elder_family',
      }),
    });
    const envelope = await response.json();

    assert.equal(response.status, 200);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.skill_key, 'common');
    assert.equal(envelope.intent, 'elder_assistant_usage');
    assert.equal(envelope.template_id, 'policy_card');
    assert.equal(envelope.card.templateId, 'policy_card');
    assert.deepEqual(envelope.actions, []);
    assert.ok(envelope.answer_text.includes('桂小养养老助手'));
  } finally {
    await close();
  }
});

test('followup endpoint carries previous scene context', async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    await fetch(`${baseUrl}/api/chat/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conversation_id: 'conv_follow_1',
        message: '糖尿病老人早餐怎么吃',
        role: 'elder_family',
      }),
    });
    const response = await fetch(`${baseUrl}/api/chat/followup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conversation_id: 'conv_follow_1',
        user_prompt: '换成一周计划',
        role: 'elder_family',
      }),
    });
    const envelope = await response.json();

    assert.equal(response.status, 200);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.skill_key, 'meal_plan');
  } finally {
    await close();
  }
});

test('followup reenter chat does not force stale skill metadata', async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    await fetch(`${baseUrl}/api/chat/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conversation_id: 'conv_follow_reenter_1',
        message: '推荐今日膳食',
        role: 'elder_family',
      }),
    });
    const response = await fetch(`${baseUrl}/api/chat/followup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conversation_id: 'conv_follow_reenter_1',
        user_prompt: '今天社区活动几点开始',
        skill_key: 'meal_plan',
        action_key: 'community.activity.lookup',
        unsupported_action_key: 'community.activity.lookup',
        execute_action: false,
        reenter_chat: true,
        role: 'elder_family',
      }),
    });
    const envelope = await response.json();

    assert.equal(response.status, 200);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.skill_key, 'common');
    assert.equal(envelope.template_id, 'answer');
  } finally {
    await close();
  }
});

test('followup reenter chat can still route by prompt text', async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    await fetch(`${baseUrl}/api/chat/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conversation_id: 'conv_follow_reenter_2',
        message: '推荐今日膳食',
        role: 'elder_family',
      }),
    });
    const response = await fetch(`${baseUrl}/api/chat/followup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conversation_id: 'conv_follow_reenter_2',
        user_prompt: '换成一周计划',
        skill_key: 'meal_plan',
        execute_action: false,
        reenter_chat: true,
        role: 'elder_family',
      }),
    });
    const envelope = await response.json();

    assert.equal(response.status, 200);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.skill_key, 'meal_plan');
    assert.equal(envelope.template_id, 'weekly_plan');
  } finally {
    await close();
  }
});

test('conversation history sync list delete and harvest endpoints persist payloads', async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const syncResponse = await fetch(`${baseUrl}/api/conversation/sync-batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conversations: [{
          id: 'mconv_http_1',
          title: '推荐今日膳食',
          status: '已答复',
          favorite: false,
          latestQuestion: '推荐今日膳食',
          latestAnswer: '已生成膳食方案',
          messages: [
            { role: 'user', content: '推荐今日膳食', at: 1 },
            { role: 'ai', content: '已生成膳食方案', at: 2 },
          ],
          roleKey: 'elder_family',
        }],
      }),
    });
    const synced = await syncResponse.json();
    assert.equal(syncResponse.status, 200);
    assert.equal(synced.synced_count, 1);

    const listResponse = await fetch(`${baseUrl}/api/conversation/list`);
    const listed = await listResponse.json();
    const item = listed.conversations.find((conversation) => conversation.conversation_id === 'mconv_http_1');
    assert.ok(item);
    assert.equal(JSON.parse(item.messages).messages[0].content, '推荐今日膳食');

    const harvestResponse = await fetch(`${baseUrl}/api/conversation/harvest-sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: 'mconv_http_1' }),
    });
    const harvest = await harvestResponse.json();
    assert.equal(harvestResponse.status, 200);
    assert.equal(harvest.harvest.synced, true);

    const deleteResponse = await fetch(`${baseUrl}/api/conversation/delete/mconv_http_1`, { method: 'DELETE' });
    const deleted = await deleteResponse.json();
    assert.equal(deleteResponse.status, 200);
    assert.equal(deleted.ok, true);

    const afterDeleteResponse = await fetch(`${baseUrl}/api/conversation/list`);
    const afterDelete = await afterDeleteResponse.json();
    assert.equal(afterDelete.conversations.some((conversation) => conversation.conversation_id === 'mconv_http_1'), false);
  } finally {
    await close();
  }
});

test('chat action uses previous turn context and is appended to session history', async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    await fetch(`${baseUrl}/api/chat/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conversation_id: 'conv_action_context_1',
        message: '推荐今日膳食',
        role: 'elder_family',
      }),
    });

    const actionResponse = await fetch(`${baseUrl}/api/chat/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conversation_id: 'conv_action_context_1',
        action_key: 'meal_plan.generate_weekly_plan',
        user_prompt: '生成一周计划',
        role: 'elder_family',
      }),
    });
    const action = await actionResponse.json();
    assert.equal(actionResponse.status, 200);
    assert.equal(action.ok, true);
    assert.equal(action.result_type, 'skill_run');
    assert.equal(action.envelope.skill_key, 'meal_plan');
    assert.equal(action.envelope.route.intent_context.model_path.includes('rules'), true);

    const listResponse = await fetch(`${baseUrl}/api/conversation/list`);
    const listed = await listResponse.json();
    const item = listed.conversations.find((conversation) => conversation.conversation_id === 'conv_action_context_1');
    assert.equal(item.turn_count, 2);
  } finally {
    await close();
  }
});

test('client config returns all copied dev SSO presets', async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const response = await fetch(`${baseUrl}/api/client-config`);
    const config = await response.json();
    const keys = config.devSsoPresets.map((preset) => preset.key);

    assert.equal(response.status, 200);
    assert.equal(config.ok, true);
    assert.equal(config.devSsoPresets.length, 8);
    assert.deepEqual(keys, [
      'c_elder',
      'c_family',
      'g_civil_affairs_staff',
      'g_grid_worker',
      'b_institution_admin',
      'c_care_worker',
      'c_village_doctor',
      'system_admin',
    ]);
  } finally {
    await close();
  }
});

test('dev SSO login uses copied preset token and role metadata', async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const response = await fetch(`${baseUrl}/api/sso/dev-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ presetKey: 'g_grid_worker' }),
    });
    const login = await response.json();

    assert.equal(response.status, 200);
    assert.equal(login.ok, true);
    assert.equal(login.presetKey, 'g_grid_worker');
    assert.equal(login.userToken, 'dev-sso-grid-worker-test');
    assert.equal(login.roleKey, 'grid_worker');
  } finally {
    await close();
  }
});

test('backend exposes table data CRUD endpoints', async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const createResponse = await fetch(`${baseUrl}/api/data/tables/meal_rules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'low_fat', text: 'low fat rule' }),
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 201);
    assert.equal(created.item.key, 'low_fat');

    const updateResponse = await fetch(`${baseUrl}/api/data/tables/meal_rules/low_fat`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'updated low fat rule' }),
    });
    const updated = await updateResponse.json();
    assert.equal(updateResponse.status, 200);
    assert.equal(updated.item.text, 'updated low fat rule');

    const listResponse = await fetch(`${baseUrl}/api/data/tables/meal_rules`);
    const list = await listResponse.json();
    assert.equal(list.ok, true);
    assert.equal(list.items.some((item) => item.key === 'low_fat'), true);
  } finally {
    await close();
  }
});

test('backend exposes knowledge document CRUD and search endpoints', async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const createResponse = await fetch(`${baseUrl}/api/data/knowledge/documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        document_id: 'doc_api_1',
        skill_key: 'meal_plan',
        title: 'protein',
        text: 'protein and fiber for breakfast',
      }),
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 201);
    assert.equal(created.item.document_id, 'doc_api_1');

    const searchResponse = await fetch(`${baseUrl}/api/data/knowledge/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skill_key: 'meal_plan', query: 'protein breakfast', limit: 5 }),
    });
    const search = await searchResponse.json();
    assert.equal(search.ok, true);
    assert.equal(search.matches.some((item) => item.document_id === 'doc_api_1'), true);

    const deleteResponse = await fetch(`${baseUrl}/api/data/knowledge/documents/doc_api_1`, {
      method: 'DELETE',
    });
    const deleted = await deleteResponse.json();
    assert.equal(deleteResponse.status, 200);
    assert.equal(deleted.ok, true);
  } finally {
    await close();
  }
});

test('backend exposes action, OpenAPI, interface status, and skill template endpoints', async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const actionResponse = await fetch(`${baseUrl}/api/chat/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action_key: 'meal_plan.generate_weekly_plan',
        conversation_id: 'conv_action_1',
        params: { elder_id: 'demo_elder_1' },
      }),
    });
    const action = await actionResponse.json();
    assert.equal(actionResponse.status, 200);
    assert.equal(action.ok, true);
    assert.equal(action.result_type, 'skill_run');
    assert.equal(action.envelope.template_id, 'weekly_plan');

    const openApiResponse = await fetch(`${baseUrl}/api/open/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...openApiAuthHeader(),
      },
      body: JSON.stringify({
        model: 'flatTalk-test',
        skill_key: 'meal_plan',
        messages: [{ role: 'user', content: 'diabetes breakfast meal plan' }],
      }),
    });
    const openApi = await openApiResponse.json();
    assert.equal(openApiResponse.status, 200);
    assert.equal(openApi.choices[0].message.role, 'assistant');
    assert.equal(openApi.flatTalk.template_id, 'diet_card');

    const interfaceResponse = await fetch(`${baseUrl}/api/data/interfaces/status`);
    const interfaces = await interfaceResponse.json();
    assert.equal(interfaceResponse.status, 200);
    assert.equal(interfaces.ok, true);
    assert.equal(typeof interfaces.services.httpClient, 'boolean');

    const templateResponse = await fetch(`${baseUrl}/api/skills/meal_plan/templates`);
    const templates = await templateResponse.json();
    assert.equal(templateResponse.status, 200);
    assert.equal(templates.items.some((item) => item.id === 'diet_card'), true);
  } finally {
    await close();
  }
});

test('backend exposes intent classify and health endpoints', async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const classifyResponse = await fetch(`${baseUrl}/api/intent/classify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '老人胸痛喘不过气' }),
    });
    const classified = await classifyResponse.json();
    assert.equal(classifyResponse.status, 200);
    assert.equal(classified.ok, true);
    assert.equal(classified.intent_context.intent_type, 'SOS');

    const healthResponse = await fetch(`${baseUrl}/api/intent/health`);
    const health = await healthResponse.json();
    assert.equal(healthResponse.status, 200);
    assert.equal(health.ok, true);
    assert.equal(health.classifier, 'rules');
  } finally {
    await close();
  }
});

async function startTestServer() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const server = http.createServer(createApp({ runtimeMode: 'test' }));
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

function openApiAuthHeader() {
  const keysPath = path.join(process.cwd(), 'data', 'api-keys.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
    const key = parsed.items?.find((item) => item.enabled !== false)?.key;
    return key ? { 'x-api-key': key } : {};
  } catch {
    return {};
  }
}
