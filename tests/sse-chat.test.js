import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeChatSse, wantsChatSse } from '../src/server/sse-chat.js';

test('serializeChatSse emits stream_events then envelope', () => {
  const envelope = {
    ok: true,
    data: {
      stream_events: [
        { event: 'map_point', payload: { order: 1, name: '百鸟岩' } },
        { event: 'done', payload: { counts: { points: 1 } } },
      ],
    },
  };
  const text = serializeChatSse(envelope);
  assert.equal(
    text,
    [
      'event: map_point\ndata: {"order":1,"name":"百鸟岩"}\n\n',
      'event: done\ndata: {"counts":{"points":1}}\n\n',
      `event: envelope\ndata: ${JSON.stringify(envelope)}\n\n`,
    ].join(''),
  );
});

test('serializeChatSse works without stream_events', () => {
  const envelope = { ok: true, data: {} };
  const text = serializeChatSse(envelope);
  assert.equal(text, `event: envelope\ndata: ${JSON.stringify(envelope)}\n\n`);
});

test('wantsChatSse detects stream=1 and Accept', () => {
  assert.equal(
    wantsChatSse({ url: '/api/chat/message?stream=1', headers: {} }),
    true,
  );
  assert.equal(
    wantsChatSse({ url: '/api/chat/message', headers: { accept: 'text/event-stream' } }),
    true,
  );
  assert.equal(
    wantsChatSse({ url: '/api/chat/message', headers: { accept: 'application/json' } }),
    false,
  );
});
