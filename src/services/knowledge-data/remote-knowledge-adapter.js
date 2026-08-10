import 'dotenv/config';

const DEFAULT_MEAL_PLAN_COLLECTIONS = '膳食知识库,meal_plan_business_kb,meal_plan_dialogue_kb';
const DEFAULT_COMMON_COLLECTIONS = '广西养老办事指引知识库,广西养老政策知识库,guixiaoyang_policy_kb,guixiaoyang_dialogue_kb';
const DEFAULT_TRAVEL_ROUTE_COLLECTIONS = '旅居知识库,广西旅居行程规划知识库,travel_route_business_kb,travel_route_dialogue_kb';

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

  async function ensureTicket() {
    if (ticket) return ticket;
    if (!shouldAutoLogin({ options, fetchImpl })) return '';
    ticket = await loginForTicket({ fetchImpl, baseUrl, username, password, timeoutMs });
    return ticket;
  }

  return {
    enabled: Boolean(baseUrl),

    async search({ skill_key = 'meal_plan', query = '', limit = 3, filters = {} } = {}) {
      if (skill_key === 'travel_route' && localKnowledgeService) {
        const localResults = localKnowledgeService.searchLocalKnowledge({ query, limit });
        if (localResults.length > 0) {
          return {
            ok: true,
            source: 'local',
            status: 'local_hit',
            matches: localResults.map((r) => ({
              title: r.item.name || r.item.机构名称 || r.item.路线名称 || '本地旅居知识',
              content: JSON.stringify(r.item),
              text: JSON.stringify(r.item),
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
      const authTicket = await ensureTicket();
      const headers = buildHeaders({ apiKey, ticket: authTicket });
      const errors = [];

      const direct = await queryDirectKnowledge({
        fetchImpl,
        baseUrl,
        searchPath,
        headers,
        timeoutMs,
        collections: selectedCollections,
        query,
        limit,
        filters,
        space,
        agentId,
      });
      if (direct.ok && direct.matches.length) return direct;
      if (!direct.ok) errors.push(...(direct.raw_errors || [direct]));

      const qa = await queryQaKnowledge({
        fetchImpl,
        baseUrl,
        headers,
        timeoutMs,
        space,
        collections: selectedCollections,
        query,
        limit,
        maxQaRows,
        getConfigCache: () => configCache,
        setConfigCache: (value) => { configCache = value; },
      });
      if (qa.ok && qa.matches.length) return qa;
      errors.push(qa);

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

async function queryDirectKnowledge({ fetchImpl, baseUrl, searchPath, headers, timeoutMs, collections, query, limit, filters, space, agentId }) {
  const results = [];
  const errors = [];
  for (const collection of collections) {
    const response = await postJson({
      fetchImpl,
      url: `${baseUrl}${searchPath}`,
      headers,
      timeoutMs,
      body: {
        collection,
        query,
        top_k: Math.max(1, Number(limit) || 3),
        filter: filters || {},
        min_score: Number(process.env.FLATTALK_KB_MIN_SCORE || 0),
        spaceId: Number(space) || space,
        agentId,
      },
    });
    if (response.ok) results.push(...normalizeRemoteMatches(response.body, collection));
    else errors.push(response);
  }
  if (results.length) {
    return {
      ok: true,
      status: 'remote_hit',
      source: 'remote_knowledge',
      remote_api: 'knowledge_query',
      matches: sortAndLimit(results, limit),
      collections,
    };
  }
  return { ok: false, status: errors.length ? 'remote_failed' : 'remote_empty', matches: [], raw_errors: errors, error: errors[0]?.error };
}

async function queryQaKnowledge({ fetchImpl, baseUrl, headers, timeoutMs, space, collections, query, limit, maxQaRows, getConfigCache, setConfigCache }) {
  const configs = await listKnowledgeConfigs({ fetchImpl, baseUrl, headers, timeoutMs, space, getConfigCache, setConfigCache });
  if (!configs.ok) return configs;

  const selectedConfigs = selectKnowledgeConfigs(configs.items, collections);
  if (!selectedConfigs.length) {
    return {
      ok: false,
      status: 'remote_failed',
      error: `knowledge_config_not_found:${collections.join(',')}`,
      matches: [],
      available_collections: configs.items.map((item) => item.name).slice(0, 20),
    };
  }

  const matches = [];
  const errors = [];
  for (const config of selectedConfigs) {
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
    if (listed.ok && listed.matches.length) {
      matches.push(...listed.matches);
      continue;
    }
    if (!listed.ok) errors.push(listed);

    const semantic = await queryQaSearch({ fetchImpl, baseUrl, headers, timeoutMs, kbId: config.id, query, limit, collection: config.name });
    if (semantic.ok && semantic.matches.length) matches.push(...semantic.matches);
    else if (!semantic.ok) errors.push(semantic);
  }

  if (matches.length) {
    return {
      ok: true,
      status: 'remote_hit',
      source: 'remote_knowledge',
      remote_api: 'knowledge_qa',
      matches: sortAndLimit(matches, limit),
      collections,
    };
  }

  return {
    ok: false,
    status: errors.length ? 'remote_failed' : 'remote_empty',
    source: 'remote_knowledge',
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
  const items = rows.map((item) => ({ id: item.id || item.kbId, name: item.name || item.kbName || item.title })).filter((item) => item.id && item.name);
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
    .map((item) => ({ ...item, score: Math.max(Number(item.score || 0), scoreText(`${item.title}\n${item.text}`, query, collection)) }))
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const positive = ranked.filter((item) => item.score > 0);
  return {
    ok: true,
    status: ranked.length ? 'remote_hit' : 'remote_empty',
    matches: positive.slice(0, Math.max(1, Number(limit) || 3)),
  };
}

async function loginForTicket({ fetchImpl, baseUrl, username, password, timeoutMs }) {
  if (!username || !password) return '';
  const response = await postJson({
    fetchImpl,
    url: `${baseUrl}/api/user/passwordLogin`,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    timeoutMs,
    body: { phoneOrEmail: username, emailOrPhone: username, username, password },
    includeHeaders: true,
  });
  if (!response.ok) return '';
  const setCookie = response.headers?.get?.('set-cookie') || '';
  return (setCookie.match(/ticket=([^;]+)/) || [])[1]
    || response.body?.data?.ticket
    || response.body?.data?.token
    || response.body?.ticket
    || response.body?.token
    || '';
}

async function postJson({ fetchImpl, url, headers, timeoutMs, body, includeHeaders = false }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const parsed = await response.json().catch(async () => ({ raw: await response.text().catch(() => '') }));
    const businessFailed = parsed?.success === false || parsed?.code === 500 || parsed?.code === '500';
    if (!response.ok || businessFailed) {
      return {
        ok: false,
        status: response.ok ? 'remote_business_error' : 'remote_http_error',
        http_status: response.status,
        error: parsed?.message || parsed?.error || parsed?.msg || response.statusText,
        matches: [],
        raw: parsed,
      };
    }
    return { ok: true, body: parsed, matches: [], ...(includeHeaders ? { headers: response.headers } : {}) };
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

function shouldAutoLogin({ options, fetchImpl }) {
  return fetchImpl === globalThis.fetch || Boolean(options.username || options.password);
}

function isTestRuntime() {
  return process.env.npm_lifecycle_event === 'test'
    || process.env.npm_lifecycle_event === 'check'
    || process.env.NODE_TEST_CONTEXT
    || process.argv.includes('--test');
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
    'travelRouteCollections',
    'defaultCollections',
    'fetchImpl',
  ].some((key) => Object.hasOwn(options, key));
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

function selectKnowledgeConfigs(items, wantedCollections) {
  const wanted = wantedCollections.map(normalizeName).filter(Boolean);
  return items.filter((item) => {
    const name = normalizeName(item.name);
    return wanted.some((target) => name === target || name.includes(target) || target.includes(name));
  });
}

function normalizeName(value) {
  return String(value || '').replace(/\s+/g, '').replace(/[“”"'`]/g, '').toLowerCase();
}

function normalizeRemoteMatches(body, collection) {
  const rows = normalizeRows(body);
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
    text: item.answer || item.rawTxt || item.text || item.content || '',
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
      : Array.isArray(body?.data?.rows)
        ? body.data.rows
        : Array.isArray(body?.data)
          ? body.data
          : Array.isArray(body?.records)
            ? body.records
            : Array.isArray(body?.matches)
              ? body.matches
              : Array.isArray(body?.hits)
                ? body.hits
                : [];
}

function sortAndLimit(matches, limit) {
  return matches
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, Math.max(1, Number(limit) || 3));
}

function scoreText(text, query, collection = '') {
  const source = String(text || '').toLowerCase();
  const terms = tokenize(`${query} ${domainHints(query, collection)}`);
  if (!source || !terms.length) return 0;
  let score = 0;
  for (const term of terms) {
    if (!source.includes(term)) continue;
    if (/^[a-z0-9]+$/.test(term)) score += Math.min(term.length, 10);
    else score += Math.min(term.length, 6);
  }
  return score;
}

function tokenize(value) {
  const text = String(value || '').toLowerCase();
  const latin = text.match(/[a-z0-9]+/g) || [];
  const chineseRuns = text.match(/[\u4e00-\u9fff]{2,}/g) || [];
  const grams = [];
  for (const run of chineseRuns) {
    for (const size of [2, 3, 4]) {
      for (let index = 0; index <= run.length - size; index += 1) {
        grams.push(run.slice(index, index + size));
      }
    }
  }
  return [...new Set([...latin, ...grams])].filter((term) => term.length >= 2);
}

function domainHints(query, collection) {
  const value = `${query || ''} ${collection || ''}`;
  const hints = [];
  if (/糖尿病|血糖|控糖|早餐|膳食|营养|老人|老年/.test(value)) {
    hints.push('老人 老年 膳食 营养 早餐 血糖 糖尿病 控糖 食谱');
  }
  if (/补贴|津贴|养老|高龄|低保|特困|政策|申请|办理/.test(value)) {
    hints.push('养老 老年人 补贴 津贴 政策 申请 办理 条件 材料');
  }
  if (/旅居|路线|天气|风险|行程|康养|目的地/.test(value)) {
    hints.push('旅居 路线 行程 康养 天气 风险 目的地');
  }
  return hints.join(' ');
}
