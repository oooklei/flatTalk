import { createJtdClient } from './jtd-client.js';

const MOCK_PRODUCTS = Object.freeze([
  {
    product_id: 'jtd_mock_bama_001',
    sku_id: 'sku_bama_3d',
    product_name: '广西巴马康养旅居三日体验',
    destination: '广西巴马',
    city: '巴马',
    price_amount: 1680,
    price_label: '约1680元/人',
    stock: 6,
    inventory_status: 'available',
    tags: ['慢病友好', '低强度', '医疗可达'],
    handoff_urls: {
      h5_product_url: 'https://ljutest.jtdcn.cn/mock/sojourn/product/jtd_mock_bama_001',
      mini_program_url: '',
    },
    vendor_trace_id: 'mock_vendor_bama_001',
  },
  {
    product_id: 'jtd_mock_beihai_001',
    sku_id: 'sku_beihai_4d',
    product_name: '广西北海暖冬海滨旅居四日',
    destination: '广西北海',
    city: '北海',
    price_amount: 1380,
    price_label: '约1380元/人',
    stock: 3,
    inventory_status: 'available',
    tags: ['海滨慢行', '家属陪同', '交通便利'],
    handoff_urls: {
      h5_product_url: 'https://ljutest.jtdcn.cn/mock/sojourn/product/jtd_mock_beihai_001',
      mini_program_url: '',
    },
    vendor_trace_id: 'mock_vendor_beihai_001',
  },
]);

export function createJtdTravelService(options = {}) {
  const configuredMode = options.mode || process.env.JTD_API_MODE || 'auto';
  const client = options.client || createJtdClient(options.clientOptions || options);
  const configured = client.isConfigured();
  const mode = configuredMode === 'auto' && !configured ? 'mock' : configuredMode;

  return {
    configuredMode,
    mode,
    client,
    async buildRouteProductContext(request = {}) {
      const query = buildSearchQuery(request);
      const search = await callSearch({ mode, client, query });
      logJtdCall({ configuredMode, mode, configured, query, search });
      const products = normalizeSearchRecords(search);
      const selected = selectProduct(products, request.message || request.text || '');
      const detail = selected?.product_id && shouldFetchDetail(request)
        ? await callDetail({ mode, client, selected })
        : null;
      const availability = selected?.product_id && shouldCheckAvailability(request)
        ? await callAvailability({ mode, client, selected, request })
        : null;
      const normalizedAvailability = availability ? normalizeAvailability(availability) : null;

      return {
        provider: 'jintiaodong',
        mode,
        configured_mode: configuredMode,
        required: true,
        query,
        source_status: sourceStatusFrom(search),
        products,
        selected_product: mergeProductDetail(selected, detail),
        detail,
        availability,
        handoff_enabled: Boolean(normalizedAvailability?.available && handoffUrls(normalizedAvailability).length),
        calls: [search, detail, availability].filter(Boolean).map(summarizeCall),
        warnings: warningsFrom(search, products),
        ...(normalizedAvailability ? { availability: { ...availability, normalized: normalizedAvailability } } : { availability }),
      };
    },
  };
}

export function buildSearchQuery(request = {}) {
  const text = String(request.message || request.text || request.query || '');
  const city = inferCity(text);
  return {
    tenantId: request.context?.tenantId || request.context?.tenant_id || process.env.JTD_TENANT_ID || '042788',
    productDomain: /基地|住宿|住哪|酒店|客栈|民宿/.test(text) ? 'sojourn_base' : 'sojourn_route',
    ...(city ? { destinationCity: city } : {}),
    city,
    product_type: /基地|住宿|住哪/.test(text) ? '旅居基地' : '旅居线路',
    days: inferDays(text),
    budget: inferBudget(text),
    pageNum: 1,
    pageSize: 3,
  };
}

