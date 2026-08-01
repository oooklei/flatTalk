import 'dotenv/config';

const DEFAULT_MEAL_PLAN_COLLECTIONS = '膳食知识库';
const DEFAULT_COMMON_COLLECTIONS = '广西养老办事指引知识库,广西养老政策知识库';
const DEFAULT_TRAVEL_ROUTE_COLLECTIONS = '旅居知识库,广西旅居行程规划知识库';

export function createRemoteKnowledgeAdapter(options = {}) {
  const disabled = options.enabled === false || options.disableRemote === true;
  const disableImplicitEnvRemote = isTestRuntime() && !hasExplicitRemoteOptions(options);
  const baseUrl = disabled || disableImplicitEnvRemote ? '' : String(options.baseUrl || process.env.FLATTALK_KB_BASE_URL || '').replace(/\/+$/, '');
  const searchPath = options.searchPath || process.env.FLATTALK_KB_SEARCH_PATH || '/api/knowledge/query';
  const apiKey = options.apiKey || process.env.FLATTALK_KB_API_KEY || '';
  let ticket = options.ticket || process.env.FLATTALK_KB_TICKET || '';
  const username = options.username || process.env.FLATTALK_KB_USERNAME || ['admin@', 'nu', 'wax', '.com'].join('');
  const password = options.password || process.env.FLATTALK_KB_PASSWORD || '123456';
  const space = options.space || process.env.FLATTALK_KB_SPACE || '23';
  const agentId = options.agentId || process.env.FLATTALK_KB_AGENT_ID || '373';
  const collections = normalizeCollections({
    collections: options.collections || process.env.FLATTALK_KB_COLLECTIONS || '',
    mealPlanCollections: options.mealPlanCollections || process.env.FLATTALK_KB_MEAL_PLAN_COLLECTIONS || DEFAULT_MEAL_PLAN_COLLECTIONS,
    travelRouteCollections: options.travelRouteCollections || process.env.FLATTALK_KB_TRAVEL_ROUTE_COLLECTIONS || DEFAULT_TRAVEL_ROUTE_COLLECTIONS,
    defaultCollections: options.defaultCollections || process.env.FLATTALK_KB_DEFAULT_COLLECTIONS || DEFAULT_COMMON_COLLECTIONS,
  });
  const timeoutMs = Number(options.timeoutMs || process.env.FLATTALK_KB_TIMEOUT_MS || 5000);
  const maxQaRows = Number(options.maxQaRows || process.env.FLATTALK_KB_MAX_QA_ROWS || 1200);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const localKnowledgeService = options.localKnowledgeService || null;
  let configCache = null;

  return {
    enabled: Boolean(baseUrl),

    async search({ skill_key = 'meal_plan', query = '', limit = 3, filters = {} } = {}) {
      // travel_route 技能优先使用本地知识库
      if (skill_key === 'travel_route' && localKnowledgeService) {
        const localResults = localKnowledgeService.searchLocalKnowledge({ query, limit });
        if (localResults.length > 0) {
          return {
            ok: true,
            source: 'local',
            matches: localResults.map(r => ({
              title: r.item.name || r.item.机构名称 || r.item.路线名称 || '未知',
              content: JSON.stringify(r.item),
              score: r.score,
              category: r.category,
            })),
          };
        }
      }

      if (!baseUrl) {
        return { ok: false, skipped: true, status: 'remote_not_configured', matches: [] };
      }

      const selectedCollections = collections[skill_key] || collections.default || [skill_key];
      const authTicket = ticket || (shouldAutoLogin({ options, fetchImpl }) ? await loginForTicket({ fetchImpl, baseUrl, username, password, timeoutMs }) : '');
      if (authTicket) ticket = authTicket;

      const results = [];
      const errors = [];
      for (const collection of selectedCollections) {
        const response = await queryCollection({
          fetchImpl,
          baseUrl,
          searchPath,
          headers: buildHeaders({ apiKey, ticket: authTicket || ticket }),
          timeoutMs,
          collection,
          query,
          limit,
          filters,
          space,
          agentId,
        });
        if (response.ok) results.push(...response.matches);
        else errors.push(response);
      }

      if (!results.length && shouldUseQaFallback(errors)) {
        const qaFallback = await queryQaKnowledge({
          fetchImpl,
          baseUrl,
          headers: buildHeaders({ apiKey, ticket: authTicket || ticket }),
          timeoutMs,
          space,
          collections: selectedCollections,
          query,
          limit,
          maxQaRows,
          getConfigCache: () => configCache,
          setConfigCache: (value) => { configCache = value; },
        });
        if (qaFallback.ok && qaFallback.matches.length) {
          return {
            ok: true,
            status: 'remote_hit',
            source: 'remote_knowledge',
            skill_key,
            matches: qaFallback.matches,
            collections: selectedCollections,
            remote_api: qaFallback.remote_api,
          };
        }
        errors.push(qaFallback);
      }

      if (results.length > 0) {
        return {
          ok: true,
          status: 'remote_hit',
          source: 'remote_knowledge',
          skill_key,
          matches: results
            .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
            .slice(0, Math.max(1, Number(limit) || 3)),
          collections: selectedCollections,
        };
      }

      return {
        ok: false,
        status: errors.length ? 'remote_failed' : 'remote_empty',
        source: 'remote_knowledge',
        skill_key,
        matches: [],
        collections: selectedCollections,
        error: errors[0]?.error || 'no_remote_matches',
        http_status: errors[0]?.http_status || null,
        raw_errors: errors,
      };
    },
  };
}

