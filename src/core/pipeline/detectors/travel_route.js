export async function detectTravelRoute({ utterance, login, turn }) {
  const primary_city = turn?.primary_city ?? null;
  const cities = Array.isArray(turn?.cities) ? turn.cities : [];
  return {
    ok: true,
    resources: {
      primary_city,
      cities,
      route_query: utterance || '',
    },
    skill_key: 'travel_route',
  };
}
