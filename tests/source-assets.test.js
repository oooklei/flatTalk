import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  assertCopyDestinationInside,
  assertSafeAssetRoot,
  isExcludedPath,
  sanitizeRegistryJson,
} from "../scripts/copy-source-assets.js";

const blockedName = ["code", "plugin"].join("");
const blockedDashedName = ["code", "plugin"].join("-");

test("copy exclusions match mixed-case blocked directory names", () => {
  assert.equal(isExcludedPath(path.join("data", "DIST", "file.json")), true);
  assert.equal(isExcludedPath(path.join("skill-packages", "Node_Modules", "lib.js")), true);
});

test("copy exclusions match capability plugin names case-insensitively", () => {
  assert.equal(isExcludedPath(path.join("data", `Code${blockedName.slice(4)}.json`)), true);
  assert.equal(isExcludedPath(path.join("data", `${blockedDashedName}-config.json`)), true);
});

test("asset root safety rejects broad or unrelated delete targets", () => {
  const legacyDir = path.resolve("D:\\GuiCare", ["gui", "xiaoyang-chat-system"].join(""));

  assert.throws(() => assertSafeAssetRoot(path.resolve("D:\\GuiCare\\flatTalk"), legacyDir), /Unsafe/);
  assert.throws(() => assertSafeAssetRoot(path.resolve("D:\\GuiCare"), legacyDir), /Unsafe/);
  assert.throws(() => assertSafeAssetRoot(legacyDir, legacyDir), /Unsafe/);
  assert.throws(() => assertSafeAssetRoot(path.parse(process.cwd()).root, legacyDir), /Unsafe/);
  assert.doesNotThrow(() =>
    assertSafeAssetRoot(path.resolve("D:\\GuiCare\\flatTalk\\assets\\source-copies"), legacyDir),
  );
});

test("copy destination must stay inside the asset root", () => {
  const assetDir = path.resolve("D:\\GuiCare\\flatTalk\\assets\\source-copies");

  assert.doesNotThrow(() => assertCopyDestinationInside(assetDir, path.join(assetDir, "data", "file.json")));
  assert.throws(() => assertCopyDestinationInside(assetDir, path.resolve("D:\\GuiCare\\flatTalk\\data.json")), /escapes/);
});

test("registry sanitizer removes plugin-coupled entries and preserves normal entries", () => {
  const input = {
    actions: [
      { key: "normal_action", type: "local_event", value: 1 },
      { key: `${blockedName}_adapter`, type: "local_event", value: 2 },
      { key: "weather_lookup", type: `${blockedName}_event`, value: 3 },
      { key: "meal_plan", nested: { capability: "normal_capability" } },
    ],
    capabilities: {
      normal: { id: "normal", action: "local_call" },
      coupled: { id: "legacy", capability: `${blockedDashedName}_bridge` },
    },
    [`${blockedName}_key`]: { id: "top_level" },
  };

  const result = sanitizeRegistryJson(input);

  assert.equal(result.removed, 4);
  assert.deepEqual(result.value, {
    actions: [
      { key: "normal_action", type: "local_event", value: 1 },
      { key: "meal_plan", nested: { capability: "normal_capability" } },
    ],
    capabilities: {
      normal: { id: "normal", action: "local_call" },
    },
  });
});