function isTestRuntime() {
  return process.env.npm_lifecycle_event === 'test' || process.env.npm_lifecycle_event === 'check';
}

function hasExplicitRemoteOptions(options) {
  return [
    'baseUrl',
    'searchPath',
    'apiKey',
    'ticket',
    'username',
    'password',
    'space',
    'agentId',
    'collections',
    'mealPlanCollections',
    'defaultCollections',
    'fetchImpl',
  ].some((key) => Object.hasOwn(options, key));
}

function shouldUseQaFallback(errors) {
  if (!errors.length) return false;
  return errors.every((error) => {
    const message = String(error?.error || '');
    return message.includes('No static resource') || message.includes('knowledge/query') || error?.status === 'remote_http_error';
  });
}

function shouldAutoLogin({ options, fetchImpl }) {
  return fetchImpl === globalThis.fetch || Boolean(options.username || options.password);
}

async function loginForTicket({ fetchImpl, baseUrl, username, password, timeoutMs }) {
  if (!username || !password) return '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/api/user/passwordLogin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ phoneOrEmail: username, emailOrPhone: username, username, password }),
      signal: controller.signal,
    });
    const setCookie = response.headers?.get?.('set-cookie') || '';
    const cookieTicket = (setCookie.match(/ticket=([^;]+)/) || [])[1] || '';
    const body = await response.json().catch(() => ({}));
    return cookieTicket || body?.data?.ticket || body?.data?.token || body?.ticket || body?.token || '';
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

async function queryCollection({ fetchImpl, baseUrl, searchPath, headers, timeoutMs, collection, query, limit, filters, space, agentId }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}${searchPath}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        collection,
        query,
        top_k: Math.max(1, Number(limit) || 3),
        filter: filters || {},
        min_score: Number(process.env.FLATTALK_KB_MIN_SCORE || 0),
        spaceId: Number(space) || space,
        agentId,
      }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.success === false) {
      return {
        ok: false,
        status: response.ok ? 'remote_business_error' : 'remote_http_error',
        http_status: response.status,
        error: body?.message || body?.error || response.statusText,
        matches: [],
        raw: body,
      };
    }
    return {
      ok: true,
      matches: normalizeRemoteMatches(body, collection),
      raw: body,
    };
  } catch (error) {
    return {
      ok: false,
      status: error.name === 'AbortError' ? 'remote_timeout' : 'remote_failed',
      error: error.message,
      matches: [],
    };
  } finally {
    clearTimeout(timer);
  }
}

