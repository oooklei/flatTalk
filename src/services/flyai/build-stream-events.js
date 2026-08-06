/**
 * Normalize waypoints: 1-based sequential order when missing; Day1 when day missing.
 * @param {Array<object>} waypoints
 * @returns {Array<object>}
 */
export function normalizeWaypointsForStream(waypoints = []) {
  return (Array.isArray(waypoints) ? waypoints : []).map((wp, index) => {
    const orderNum = Number(wp?.order);
    const order = Number.isFinite(orderNum) && orderNum > 0 ? orderNum : index + 1;
    return {
      ...wp,
      order,
      day: wp?.day || 'Day1',
    };
  });
}

/**
 * Build map-ordered SSE events: route_meta → product_meta → (map_point* → itinerary_day)* → done.
 * map_point sequence follows waypoints order within each day group (insertion order of days).
 * @param {object} doc
 * @returns {Array<{ event: string, payload: object }>}
 */
export function buildMapOrderedStreamEvents(doc = {}) {
  const waypoints = normalizeWaypointsForStream(doc.waypoints);
  const events = [
    {
      event: 'route_meta',
      payload: {
        title: doc.title,
        linked_route_id: doc.linked_route_id,
        source: 'flyai',
      },
    },
    {
      event: 'product_meta',
      payload: { products: (doc.products || []).slice(0, 5) },
    },
  ];

  const byDay = new Map();
  for (const wp of waypoints) {
    const day = wp.day || 'Day1';
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(wp);
  }

  for (const [day, points] of byDay) {
    for (const wp of points) {
      events.push({
        event: 'map_point',
        payload: {
          order: wp.order,
          name: wp.name,
          day,
          lat: wp.lat,
          lng: wp.lng,
        },
      });
    }
    events.push({
      event: 'itinerary_day',
      payload: {
        day,
        point_orders: points.map((p) => p.order),
        summary: points.map((p) => p.name).join('、'),
      },
    });
  }

  events.push({
    event: 'done',
    payload: {
      counts: { points: waypoints.length },
      from_cache: doc.from_cache !== false,
    },
  });

  return events;
}
