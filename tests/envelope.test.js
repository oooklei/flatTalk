import assert from "node:assert/strict";
import test from "node:test";

import { buildEnvelope, validateEnvelope } from "../src/contracts/envelope.js";

test("buildEnvelope creates required Envelope v1 fields and validateEnvelope passes when required fields supplied", () => {
  const envelope = buildEnvelope({
    conversation_id: "conv_123",
    answer_text: "Hello",
    data: { message: "Hello" },
  });

  assert.equal(envelope.schema, "gxy.envelope.v1");
  assert.equal(envelope.ok, true);
  assert.match(envelope.request_id, /^req_/);
  assert.equal(envelope.conversation_id, "conv_123");
  assert.match(envelope.turn_id, /^turn_/);
  assert.equal(envelope.skill_key, "common");
  assert.equal(envelope.intent, "common.chat");
  assert.equal(envelope.template_id, "common.answer.v1");
  assert.equal(envelope.template_key, "common.answer.v1");
  assert.equal(envelope.render_mode, "frontend_template");
  assert.equal(envelope.answer_text, "Hello");
  assert.deepEqual(envelope.data, { message: "Hello" });
  assert.deepEqual(envelope.actions, []);
  assert.deepEqual(envelope.followup_suggestions, []);
  assert.deepEqual(envelope.evidence, []);
  assert.deepEqual(envelope.route, { source: "flatTalk", confidence: 0 });
  assert.equal(envelope.error, null);
  assert.doesNotThrow(() => new Date(envelope.created_at).toISOString());

  assert.deepEqual(validateEnvelope(envelope), { ok: true, errors: [] });
});

test("validateEnvelope rejects missing conversation_id", () => {
  const envelope = buildEnvelope({ answer_text: "Hello" });

  const result = validateEnvelope(envelope);

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /conversation_id is required/);
});

test("validateEnvelope rejects invalid schema", () => {
  const envelope = buildEnvelope({
    conversation_id: "conv_123",
    answer_text: "Hello",
    schema: "wrong.schema",
  });
  envelope.schema = "wrong.schema";

  const result = validateEnvelope(envelope);

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /schema must equal gxy\.envelope\.v1/);
});

test("validateEnvelope rejects non-array actions and followup_suggestions", () => {
  const envelope = buildEnvelope({
    conversation_id: "conv_123",
    answer_text: "Hello",
  });
  envelope.actions = {};
  envelope.followup_suggestions = "next";

  const result = validateEnvelope(envelope);

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /actions must be an array/);
  assert.match(result.errors.join("\n"), /followup_suggestions must be an array/);
});

test("validateEnvelope rejects non-object inputs without throwing", () => {
  assert.deepEqual(validateEnvelope(null), { ok: false, errors: ["envelope_must_be_object"] });
  assert.deepEqual(validateEnvelope("bad"), { ok: false, errors: ["envelope_must_be_object"] });
  assert.deepEqual(validateEnvelope([]), { ok: false, errors: ["envelope_must_be_object"] });
});

test("validateEnvelope rejects invalid action entries with indexed errors", () => {
  const envelope = buildEnvelope({
    conversation_id: "conv_123",
    answer_text: "Hello",
    actions: [
      { action_key: "", label: "", params: [] },
      "bad",
      { action_key: "open", label: "Open", params: { id: 1 } },
    ],
  });

  const result = validateEnvelope(envelope);

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("actions[0].action_key_required"));
  assert.ok(result.errors.includes("actions[0].label_required"));
  assert.ok(result.errors.includes("actions[0].params_must_be_object"));
  assert.ok(result.errors.includes("actions[1].must_be_object"));
});

test("validateEnvelope rejects invalid followup entries with indexed errors", () => {
  const envelope = buildEnvelope({
    conversation_id: "conv_123",
    answer_text: "Hello",
    followup_suggestions: [
      { label: "", user_prompt: "", action_key: 123 },
      "bad",
      { label: "More", user_prompt: "Tell me more", action_key: "more" },
    ],
  });

  const result = validateEnvelope(envelope);

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("followup_suggestions[0].label_required"));
  assert.ok(result.errors.includes("followup_suggestions[0].user_prompt_required"));
  assert.ok(result.errors.includes("followup_suggestions[0].action_key_must_be_string"));
  assert.ok(result.errors.includes("followup_suggestions[1].must_be_object"));
});

test("buildEnvelope normalizes non-array actions and followups to empty arrays", () => {
  const envelope = buildEnvelope({
    conversation_id: "conv_123",
    answer_text: "Hello",
    actions: "open",
    followup_suggestions: { text: "More" },
  });

  assert.deepEqual(envelope.actions, []);
  assert.deepEqual(envelope.followup_suggestions, []);
});