export function normalizeSearchRecords(apiResult = {}) {
  if (!apiResult.ok && apiResult.source_status !== 'mock_vendor_data') return [];
  const data = apiResult.response?.data ?? apiResult.response?.result ?? apiResult.response ?? {};
  const records = Array.isArray(data)
    ? data
    : Array.isArray(data.records)
    ? data.records
    : Array.isArray(data.list)
    ? data.list
    : Array.isArray(data.items)
    ? data.items
    : [];

  return records.map((record, index) => normalizeProduct(record, index)).filter((item) => item.product_id);
}

export function normalizeAvailability(apiResult = {}) {
  if (!apiResult?.ok) return { available: false, source_status: apiResult?.source_status || 'unavailable' };
  const data = apiResult.response?.data ?? apiResult.response?.result ?? apiResult.response ?? {};
  const available = Boolean(
    data.available === true
      || data.availability === true
      || data.canBook === true
      || data.can_book === true
      || data.stock > 0
      || data.inventory > 0,
  );
  return {
    available,
    source_status: apiResult.source_status || 'real_data',
    final_price: sanitizePrice(data.finalPrice ?? data.final_price ?? data.price ?? null),
    stock: data.stock ?? data.inventory ?? null,
    handoff_urls: normalizeHandoffUrls(data),
    raw: data,
  };
}

async function callSearch({ mode, client, query }) {
  if (mode === 'mock') return mockResult('searchProducts', { records: MOCK_PRODUCTS });
  const real = client.isConfigured() ? await client.searchProducts(query) : unavailable('searchProducts', 'config_missing');
  if (real.ok || mode === 'real') return real;
  return { ...mockResult('searchProducts', { records: MOCK_PRODUCTS }), fallback_from: real };
}

async function callDetail({ mode, client, selected }) {
  if (mode === 'mock') return mockResult('productDetail', { ...selected, itinerary: mockItinerary(selected) });
  const real = client.isConfigured()
    ? await client.productDetail(selected.product_id, selected.sku_id)
    : unavailable('productDetail', 'config_missing');
  if (real.ok || mode === 'real') return real;
  return { ...mockResult('productDetail', { ...selected, itinerary: mockItinerary(selected) }), fallback_from: real };
}

async function callAvailability({ mode, client, selected, request }) {
  const payload = {
    productId: selected.product_id,
    skuId: selected.sku_id,
    checkIn: request.context?.check_in || request.params?.check_in || '',
    checkOut: request.context?.check_out || request.params?.check_out || '',
    quantity: Number(request.context?.people_count || request.params?.people_count || 1),
  };
  if (mode === 'mock') return mockResult('checkAvailability', {
    available: Number(selected.stock || 0) > 0,
    stock: selected.stock,
    finalPrice: selected.price_amount,
    handoff_urls: selected.handoff_urls,
  });
  const real = client.isConfigured()
    ? await client.checkAvailability(payload)
    : unavailable('checkAvailability', 'config_missing');
  if (real.ok || mode === 'real') return real;
  return { ...mockResult('checkAvailability', {
    available: false,
    stock: 0,
    finalPrice: selected.price_amount,
    handoff_urls: {},
  }), fallback_from: real };
}

function normalizeProduct(record = {}, index = 0) {
  const productId = record.product_id || record.productId || record.outProductId || record.id || '';
  const skuId = record.sku_id || record.skuId || record.outSkuId || '';
  const name = record.product_name || record.productName || record.routeName || record.name || '';
  const destination = record.destination || record.destinationCity || record.city || record.routeCity || '';
  const rawPrice = record.price_amount ?? record.priceAmount ?? record.price?.amount ?? record.salePrice ?? record.minPrice ?? null;
  const stock = record.stock ?? record.inventory ?? record.inventoryStock ?? null;
  const price = sanitizePrice(rawPrice);
  return {
    product_id: String(productId || ''),
    sku_id: String(skuId || ''),
    product_name: String(name || `旅居产品${index + 1}`),
    destination: String(destination || ''),
    city: String(record.city || destination || ''),
    price_amount: price,
    price_label: record.price_label || (price ? `约${price}元/人` : '价格待确认'),
    price_warning: price !== null && price < 1,
    stock: stock === null || stock === undefined || stock === '' ? null : Number(stock),
    inventory_status: record.inventory_status || record.inventoryStatus || (Number(stock) > 0 ? 'available' : 'unknown'),
    tags: normalizeTags(record.tags || record.productTags || record.routeFeatures || record.health_tags),
    handoff_urls: normalizeHandoffUrls(record.handoff_urls || record.handoffUrls || record),
    vendor_trace_id: record.vendor_trace_id || record.vendorRequestId || record.requestId || '',
    raw: record.raw || record,
  };
}

