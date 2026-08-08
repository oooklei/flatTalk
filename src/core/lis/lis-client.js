/**
 * Thin HTTP client for LIS-System (/v1/sort, /v1/boundary).
 */

export function createLisClient({ baseUrl, fetchImpl = fetch } = {}) {
  const root = String(baseUrl || process.env.LIS_BASE_URL || 'http://127.0.0.1:8100').replace(
    /\/$/,
    '',
  );

  return {
    async sort(body) {
      const res = await fetchImpl(`${root}/v1/sort`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`LIS sort ${res.status}`);
      return res.json();
    },
    async boundary(body) {
      const res = await fetchImpl(`${root}/v1/boundary`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`LIS boundary ${res.status}`);
      return res.json();
    },
  };
}
