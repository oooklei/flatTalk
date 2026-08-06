import { normalizeFlyaiDoc } from './normalize-flyai-doc.js';

function asMarkdown(data) {
  if (typeof data === 'string') return data;
  if (data == null) return '';
  if (typeof data.markdown === 'string') return data.markdown;
  if (typeof data.content === 'string') return data.content;
  if (typeof data.result === 'string') return data.result;
  return '';
}

function asItemList(data) {
  if (!data) return [];
  if (Array.isArray(data.itemList)) return data.itemList;
  if (Array.isArray(data)) return data;
  return [];
}

/**
 * Keyword / destination / title overlap score in [0, 1].
 * @param {object} doc
 * @param {string} query
 */
export function scoreLocalDoc(doc, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q || !doc) return 0;

  const destination = String(doc.destination || '').trim().toLowerCase();
  if (destination && q.includes(destination)) return 1;

  const title = String(doc.title || '').trim().toLowerCase();
  if (title && (q.includes(title) || title.includes(q))) return 1;

  const docQuery = String(doc.query || '').trim().toLowerCase();
  if (docQuery && (q.includes(docQuery) || docQuery.includes(q))) return 1;

  const keywords = Array.isArray(doc.keywords) ? doc.keywords : [];
  if (keywords.length === 0) return 0;

  let hits = 0;
  for (const kw of keywords) {
    const needle = String(kw || '').trim().toLowerCase();
    if (needle && q.includes(needle)) hits += 1;
  }
  return hits / Math.max(keywords.length, 1);
}

function pickBestLocal(store, query) {
  const docs = typeof store.listDocs === 'function' ? store.listDocs() : [];
  let best = null;
  let bestScore = 0;
  for (const doc of docs) {
    const s = scoreLocalDoc(doc, query);
    if (s > bestScore) {
      bestScore = s;
      best = doc;
    }
  }
  return { doc: best, score: bestScore };
}

/**
 * Local-first FlyAI KB bridge with hit threshold and live upsert.
 * @param {{ store: object, client: object, threshold?: number, normalize?: Function }} opts
 */
export function createFlyaiKnowledgeBridge({
  store,
  client,
  threshold = 0.72,
  normalize = normalizeFlyaiDoc,
} = {}) {
  if (!store) throw new Error('store required');
  if (!client) throw new Error('client required');

  async function fetchLive({ query, linked_route_id, localDoc }) {
    const q = String(query || localDoc?.query || '').trim();
    if (!q) throw new Error('query required for live fetch');

    const destination = localDoc?.destination || q;
    const cityName = localDoc?.city_name || undefined;
    const keywords = localDoc?.keywords;
    const routeId = linked_route_id || localDoc?.linked_route_id;
    if (!routeId) throw new Error('linked_route_id required for live upsert');

    const [aiRes, poiRes, kwRes] = await Promise.all([
      client.aiSearch(q),
      client.searchPoi({ keyword: destination, cityName }),
      client.keywordSearch(q),
    ]);

    const failures = [];
    if (!aiRes?.ok) failures.push(`aiSearch:${aiRes?.error || 'failed'}`);
    if (!poiRes?.ok) failures.push(`searchPoi:${poiRes?.error || 'failed'}`);
    if (!kwRes?.ok) failures.push(`keywordSearch:${kwRes?.error || 'failed'}`);

    const aiMarkdown = asMarkdown(aiRes?.data);
    const poiList = asItemList(poiRes?.data);
    const products = asItemList(kwRes?.data);

    if (!aiMarkdown && failures.length === 3) {
      throw new Error(failures.join('; '));
    }

    const doc = normalize({
      linked_route_id: routeId,
      query: q,
      aiMarkdown,
      poiList,
      products,
      keywords,
    });
    if (localDoc?.destination) doc.destination = localDoc.destination;
    if (localDoc?.city_name) doc.city_name = localDoc.city_name;
    return doc;
  }

  return {
    /**
     * @param {{ query?: string, linked_route_id?: string, vectorScore?: number }} args
     */
    async resolve({ query, linked_route_id, vectorScore } = {}) {
      let localDoc = null;
      let score = 0;

      if (linked_route_id) {
        const byId = store.getByRouteId(linked_route_id);
        if (byId) {
          return { ok: true, doc: byId, from_cache: true, score: 1 };
        }
      } else {
        const picked = pickBestLocal(store, query);
        localDoc = picked.doc;
        score = Math.max(picked.score, Number(vectorScore) || 0);

        if (localDoc && score >= threshold) {
          return { ok: true, doc: localDoc, from_cache: true, score };
        }
      }

      // No exact id hit, or keyword/vector score below threshold / no local → live
      if (linked_route_id) {
        score = Math.max(score, Number(vectorScore) || 0);
      }

      try {
        const liveDoc = await fetchLive({ query, linked_route_id, localDoc });
        const written = store.upsertDoc(liveDoc);
        return {
          ok: true,
          doc: written?.doc ?? liveDoc,
          from_cache: false,
          score,
        };
      } catch (err) {
        return {
          ok: false,
          error: err?.message || String(err),
          doc: localDoc,
        };
      }
    },
  };
}