function sanitizePrice(rawPrice) {
  if (rawPrice === null || rawPrice === undefined || rawPrice === '') return null;
  const num = Number(rawPrice);
  if (Number.isNaN(num) || num < 0) return null;
  // 低于 1 元的单价视为接口异常数据，不参与展示
  if (num > 0 && num < 1) return null;
  return num;
}

function mergeProductDetail(product, detailResult) {
  if (!product) return null;
  if (!detailResult?.ok) return product;
  const detail = normalizeProduct(detailResult.response?.data || detailResult.response || {});
  return {
    ...product,
    ...Object.fromEntries(Object.entries(detail).filter(([, value]) => value !== '' && value !== null && value !== undefined)),
  };
}

function normalizeHandoffUrls(value = {}) {
  return {
    h5_product_url: value.h5_product_url || value.h5ProductUrl || value.h5Url || value.productUrl || '',
    h5_order_url: value.h5_order_url || value.h5OrderUrl || value.orderUrl || '',
    mini_program_url: value.mini_program_url || value.miniProgramUrl || value.miniUrl || '',
  };
}

function handoffUrls(value = {}) {
  const urls = value.handoff_urls || normalizeHandoffUrls(value);
  return Object.values(urls).filter(Boolean);
}

function shouldFetchDetail(request) {
  const text = String(request.message || request.text || '');
  return /详情|产品|基地|路线|旅居|康养|北海|巴马|桂林/.test(text) || request.context?.action_key === 'travel_route.view_product_detail';
}

function shouldCheckAvailability(request) {
  const text = String(request.message || request.text || '');
  return /可订|余量|库存|预订|预约|下单|入住|付款|有房|日期/.test(text)
    || request.context?.action_key === 'travel_route.check_availability'
    || request.context?.action_key === 'travel_route.booking_handoff';
}

function inferCity(text) {
  if (/北海|海边|海滨/.test(text)) return '北海';
  if (/桂林|阳朔/.test(text)) return '桂林';
  if (/南宁/.test(text)) return '南宁';
  if (/百色/.test(text)) return '百色';
  if (/巴马|长寿/.test(text)) return '巴马';
  if (/北海|海边|海滨/.test(text)) return '北海';
  if (/桂林|阳朔/.test(text)) return '桂林';
  if (/南宁/.test(text)) return '南宁';
  if (/百色/.test(text)) return '百色';
  if (/巴马|长寿/.test(text)) return '巴马';
  return '';
}

function inferDays(text) {
  const normalMatch = String(text || '').match(/(\d+)\s*(天|日)/);
  if (normalMatch) return Number(normalMatch[1]);
  if (/三天|三日/.test(text)) return 3;
  if (/四天|四日/.test(text)) return 4;
  if (/一周|七天|7天/.test(text)) return 7;
  const match = String(text || '').match(/(\d+)\s*(天|日)/);
  if (match) return Number(match[1]);
  if (/三天|三日/.test(text)) return 3;
  if (/四天|四日/.test(text)) return 4;
  if (/一周|七天|7天/.test(text)) return 7;
  return null;
}