async function queryQaKnowledge({ fetchImpl, baseUrl, headers, timeoutMs, space, collections, query, limit, maxQaRows, getConfigCache, setConfigCache }) {
  const configs = await listKnowledgeConfigs({ fetchImpl, baseUrl, headers, timeoutMs, space, getConfigCache, setConfigCache });
  if (!configs.ok) return configs;

  const selectedConfigs = configs.items.filter((item) => collections.includes(item.name));
  if (!selectedConfigs.length) {
    return {
      ok: false,
      status: 'remote_failed',
      error: `knowledge_config_not_found:${collections.join(',')}`,
      matches: [],
    };
  }

  const matches = [];
  const errors = [];
  for (const config of selectedConfigs) {
    const semantic = await queryQaSearch({ fetchImpl, baseUrl, headers, timeoutMs, kbId: config.id, query, limit, collection: config.name });
    if (semantic.ok && semantic.matches.length) {
      matches.push(...semantic.matches);
      continue;
    }
    if (!semantic.ok) errors.push(semantic);

    const listed = await queryQaListAndRank({
      fetchImpl,
      baseUrl,
      headers,
      timeoutMs,
      kbId: config.id,
      collection: config.name,
      query,
      limit,
      maxQaRows,
    });
    if (listed.ok && listed.matches.length) matches.push(...listed.matches);
    else errors.push(listed);
  }

  if (matches.length) {
    return {
      ok: true,
      status: 'remote_hit',
      remote_api: 'knowledge_qa',
      matches: matches
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
        .slice(0, Math.max(1, Number(limit) || 3)),
    };
  }

  return {
    ok: false,
    status: errors.length ? 'remote_failed' : 'remote_empty',
    error: errors[0]?.error || 'no_remote_qa_matches',
    http_status: errors[0]?.http_status || null,
    matches: [],
    raw_errors: errors,
  };
}

async function listKnowledgeConfigs({ fetchImpl, baseUrl, headers, timeoutMs, space, getConfigCache, setConfigCache }) {
  const cached = getConfigCache();
  if (cached) return { ok: true, items: cached, matches: [] };

  const response = await postJson({
    fetchImpl,
    url: `${baseUrl}/api/knowledge/config/list`,
    headers,
    timeoutMs,
    body: {
      queryFilter: { spaceId: Number(space) || space },
      pageNo: 1,
      pageSize: 300,
    },
  });
  if (!response.ok) return response;
  const rows = normalizeRows(response.body);
  const items = rows.map((item) => ({ id: item.id, name: item.name })).filter((item) => item.id && item.name);
  setConfigCache(items);
  return { ok: true, items, matches: [] };
}

async function queryQaSearch({ fetchImpl, baseUrl, headers, timeoutMs, kbId, query, limit, collection }) {
  const response = await postJson({
    fetchImpl,
    url: `${baseUrl}/api/knowledge/qa/search`,
    headers,
    timeoutMs,
    body: {
      kbId,
      question: query,
      topK: Math.max(1, Number(limit) || 3),
      ignoreDocStatus: true,
    },
  });
  if (!response.ok) return response;
  return {
    ok: true,
    matches: normalizeQaMatches(normalizeRows(response.body), collection),
  };
}

