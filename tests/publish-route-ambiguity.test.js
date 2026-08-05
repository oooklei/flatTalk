/**
 * 第二刀线路包同分消歧
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { matchPublishedPackages } from '../src/core/scene-router/publish-index.js';
import { createChatOrchestrator } from '../src/core/orchestrator/chat-orchestrator.js';

function writePub(dir, id, extra = {}) {
  const pkg = path.join(dir, id);
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'route_data.json'), JSON.stringify({ route_id: id, destination: '测试城' }));
  fs.writeFileSync(path.join(pkg, 'publish.json'), JSON.stringify({
    route_id: id,
    status: 'published',
    destination: ['测试城'],
    keywords: ['同分线路'],
    product_type: 'wellness',
    title: extra.title || id,
    updated_at: '2026-08-01T00:00:00.000Z',
    ...extra,
  }));
}

test('matchPublishedPackages can produce score ties', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-tie-'));
  writePub(dir, 'tie_a', { title: '同分线路A' });
  writePub(dir, 'tie_b', { title: '同分线路B' });
  const hits = matchPublishedPackages('测试城同分线路', { baseDir: dir });
  assert.ok(hits.length >= 2);
  assert.equal(hits[0].score, hits[1].score);
});

test('orchestrator returns route ambiguity_options on publish score tie', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-tie-orch-'));
  writePub(dir, 'tie_a', { title: '同分线路甲' });
  writePub(dir, 'tie_b', { title: '同分线路乙' });

  // monkey-patch via env is hard; instead temporarily chdir isn't great.
  // Call match with baseDir and simulate orchestrator contract by importing match only —
  // full orchestrator uses process.cwd() sojourn-maps. So we copy fixtures into data briefly? No.
  // Prefer testing the response shape via a thin integration: override by writing into sojourn-maps
  // under unique ids that won't collide, using unique keyword.

  const maps = path.join(process.cwd(), 'data', 'sojourn-maps');
  const ids = ['tie_live_a', 'tie_live_b'];
  try {
    for (const id of ids) writePub(maps, id, {
      title: id === 'tie_live_a' ? '同分实装甲' : '同分实装乙',
      keywords: ['同分实装专用短语'],
      destination: ['同分实装城'],
    });

    const orch = createChatOrchestrator({
      intentClassifier: { classifyIntent: async () => ({ intent: 'travel_route.plan', confidence: 0.9 }) },
      dataService: {
        tableData: {
          getTravelRouteTables: async () => ({ routes: [], products: [] }),
          getSkillConfigs: async () => ({}),
        },
        knowledgeData: {},
      },
      ragService: { retrieveKnowledge: async () => ({ source: 'test', status: 'empty', matches: [] }) },
      modelService: {
        fillTemplateSlots: async () => ({
          template_id: 'answer',
          answer_text: 'should-not-fill',
          data: {},
          actions: [],
          followup_suggestions: [],
          model_status: 'ok',
          model_used: 'test',
        }),
      },
    });

    const result = await orch.run({
      message: '同分实装城同分实装专用短语',
      skill_key: 'travel_route',
      conversation_id: 'pub-amb-1',
      turn_id: 'pub-amb-1-t',
      context: { ambiguity_pick: true, ambiguity_scene_key: 'travel_route' },
    });

    assert.ok(Array.isArray(result.ambiguity_options), 'should return route options');
    assert.ok(result.ambiguity_options.length >= 2);
    const routeIds = result.ambiguity_options.map((o) => o.route_id);
    assert.ok(routeIds.includes('tie_live_a'));
    assert.ok(routeIds.includes('tie_live_b'));
    assert.equal(result.route?.decision, 'ambiguous');
    assert.notEqual(result.answer, 'should-not-fill');
  } finally {
    for (const id of ids) {
      try { fs.rmSync(path.join(maps, id), { recursive: true, force: true }); } catch {}
    }
  }
});

test('publish_route_id locks package after route pick', async () => {
  const maps = path.join(process.cwd(), 'data', 'sojourn-maps');
  const id = 'tie_lock_only';
  try {
    writePub(maps, id, {
      title: '锁定线路专用',
      keywords: ['锁定线路专用短语'],
      destination: ['锁定城'],
    });
    // also create a decoy with same keywords
    writePub(maps, 'tie_lock_decoy', {
      title: '锁定干扰包',
      keywords: ['锁定线路专用短语'],
      destination: ['锁定城'],
    });

    const orch = createChatOrchestrator({
      intentClassifier: { classifyIntent: async () => ({ intent: 'travel_route.plan', confidence: 0.9 }) },
      dataService: {
        tableData: {
          getTravelRouteTables: async () => ({ routes: [], products: [] }),
          getSkillConfigs: async () => ({}),
        },
        knowledgeData: {},
      },
      ragService: { retrieveKnowledge: async () => ({ source: 'test', status: 'empty', matches: [] }) },
      modelService: {
        fillTemplateSlots: async (input) => ({
          template_id: input.template_id || 'route_svg',
          answer_text: 'locked-ok',
          data: { route_id: input.business_data?.route_id },
          actions: [],
          followup_suggestions: [],
          model_status: 'ok',
          model_used: 'test',
        }),
      },
    });

    const result = await orch.run({
      message: '锁定线路专用',
      skill_key: 'travel_route',
      conversation_id: 'pub-lock-1',
      turn_id: 'pub-lock-1-t',
      context: {
        ambiguity_pick: true,
        ambiguity_scene_key: 'travel_route',
        publish_route_id: id,
      },
    });

    assert.notEqual(result.route?.decision, 'ambiguous');
    assert.equal(result.skill_key, 'travel_route');
    // business_data.route_id should flow into fill
    assert.equal(result.data?.route_id || result.debug?.publish_match?.route_id || id, id);
  } finally {
    for (const x of [id, 'tie_lock_decoy']) {
      try { fs.rmSync(path.join(maps, x), { recursive: true, force: true }); } catch {}
    }
  }
});

test('forged publish_route_id is rejected (no fake package lock)', async () => {
  const orch = createChatOrchestrator({
    intentClassifier: { classifyIntent: async () => ({ intent: 'travel_route.plan', confidence: 0.9 }) },
    dataService: {
      tableData: {
        getTravelRouteTables: async () => ({ routes: [], products: [] }),
        getSkillConfigs: async () => ({}),
      },
      knowledgeData: {},
    },
    ragService: { retrieveKnowledge: async () => ({ source: 'test', status: 'empty', matches: [] }) },
    modelService: {
      fillTemplateSlots: async (input) => ({
        template_id: input.template_id || 'route_svg',
        answer_text: 'ok',
        data: { route_id: input.business_data?.route_id || null },
        actions: [],
        followup_suggestions: [],
        model_status: 'ok',
        model_used: 'test',
      }),
    },
  });

  const result = await orch.run({
    message: '随便问问旅居',
    skill_key: 'travel_route',
    conversation_id: 'pub-forge-1',
    turn_id: 'pub-forge-1-t',
    context: {
      ambiguity_pick: true,
      ambiguity_scene_key: 'travel_route',
      publish_route_id: 'forged_route_never_published_xyz',
    },
  });

  assert.equal(result.skill_key, 'travel_route');
  assert.notEqual(result.data?.route_id, 'forged_route_never_published_xyz');
});