function inferBudget(text) {
  if (/经济|便宜|低预算/.test(text)) return '经济型';
  if (/高端|品质|舒适/.test(text)) return '舒适型';
  if (/经济|便宜|低预算/.test(text)) return '经济型';
  if (/高端|品质|舒适/.test(text)) return '舒适型';
  return '';
}

function selectProduct(products, text) {
  if (!products.length) return null;
  if (/北海|海边|海滨/.test(text)) return products.find((item) => /北海/.test(item.destination || item.city || item.product_name)) || products[0];
  if (/巴马|长寿|百色/.test(text)) return products.find((item) => /巴马|百色/.test(item.destination || item.city || item.product_name)) || products[0];
  if (/北海|海边|海滨/.test(text)) return products.find((item) => /北海/.test(item.destination || item.city || item.product_name)) || products[0];
  if (/巴马|长寿|百色/.test(text)) return products.find((item) => /巴马|百色/.test(item.destination || item.city || item.product_name)) || products[0];
  return products[0];
}

function sourceStatusFrom(result) {
  if (!result) return 'unavailable';
  if (result.source_status === 'mock_vendor_data') return 'mock_vendor_data';
  if (result.ok) return 'real_data';
  return result.source_status || 'unavailable';
}

function warningsFrom(search, products) {
  const warnings = [];
  if (!search?.ok && search?.source_status !== 'mock_vendor_data') warnings.push('jtd_search_unavailable');
  if (!products.length) warnings.push('jtd_products_empty');
  if (search?.source_status === 'mock_vendor_data') warnings.push('jtd_mock_vendor_data');
  return warnings;
}

function logJtdCall({ configuredMode, mode, configured, query, search }) {
  const city = query?.destinationCity || query?.city || '';
  const days = query?.days ?? '';
  console.info(
    `[jtd] configuredMode=${configuredMode} effectiveMode=${mode} configured=${configured} `
    + `endpoint=${search?.endpoint || 'searchProducts'} source=${search?.source_status || 'unknown'} `
    + `ok=${Boolean(search?.ok)} error=${search?.error || ''} city=${city} days=${days}`,
  );
}

function summarizeCall(call) {
  return {
    endpoint: call.endpoint,
    ok: call.ok,
    source_status: call.source_status,
    httpStatus: call.httpStatus,
    business_code: call.business_code,
    error: call.error,
    request_id: call.request_id,
  };
}

function mockResult(endpoint, data) {
  return {
    ok: true,
    packageKey: 'travel_route',
    adapter: 'jintiaodong',
    request_id: `jtd_mock_${endpoint}_${Date.now()}`,
    source_status: 'mock_vendor_data',
    fallback_used: true,
    endpoint,
    httpStatus: 200,
    business_code: 200,
    error: null,
    message: '厂家接口联调 mock 数据',
    request: {},
    response: { code: 200, data },
    warnings: ['jtd_mock_vendor_data'],
    attempts: 0,
    timing_ms: 0,
  };
}

function unavailable(endpoint, reason) {
  return {
    ok: false,
    packageKey: 'travel_route',
    adapter: 'jintiaodong',
    request_id: `jtd_${endpoint}_${Date.now()}`,
    source_status: 'unavailable',
    fallback_used: false,
    endpoint,
    httpStatus: null,
    business_code: null,
    error: reason,
    message: reason,
    request: {},
    response: null,
    warnings: [],
    attempts: 0,
    timing_ms: 0,
  };
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean).slice(0, 6);
  return String(value || '').split(/[,，、\s]+/).map((item) => item.trim()).filter(Boolean).slice(0, 6);
}

function mockItinerary(selected) {
  return [
    { day: 'D1', plan: `抵达${selected.destination || selected.city}，入住并完成健康确认。` },
    { day: 'D2', plan: '低强度康养活动，午后安排充分休息。' },
    { day: 'D3', plan: '根据体力安排返程或短途慢行。' },
  ];
}
