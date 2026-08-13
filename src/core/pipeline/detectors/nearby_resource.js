export async function detectNearby({ login, turn }) {
  const lat = login?.location?.lat;
  const lng = login?.location?.lng;
  if (lat == null || lng == null || turn?.need_location) {
    return {
      ok: false,
      skipped: false,
      need_location: true,
      reason: 'missing_latlng',
      resources: {},
      skill_key: 'nearby_resource',
    };
  }
  return {
    ok: true,
    resources: { lat, lng, source: login.location.source || 'device' },
    skill_key: 'nearby_resource',
  };
}
