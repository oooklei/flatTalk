#!/usr/bin/env node
/**
 * Context Bus 轻量冒烟（不启 HTTP 服务）：safety / limit / ensureLogin skip
 */
import assert from 'node:assert/strict';
import { runSafetyGate } from '../src/core/pipeline/safety-gate.js';
import { assertWithinLimit } from '../src/core/pipeline/input-normalizer.js';
import { runPreRoute } from '../src/core/pipeline/run-pre-route.js';
import { ensureLoginOnSession } from '../src/core/context-bus/ensure-login.js';
import { readBus } from '../src/core/context-bus/store.js';

async function main() {
  const blocked = runSafetyGate('这里有色情暴力内容示范');
  assert.equal(blocked.action, 'block');

  const lim = assertWithinLimit('字'.repeat(501));
  assert.equal(lim.ok, false);

  const session = { conversation_id: 'smoke-cb', turns: [], global_context: {} };
  const pre = await runPreRoute({
    session,
    message: '色情暴力',
    mark: () => {},
  });
  assert.equal(pre.halt, true);

  let calls = 0;
  const reader = {
    async getEntityProfile() {
      calls += 1;
      return { ok: true, data: { entity_type: 'ELDER', entity_id: 'S1', tags: [] } };
    },
  };
  await ensureLoginOnSession(session, { user_id: 'S1', roleId: 'LAO_REN', roleKey: 'elder' }, { tagReader: reader });
  await ensureLoginOnSession(session, { user_id: 'S1', roleId: 'LAO_REN', roleKey: 'elder' }, { tagReader: reader });
  assert.equal(calls, 1);
  assert.equal(readBus(session).login.identity_status, 'confirmed');

  console.log('SMOKE CONTEXT-BUS PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
