import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupervisor } from '../src/core/agents/supervisor.js';
import { runLocalSkill } from '../src/runtime/local-skill-runtime.js';
import { createLisClient } from '../src/core/lis/lis-client.js';
import { getLisBaseUrl, loadCatalogEntries } from '../src/core/lis/lis-gate-hook.js';

test('supervisor: 舌诊详情 should prefer health_risk_warning over dispatch', async () => {
  const supervisor = createSupervisor();
  const route = await supervisor.route({ message: '舌诊详情', context: {} });
  assert.equal(route.agentKey, 'health_risk_warning');
});

test('chat path: 舌诊详情 routes to tongue_diagnosis_card (not dispatch_detail)', async (t) => {
  process.env.LIS_GATE_ENABLED = '1';
  const base = getLisBaseUrl();
  const probe = await createLisClient({ baseUrl: base }).probe();
  if (!probe.reachable) {
    t.skip('LIS unreachable');
    return;
  }

  const envelope = await runLocalSkill(
    {
      conversation_id: `tongue-route-${Date.now()}`,
      turn_id: 't1',
      message: '舌诊详情',
      role: 'elder_family',
      skill_key: '',
      context: {},
    },
    {
      lisClient: createLisClient({ baseUrl: base }),
      session: { conversation_id: `tongue-route-${Date.now()}`, turns: [], global_context: {} },
      catalogEntries: loadCatalogEntries(),
    },
  );

  assert.equal(envelope.skill_key, 'health_risk_warning');
  assert.equal(envelope.template_id, 'tongue_diagnosis_card');
  assert.notEqual(envelope.template_id, 'dispatch_detail');
});
