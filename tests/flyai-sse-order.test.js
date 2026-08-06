import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMapOrderedStreamEvents,
  normalizeWaypointsForStream,
} from '../src/services/flyai/build-stream-events.js';

test('map_point order matches waypoints order', () => {
  const doc = {
    title: '巴马康养线',
    linked_route_id: 'bama_5d4n',
    products: [{ title: '温泉酒店' }],
    waypoints: [
      { name: '百鸟岩景区', day: 'Day1', lat: 24.23, lng: 107.12 },
      { name: '赐福湖', day: 'Day1', lat: 24.24, lng: 107.13 },
      { name: '百魔洞', day: 'Day2', lat: 24.25, lng: 107.14 },
    ],
    from_cache: true,
  };

  const events = buildMapOrderedStreamEvents(doc);
  const mapPoints = events.filter((e) => e.event === 'map_point');

  assert.deepEqual(
    mapPoints.map((e) => e.payload.name),
    ['百鸟岩景区', '赐福湖', '百魔洞'],
  );
  assert.deepEqual(
    mapPoints.map((e) => e.payload.order),
    [1, 2, 3],
  );

  assert.equal(events[0].event, 'route_meta');
  assert.equal(events[1].event, 'product_meta');
  assert.equal(events.at(-1).event, 'done');
  assert.equal(events.at(-1).payload.from_cache, true);
  assert.equal(events.at(-1).payload.counts.points, 3);

  const dayEvents = events.filter((e) => e.event === 'itinerary_day');
  assert.equal(dayEvents.length, 2);
  assert.deepEqual(dayEvents[0].payload.point_orders, [1, 2]);
  assert.deepEqual(dayEvents[1].payload.point_orders, [3]);
});

test('missing order gets sequential 1-based; missing day defaults Day1', () => {
  const normalized = normalizeWaypointsForStream([
    { name: 'A' },
    { name: 'B', order: 9, day: 'Day2' },
    { name: 'C' },
  ]);
  assert.deepEqual(
    normalized.map((w) => ({ name: w.name, order: w.order, day: w.day })),
    [
      { name: 'A', order: 1, day: 'Day1' },
      { name: 'B', order: 9, day: 'Day2' },
      { name: 'C', order: 3, day: 'Day1' },
    ],
  );

  const events = buildMapOrderedStreamEvents({
    title: 't',
    linked_route_id: 'x',
    waypoints: [{ name: 'A' }, { name: 'B' }],
  });
  const mapPoints = events.filter((e) => e.event === 'map_point');
  assert.deepEqual(mapPoints.map((e) => e.payload.order), [1, 2]);
  assert.ok(mapPoints.every((e) => e.payload.day === 'Day1'));
});
