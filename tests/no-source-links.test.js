import assert from "node:assert/strict";
import test from "node:test";

import { scanWorkspaceForSourceLinks } from "../scripts/validate-no-source-links.js";

test("runtime and dev files do not reference the source project directly", async () => {
  const result = await scanWorkspaceForSourceLinks();

  assert.deepEqual(result.violations, []);
  assert.ok(result.checked > 0);
});