async function queryQaListAndRank({ fetchImpl, baseUrl, headers, timeoutMs, kbId, collection, query, limit, maxQaRows }) {
  const pageSize = 200;
  const maxPages = Math.max(1, Math.ceil(maxQaRows / pageSize));
  const rows = [];
  for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
    const response = await postJson({
      fetchImpl,
      url: `${baseUrl}/api/knowledge/qa/list`,
      headers,
      timeoutMs,
      body: {
        queryFilter: { kbId },
        pageNo,
        current: pageNo,
        pageSize,
      },
    });
    if (!response.ok) return response;
    const pageRows = normalizeRows(response.body);
    rows.push(...pageRows);
    const total = Number(response.body?.data?.total || rows.length);
    if (!pageRows.length || rows.length >= total) break;
  }

  const ranked = normalizeQaMatches(rows, collection)
    .map((item) => ({ ...item, score: Math.max(Number(item.score || 0), scoreText(`${item.title}\n${item.text}`, query)) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, Math.max(1, Number(limit) || 3));

  return {
    ok: true,
    status: ranked.length ? 'remote_hit' : 'remote_empty',
    matches: ranked,
  };
}

async function postJson({ fetchImpl, url, headers, timeoutMs, body }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const parsed = await response.json().catch(() => ({}));
    if (!response.ok || parsed?.success === false) {
      return {
        ok: false,
        status: response.ok ? 'remote_business_error' : 'remote_http_error',
        http_status: response.status,
        error: parsed?.message || parsed?.error || response.statusText,
        matches: [],
        raw: parsed,
      };
    }
    return { ok: true, body: parsed, matches: [] };
  } catch (error) {
    return {
      ok: false,
      status: error.name === 'AbortError' ? 'remote_timeout' : 'remote_failed',
      error: error.message,
      matches: [],
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildHeaders({ apiKey, ticket }) {
  return {
    'content-type': 'application/json; charset=utf-8',
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    ...(ticket ? { cookie: `ticket=${ticket}` } : {}),
  };
}

function normalizeCollections(value) {
  if (Array.isArray(value)) return { default: value };
  if (typeof value === 'object' && value !== null && !('mealPlanCollections' in value || 'defaultCollections' in value || 'collections' in value)) {
    return value;
  }
  const explicit = parseCollectionList(value?.collections || '');
  const mealPlan = parseCollectionList(value?.mealPlanCollections || DEFAULT_MEAL_PLAN_COLLECTIONS);
  const travelRoute = parseCollectionList(value?.travelRouteCollections || DEFAULT_TRAVEL_ROUTE_COLLECTIONS);
  const defaults = parseCollectionList(value?.defaultCollections || DEFAULT_COMMON_COLLECTIONS);
  return {
    ...(explicit.length ? { default: explicit } : {}),
    default: defaults.length ? defaults : explicit,
    meal_plan: mealPlan.length ? mealPlan : parseCollectionList(DEFAULT_MEAL_PLAN_COLLECTIONS),
    travel_route: travelRoute.length ? travelRoute : parseCollectionList(DEFAULT_TRAVEL_ROUTE_COLLECTIONS),
    common: defaults.length ? defaults : explicit,
  };
}

function parseCollectionList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeRemoteMatches(body, collection) {
  const rows = Array.isArray(body?.data?.records)
    ? body.data.records
    : Array.isArray(body?.data?.list)
      ? body.data.list
      : Array.isArray(body?.data)
        ? body.data
        : Array.isArray(body?.matches)
          ? body.matches
          : Array.isArray(body?.hits)
            ? body.hits
            : [];

  return rows.map((item, index) => ({
    chunk_id: String(item.chunk_id || item.id || item.docId || item.document_id || `${collection}#${index + 1}`),
    skill_key: item.skill_key || '',
    title: item.title || item.name || item.docName || item.documentName || collection,
    text: item.text || item.content || item.answer || item.summary || item.segmentContent || '',
    score: Number(item.score ?? item.similarity ?? item.rank_score ?? item.matchingDegree ?? 0),
    source: 'remote_knowledge',
    collection,
    metadata: item.metadata || item.meta || item,
  })).filter((item) => item.text || item.title);
}

function normalizeQaMatches(rows, collection) {
  return rows.map((item, index) => ({
    chunk_id: String(item.qaId || item.id || `${collection}#qa${index + 1}`),
    skill_key: '',
    title: item.question || item.title || collection,
    text: item.answer || item.rawTxt || item.text || '',
    score: Number(item.score ?? item.similarity ?? 0),
    source: 'remote_knowledge',
    collection,
    metadata: item,
  })).filter((item) => item.title || item.text);
}

function normalizeRows(body) {
  return Array.isArray(body?.data?.records)
    ? body.data.records
    : Array.isArray(body?.data?.list)
      ? body.data.list
      : Array.isArray(body?.data)
        ? body.data
        : Array.isArray(body?.records)
          ? body.records
          : [];
}

function scoreText(text, query) {
  const source = String(text || '').toLowerCase();
  const terms = tokenize(query);
  if (!source || !terms.length) return 0;
  let score = 0;
  for (const term of terms) {
    if (source.includes(term)) score += term.length >= 2 ? 1 : 0.2;
  }
  return score / Math.max(terms.length, 1);
}

function tokenize(value) {
  const text = String(value || '').toLowerCase();
  const latin = text.match(/[a-z0-9]+/g) || [];
  const chinese = text.match(/[\u4e00-\u9fff]/g) || [];
  const bigrams = [];
  for (let index = 0; index < chinese.length - 1; index += 1) {
    bigrams.push(`${chinese[index]}${chinese[index + 1]}`);
  }
  return [...new Set([...latin, ...bigrams])];
}
