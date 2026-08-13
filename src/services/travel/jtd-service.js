import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJtdClient } from './jtd-client.js';
import { BaseInterfaceService } from '../interface-base.js';
import { searchCategory } from '../nearby-resource/tavily-nearby-adapter.js';
import { lookupDashboardSpotImages } from '../../skills/travel_route/dashboard-spot-kb.js';
import { buildLocalRouteContext } from './local-routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// jtd-service.js 在 src/services/travel/，需上溯 3 层到项目根目录
const ROOT = path.resolve(__dirname, '..', '..', '..');
const LOCAL_KB_FILE = path.join(ROOT, 'src', 'skills', 'travel_route', 'knowledge', 'interface_cache', 'jintiaodong_index.json');
const MODEL_REGISTRY_PATH = path.join(ROOT, 'data', 'model-registry.json');

/**
 * 读取默认 LLM 模型配置（用于缺失字段推理补齐）。
 * 优先选择非推理模型（glm-4-flash/glm-4-air等），避免 glm-5.x 推理模型 reasoning_tokens 占满 max_tokens 配额导致 content 为空。
 * 兜底顺序：flash/lite/air 系列 → is_default=true → 第一个 active 的 llm_text。
 * @returns {Object|null} model 配置对象
 */
function getDefaultLlmModel() {
  try {
    const exists = fs.existsSync(MODEL_REGISTRY_PATH);
    if (!exists) {
      console.warn('[jtd-llm] model-registry.json 不存在:', MODEL_REGISTRY_PATH);
      return null;
    }
    const reg = JSON.parse(fs.readFileSync(MODEL_REGISTRY_PATH, 'utf8'));
    const models = Array.isArray(reg?.models) ? reg.models : [];
    const llmText = models.filter((m) => m.is_active && m.model_type === 'llm_text' && m.api_base && m.model_id);
    if (!llmText.length) {
      console.warn('[jtd-llm] 无可用的 llm_text 模型，models=', models.length);
      return null;
    }
    // 优先非推理模型（flash/lite/air/plus/qwen/gpt-4o 等），避免 glm-5.x 的 reasoning_tokens 耗尽配额
    const nonReasoningPattern = /flash|lite|air|plus|4o|mini|haiku|qwen|baichuan|spark|moonshot/i;
    const selected =
      llmText.find((m) => nonReasoningPattern.test(m.model_id)) ||  // 优先非推理
      llmText.find((m) => m.is_default && !/glm-5|glm5|deepseek-r|reasoning/i.test(m.model_id)) || // 默认但非推理
      llmText.find((m) => m.is_default) || // 最后用默认
      llmText[0];
    console.log('[jtd-llm] 选中模型:', selected?.model_id, 'has_key=', Boolean(selected?.api_key));
    return selected;
  } catch (e) {
    console.warn('[jtd-llm] 读取模型注册表失败:', e?.message || e);
    return null;
  }
}

/**
 * 调用 LLM 推理补齐产品缺失字段（destination/itinerary/highlights）。
 * 仅当接口返回的字段为空时才调用，避免覆盖真实数据。
 * @param {Object} product - 归一化后的产品对象
 * @param {string} userMessage - 用户原始消息
 * @returns {Promise<Object>} 补齐后的字段对象 { destination?, itinerary?, highlights? }
 */
async function inferMissingFieldsWithLlm(product, userMessage = '') {
  const model = getDefaultLlmModel();
  if (!model) {
    console.warn('[jtd-llm] 无可用 LLM 模型，跳过字段推理');
    return {};
  }

  // 解析 API Key
  const apiKey = model.api_key || process.env[`FLATTALK_MODEL_${String(model.provider || '').toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`] || process.env.FLATTALK_MODEL_API_KEY || '';
  if (!apiKey) {
    console.warn('[jtd-llm] 模型无 API Key，跳过字段推理');
    return {};
  }

  const productName = product?.product_name || '';
  const priceLabel = product?.price_label || '';
  const hasDestination = Boolean(product?.destination);
  // 只有 destination 缺失时才调用 LLM（避免每次都调）
  if (hasDestination) return {};

  const prompt = `你是旅居产品数据分析助手。请根据以下产品信息，推理出缺失的目的地字段。

产品名：${productName}
价格：${priceLabel}
用户消息：${userMessage}

请严格按以下 JSON 格式返回（不要有任何额外文字、不要 markdown 代码块）：
{"destination":"广西XX市/县","reason":"推理依据"}

注意：
1. destination 必须是广西壮族自治区的市/县/乡镇名（如"广西巴马"、"广西北海"、"广西防城港"、"广西桂林"等）
2. 如果产品名含地名（如"七洞乡"、"巴马"、"北海"），直接提取
3. 如果无法从产品名提取，根据产品特征推理最可能的广西旅居目的地
4. 如果完全无法推理，返回 {"destination":"","reason":"无法推理"}`;

  const url = `${model.api_base.replace(/\/$/, '')}/chat/completions`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000); // 10 秒超时（GLM-4-Flash 实测约 1.5-3s）
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.model_id,
        messages: [{ role: 'user', content: prompt }],
        // max_tokens 增加到 800：GLM-5.x 推理模型需消耗 reasoning_tokens（可能占 100+），需留足够 content 空间
        max_tokens: 800,
        temperature: 0.3,
        stream: false,
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      console.warn(`[jtd-llm] 模型返回 HTTP ${resp.status}`);
      return {};
    }
    const data = await resp.json();
    // 兼容推理模型：content 为空时尝试从 reasoning_content 提取（兜底）
    const message = data?.choices?.[0]?.message || {};
    let reply = message.content || '';
    if (!reply && message.reasoning_content) {
      // glm-5.x 推理模型可能把答案放在 reasoning_content 里
      reply = message.reasoning_content;
      console.warn('[jtd-llm] content 为空，从 reasoning_content 提取');
    }
    // 提取 JSON（兼容 markdown 代码块包裹）
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[jtd-llm] LLM 返回无 JSON，reply 长度=', reply.length, 'finish_reason=', data?.choices?.[0]?.finish_reason);
      return {};
    }
    const parsed = JSON.parse(jsonMatch[0]);
    const destination = String(parsed.destination || '').trim();
    if (destination) {
      console.log(`[jtd-llm] LLM 推理 destination="${destination}" reason=${parsed.reason || '-'}`);
      return { destination, llm_inferred: true };
    }
    return {};
  } catch (e) {
    console.warn('[jtd-llm] 调用失败:', e?.name === 'AbortError' ? '超时(8s)' : e?.message || e);
    return {};
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 为产品生成走线途经点（与 model-service.buildRouteWaypoints 坐标模板保持一致）。
 * 在 jtd-service 中独立实现，避免循环依赖。
 * @param {string} destination - 目的地
 * @param {number} totalDays - 总天数
 * @returns {Array<{name, lat, lng, day, type, plan}>} 途经点数组
 */
const ROUTE_WAYPOINT_TEMPLATES = {
  '广西巴马': [
    { name: '巴马长寿村', lat: 24.0487, lng: 107.2586, type: 'arrival' },
    { name: '百魔洞景区', lat: 24.0652, lng: 107.2391, type: 'spot' },
    { name: '水晶宫景区', lat: 24.0321, lng: 107.2845, type: 'spot' },
    { name: '盘阳河康养带', lat: 24.0412, lng: 107.2701, type: 'wellness' },
    { name: '巴马汽车总站', lat: 24.0523, lng: 107.2512, type: 'departure' },
  ],
  '广西北海': [
    { name: '北海火车站', lat: 21.4721, lng: 109.1196, type: 'arrival' },
    { name: '银滩旅游区', lat: 21.4417, lng: 109.1286, type: 'spot' },
    { name: '老街历史文化区', lat: 21.4856, lng: 109.1132, type: 'spot' },
    { name: '涠洲岛码头', lat: 21.4632, lng: 109.1089, type: 'spot' },
    { name: '北海福成机场', lat: 21.5417, lng: 109.2632, type: 'departure' },
  ],
  '广西桂林': [
    { name: '桂林火车站', lat: 25.2619, lng: 110.2900, type: 'arrival' },
    { name: '象鼻山景区', lat: 25.2622, lng: 110.2980, type: 'spot' },
    { name: '两江四湖景区', lat: 25.2700, lng: 110.2870, type: 'spot' },
    { name: '阳朔西街', lat: 24.7736, lng: 110.4887, type: 'spot' },
    { name: '桂林两江机场', lat: 25.2181, lng: 110.0389, type: 'departure' },
  ],
  '广西七洞乡': [
    { name: '七洞乡政府', lat: 23.6817, lng: 109.0512, type: 'arrival' },
    { name: '七洞乡康养基地', lat: 23.6852, lng: 109.0491, type: 'wellness' },
    { name: '七洞乡生态园', lat: 23.6781, lng: 109.0568, type: 'spot' },
    { name: '来宾火车站', lat: 23.7256, lng: 109.0612, type: 'departure' },
  ],
};

function buildWaypointsForProduct(destination, totalDays = 3) {
  const destKey = Object.keys(ROUTE_WAYPOINT_TEMPLATES).find((k) => destination.includes(k.replace('广西', '')));
  const templates = destKey ? ROUTE_WAYPOINT_TEMPLATES[destKey] : null;
  const days = Math.max(2, Math.min(7, parseInt(totalDays) || 3));

  if (templates && templates.length >= days) {
    return templates.slice(0, days).map((wp, i) => ({
      ...wp,
      day: `D${i + 1}`,
      plan: i === 0 ? `抵达${wp.name}，办理入住` : i === days - 1 ? `从${wp.name}返程` : `${wp.name}康养体验`,
    }));
  }
  // 兜底：中心坐标环形；未知目的地不造巴马假点
  const center = getCenterCoordFor(destination);
  if (!center) return [];
  const waypoints = [];
  const radius = 0.04;
  for (let i = 0; i < days; i++) {
    const angle = (i / days) * Math.PI * 2 - Math.PI / 2;
    const offset = i === 0 || i === days - 1 ? 0 : radius;
    const lat = center.lat + Math.cos(angle) * offset;
    const lng = center.lng + Math.sin(angle) * offset;
    const isArrival = i === 0;
    const isDeparture = i === days - 1;
    waypoints.push({
      name: isArrival ? `${center.name}抵达点` : isDeparture ? `${center.name}返程点` : `${center.name}Day${i + 1}体验点`,
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      day: `D${i + 1}`,
      type: isArrival ? 'arrival' : isDeparture ? 'departure' : 'spot',
      plan: isArrival ? `抵达${center.name}，办理入住` : isDeparture ? `从${center.name}返程` : `${center.name}康养体验`,
    });
  }
  return waypoints;
}

// 简化的目的地中心坐标（避免依赖 model-service）
const DESTINATION_COORDS = {
  '广西巴马': { lat: 24.0487, lng: 107.2586, name: '巴马瑶族自治县' },
  '广西北海': { lat: 21.4817, lng: 109.1196, name: '北海市' },
  '广西桂林': { lat: 25.2619, lng: 110.2900, name: '桂林市' },
  '广西防城港': { lat: 21.6869, lng: 108.3538, name: '防城港市' },
  '广西七洞乡': { lat: 23.6817, lng: 109.0512, name: '来宾市兴宾区七洞乡' },
};
function getCenterCoordFor(destination) {
  const text = String(destination || '');
  if (!text.trim()) return null;
  const key = Object.keys(DESTINATION_COORDS).find((k) => text.includes(k.replace('广西', '')) || text.includes(k));
  // 未知目的地禁止静默落到巴马坐标
  return key ? DESTINATION_COORDS[key] : null;
}

/**
 * 清洗景点名称：去除网站名/Logo/广告后缀
 */
function cleanSpotName(raw = '') {
  let name = String(raw).trim();
  // 截断常见噪声分隔符
  name = name.split(/\s*[-_|·]\s*/)[0];
  // 去除"景点"前缀的域名残留
  name = name.replace(/^.*\.com\s*/i, '').replace(/^.*\.cn\s*/i, '');
  // 去除尾部括号说明（如"金滩(广西防城港市东兴市..."→"金滩"）
  name = name.replace(/[（(].*$/, '');
  // ★ 乱码检测：非中文/英文/数字/常见标点的字符占比过高 → 丢弃
  const garbleRatio = (name.replace(/[\u4e00-\u9fa5a-zA-Z0-9\s（）()、，。·-]/g, '').length) / Math.max(name.length, 1);
  if (garbleRatio > 0.3) return '';
  // ★ SEO 聚合页标题检测
  if (/景点大全|排行榜|自助游|攻略|旅游网|景点网|trip\.com/i.test(name)) return '';
  // ★ 网页导航文本检测
  if (/首页|当前位置|点击|热门|实景|卫星地图|广场/i.test(name)) return '';
  // ★ 繁体字占比过高检测（>40%视为繁体网页内容）
  const tradCount = (name.match(/[\u4e00-\u9fa5]/g) || []).filter((ch) =>
    '廣東廣西防城港十萬大隱藏觀灣馬龍點頭華國學會兩岸旅遊區協進會'.includes(ch)
  ).length;
  const cjkCount = (name.match(/[\u4e00-\u9fa5]/g) || []).length;
  if (cjkCount > 2 && tradCount / cjkCount > 0.4) return '';
  return name.trim() || '';
}

/**
 * 清洗景点描述：去除电话号码、广告语、HTML残留、乱码
 */
function cleanSpotDesc(raw = '') {
  let desc = String(raw).trim();
  // 去除连续电话号码
  desc = desc.replace(/\+?\d[\d\s-]{7,}/g, '');
  // 去除 whatsapp/热线等广告语
  desc = desc.replace(/whatsapp[^，。]*|報名[^，。]*|熱線[^，。]*/gi, '');
  // 去除 HTML 标签残留
  desc = desc.replace(/<[^>]+>/g, '');
  // 去除"近日，习近平总书记..."等时政内容
  desc = desc.replace(/近日，.*?(指示|讲话|会议)[^，。]*[，。]/g, '');
  // ★ 乱码检测：非中文/英文/数字/常见标点的字符占比过高 → 丢弃
  const garbleRatio = (desc.replace(/[\u4e00-\u9fa5a-zA-Z0-9\s（）()、，。！？；：·"%\-/]/g, '').length) / Math.max(desc.length, 1);
  if (garbleRatio > 0.25) return '';
  // ★ 网页导航文本检测
  if (/首页|当前位置|景点大全>|排行榜|自助游|实景旅游|卫星地图/.test(desc)) return '';
  // ★ 去除重复句（同一片段重复3次以上）
  desc = desc.replace(/(.{5,30})\1{2,}/g, '$1');
  // ★ 去除 TripAdvisor/CTrip 等网站名残留
  desc = desc.replace(/Trip\.com|tripadvisor|海峽兩岸旅遊交流協會|Association\s+For\s+Tourism/i, '');
  return desc.trim().slice(0, 100);
}

/**
 * 为每个 waypoint 补特色景点图/描述。
 * 默认走 dashboard 本地知识库；仅 SPOT_IMAGES_TAVILY=1 时回退 Tavily。
 */
async function enrichWaypointsWithSpots(waypoints = [], destination = '') {
  if (!Array.isArray(waypoints) || !waypoints.length) return waypoints;
  const destName = destination || waypoints[0]?.name || '广西';
  const allowTavily = String(process.env.SPOT_IMAGES_TAVILY || '').trim() === '1';
  console.log(`[jtd-spots] enrich ${waypoints.length} waypoints, dest=${destName}, tavily=${allowTavily}`);

  const enriched = await Promise.all(
    waypoints.map(async (wp, idx) => {
      if (wp.type === 'arrival' || wp.type === 'departure') {
        const localBase = lookupDashboardSpotImages(wp.name) || lookupDashboardSpotImages(destName);
        return {
          ...wp,
          spots: (localBase?.related_spots || []).slice(0, 3).map((s) => ({
            name: s.name,
            desc: s.address || '',
            url: '',
            lat: wp.lat,
            lng: wp.lng,
            source: 'dashboard_local_kb',
          })),
          spot_images: localBase?.spot_images || wp.spot_images || [],
          spot_desc: wp.spot_desc || localBase?.spot_desc || '',
          spot_status: localBase ? 'dashboard_local_kb' : 'skip_endpoint',
        };
      }

      const local = lookupDashboardSpotImages(wp.name)
        || lookupDashboardSpotImages(`${destName} ${wp.name}`);
      if (local?.spot_images?.length) {
        return {
          ...wp,
          spots: (local.related_spots || []).slice(0, 3).map((s) => ({
            name: s.name,
            desc: s.address || s.category || '',
            url: '',
            lat: Number((wp.lat + (Math.random() - 0.5) * 0.015).toFixed(6)),
            lng: Number((wp.lng + (Math.random() - 0.5) * 0.015).toFixed(6)),
            source: 'dashboard_local_kb',
          })),
          spot_images: local.spot_images,
          spot_desc: wp.spot_desc || local.spot_desc || '',
          spot_status: local.image_source || 'dashboard_local_kb',
        };
      }

      if (!allowTavily) {
        return { ...wp, spots: [], spot_images: wp.spot_images || [], spot_status: 'local_kb_miss' };
      }

      try {
        const center = { name: `${destName} ${wp.name}`, lat: wp.lat, lng: wp.lng };
        const t0 = Date.now();
        const result = await searchCategory('spot', center, 5000);
        const elapsed = Date.now() - t0;
        const spots = (result?.source_results || [])
          .filter((item) => {
            const name = String(item.title || '').trim();
            if (!name || name.length < 3) return false;
            if (/[a-z]{20,}/i.test(name)) return false;
            if (/景点大全|排行榜|自助游|攻略|旅游网|首页|当前位置|实景|卫星地图|trip\.com/i.test(name)) return false;
            return true;
          })
          .slice(0, 3).map((item, i) => ({
            name: cleanSpotName(item.title || `景点${i + 1}`),
            desc: cleanSpotDesc(String(item.content || '').slice(0, 100)),
            url: item.url || '',
            lat: Number((wp.lat + (Math.random() - 0.5) * 0.015).toFixed(6)),
            lng: Number((wp.lng + (Math.random() - 0.5) * 0.015).toFixed(6)),
            source: 'tavily',
          }))
          .filter((s) => s.name && s.name.length >= 2);
        const images = Array.isArray(result?.images) ? result.images.slice(0, 2) : [];
        console.log(`[jtd-tavily] waypoint[${idx}] ${wp.name} spots=${spots.length} imgs=${images.length} ${elapsed}ms`);
        return { ...wp, spots, spot_images: images, spot_status: result?.source_status || 'unknown' };
      } catch (e) {
        console.warn(`[jtd-tavily] waypoint[${idx}] ${wp.name} fail:`, e?.message || e);
        return { ...wp, spots: [], spot_status: 'error', spot_error: e?.message || String(e) };
      }
    })
  );

  const totalSpots = enriched.reduce((sum, wp) => sum + (wp.spots?.length || 0), 0);
  console.log(`[jtd-spots] done, spots=${totalSpots}`);
  return enriched;
}

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

export class JtdTravelService extends BaseInterfaceService {
  constructor(options = {}) {
    super({
      skillKey: 'travel_route',
      provider: 'jintiaodong',
      sourcePath: 'jtd',
      config: options,
    });
    this.configuredMode = options.mode || process.env.JTD_API_MODE || 'real';
    this.client = options.client || createJtdClient(options.clientOptions || options);
    this.configured = this.client.isConfigured();
    // P0：auto 未配置时不再静默切 mock；仅显式 mode=mock 才用 MOCK_PRODUCTS
    let effectiveMode = this.configuredMode === 'auto' && !this.configured
      ? 'real'
      : this.configuredMode;
    // 生产禁止 mock 出卡（需 FLATTALK_ALLOW_JTD_MOCK=1 才允许显式 mock）
    if (effectiveMode === 'mock' && !isJtdMockAllowed()) {
      console.warn('[jtd] JTD_API_MODE=mock 已忽略（需 FLATTALK_ALLOW_JTD_MOCK=1）');
      effectiveMode = 'real';
    }
    this.mode = effectiveMode;
  }

  async buildRouteProductContext(request = {}) {
    const query = buildSearchQuery(request);
    const userMessage = request.message || request.text || '';

    // ===== 数据源优先级链：本地旅居线路 > 实时接口 > 本地缓存知识库（P0 禁止 mock 出卡）=====
    // 0. 优先查防城港本地线路知识库（5条官方认证线路）
    const localRouteCtx = await buildLocalRouteContext(userMessage, query.productDomain);
    if (localRouteCtx) {
      console.log(`[jtd] 本地线路知识库命中: ${localRouteCtx.selected_product?.product_name}`);

      // 即使命中本地线路，如果用户点的是"检查可订状态"按钮，也要调金跳动可订校验接口
      const actionKey = request?.context?.action_key || request?.action_key || '';
      if (actionKey === 'travel_route.check_availability' || shouldCheckAvailability(request)) {
        try {
          const selected = localRouteCtx.selected_product;
          const availability = await callAvailability({
            mode: this.mode,
            client: this.client,
            selected,
            request,
          });
          const normalizedAvailability = availability ? normalizeAvailability(availability) : null;
          if (normalizedAvailability) {
            localRouteCtx.availability = { ...availability, normalized: normalizedAvailability };
            localRouteCtx.handoff_enabled = Boolean(
              normalizedAvailability?.available && handoffUrls(normalizedAvailability).length
            );
          }
          localRouteCtx.calls = [availability].filter(Boolean).map(summarizeCall);
        } catch (e) {
          console.warn('[jtd] 本地线路可订校验失败:', e?.message || e);
          localRouteCtx.calls = [{ endpoint: 'checkAvailability', ok: false, error: e?.message || String(e) }];
        }
      }

      return localRouteCtx;
    }

    // 1. 调真实接口
    const search = await callSearch({ mode: this.mode, client: this.client, query });
    logJtdCall({ configuredMode: this.configuredMode, mode: this.mode, configured: this.configured, query, search });
    let products = normalizeSearchRecords(search);
    let sourceStatus = sourceStatusFrom(search);
    let dataSource = 'real_api';

    // 2. 接口失败时，查本地缓存知识库
    if (!products.length) {
      console.warn('[jtd] 真实接口无数据，回退查本地知识库');
      const localProducts = queryLocalKnowledge(userMessage, query.productDomain);
      if (localProducts.length) {
        products = localProducts;
        sourceStatus = 'local_kb_cache';
        dataSource = 'local_kb';
        console.log(`[jtd] 本地知识库命中 ${localProducts.length} 条旅居产品`);
      }
    }

    // 3. P0：禁止静默落到 MOCK_PRODUCTS（仅 mode=mock 时已在 callSearch 返回 mock）
    if (!products.length) {
      console.warn('[jtd] 真实接口与本地知识库均无数据，返回空产品（禁止 mock 出卡）');
      sourceStatus = search?.source_status || 'unavailable';
      dataSource = 'empty';
    }

    const selected = selectProduct(products, userMessage, request);

    // LLM 补字段：selected_product 的 destination 缺失时，调用 LLM 推理补齐
    if (selected && !selected.destination) {
      try {
        const inferred = await inferMissingFieldsWithLlm(selected, userMessage);
        if (inferred.destination) {
          selected.destination = inferred.destination;
          selected.llm_inferred = true;
          console.log(`[jtd] LLM 已补齐 destination="${inferred.destination}" for product=${selected.product_id}`);
        }
      } catch (e) {
        console.warn('[jtd] LLM 补字段异常:', e?.message || e);
      }
    }

    // 生成走线途经点 + Tavily 特色景点图层（仅 sojourn_route，跳过 sojourn_base）
    let enrichedWaypoints = [];
    const finalDestination = selected?.destination || '';
    if (finalDestination && (query.productDomain === 'sojourn_route' || !query.productDomain)) {
      try {
        // 从产品名/用户消息提取天数
        const days = inferDaysFromText(userMessage) || inferDaysFromText(selected?.product_name || '') || 3;
        const baseWaypoints = buildWaypointsForProduct(finalDestination, days);
        // 调 Tavily 为每个 waypoint 拉特色景点
        enrichedWaypoints = await enrichWaypointsWithSpots(baseWaypoints, finalDestination);
      } catch (e) {
        console.warn('[jtd] waypoints + Tavily 增强失败:', e?.message || e);
      }
    }

    const detail = selected?.product_id && shouldFetchDetail(request)
      ? await callDetail({ mode: this.mode, client: this.client, selected })
      : null;
    const availability = selected?.product_id && shouldCheckAvailability(request)
      ? await callAvailability({ mode: this.mode, client: this.client, selected, request })
      : null;
    const normalizedAvailability = availability ? normalizeAvailability(availability) : null;

    // 取数即入库：仅真实接口数据写入本地知识库（mock 和本地缓存不重复入库）
    if (search.source_status === 'real_data' && search.ok && products.length) {
      try {
        this.capture(products.map((p, i) => ({
          id: p.product_id || `jtd_${search.request_id}_${i}`,
          provider: 'jintiaodong',
          type: 'sojourn_product',
          data: p,
          capturedAt: new Date().toISOString(),
        })));
        console.log(`[jtd] 真实接口数据已写入本地知识库: ${products.length} 条`);
      } catch (err) {
        console.warn('[jtd] capture to local knowledge failed:', err?.message || err);
      }
    }

    return {
      provider: 'jintiaodong',
      mode: this.mode,
      configured_mode: this.configuredMode,
      required: true,
      query,
      // productDomain 用于下游模板分流：sojourn_route / sojourn_base
      product_domain: query.productDomain || 'sojourn_route',
      product_type: query.product_type || '旅居线路',
      source_status: sourceStatus,
      data_source: dataSource,
      products,
      selected_product: mergeProductDetail(selected, detail),
      // 走线途经点（含 Tavily 增强的特色景点图层），由 fillRouteCard 注入模板
      waypoints: enrichedWaypoints,
      detail,
      availability,
      handoff_enabled: Boolean(normalizedAvailability?.available && handoffUrls(normalizedAvailability).length),
      calls: [search, detail, availability].filter(Boolean).map(summarizeCall),
      warnings: warningsFrom(search, products),
      ...(normalizedAvailability ? { availability: { ...availability, normalized: normalizedAvailability } } : { availability }),
    };
  }
}

// 从文本中提取天数（简化版，避免与 inferDays 重复）
function inferDaysFromText(text) {
  if (!text) return null;
  const match = String(text).match(/(\d+)\s*(天|日)/);
  if (match) return Number(match[1]);
  if (/三天|三日/.test(text)) return 3;
  if (/四天|四日/.test(text)) return 4;
  if (/五天|五日/.test(text)) return 5;
  if (/七天|七日|一周/.test(text)) return 7;
  return null;
}

export function createJtdTravelService(options = {}) {
  return new JtdTravelService(options);
}

export function buildSearchQuery(request = {}) {
  const text = String(request.message || request.text || request.query || '');
  const params = request.context?.action_params || request.params || {};
  const city = String(params.destination || params.city || request.context?.previous_destination || '').trim()
    || inferCity(text);
  return {
    tenantId: request.context?.tenantId || request.context?.tenant_id || process.env.JTD_TENANT_ID || '042788',
    productDomain: /基地|住宿|住哪|酒店|客栈|民宿/.test(text) ? 'sojourn_base' : 'sojourn_route',
    ...(city ? { destinationCity: city } : {}),
    city,
    product_type: /基地|住宿|住哪/.test(text) ? '旅居基地' : '旅居线路',
    days: inferDays(text),
    budget: inferBudget(text),
    pageNum: 1,
    // 扩容到 50，确保不漏产品（之前 pageSize=3 会截断真实结果）
    pageSize: 50,
    product_id: params.product_id || request.context?.previous_product_id || '',
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
  // 可订校验通过时，构造下单 H5 URL（需 checkIn/checkOut 参数）
  const productId = String(data.productId || data.product_id || data.routeId || '');
  const h5Base = process.env.JTD_H5_BASE_URL || 'https://lvjutest.jtdcn.cn/h5';
  let h5OrderUrl = data.h5_order_url || data.h5OrderUrl || '';
  if (!h5OrderUrl && productId && available) {
    // 从原始请求 payload 中获取入住日期
    const reqPayload = apiResult.request?.body || {};
    const checkIn = reqPayload.checkIn || '';
    const checkOut = reqPayload.checkOut || '';
    const dateParams = checkIn ? `&checkIn=${checkIn}&checkOut=${checkOut}` : '';
    // SPA hash 路由格式：#/pages/order/index
    h5OrderUrl = `${h5Base}/#/pages/order/index?productId=${productId}${dateParams}`;
  }
  return {
    available,
    source_status: apiResult.source_status || 'real_data',
    final_price: sanitizePrice(data.finalPrice ?? data.final_price ?? data.price ?? data.minPrice ?? null),
    stock: data.stock ?? data.inventory ?? data.availableStockCount ?? null,
    h5_order_url: h5OrderUrl,
    h5_product_url: data.h5_product_url || (productId ? `${h5Base}/#/pages/order/index?productId=${productId}` : ''),
    raw: data,
  };
}

async function callSearch({ mode, client, query }) {
  if (mode === 'mock') return mockResult('searchProducts', { records: MOCK_PRODUCTS });
  const real = client.isConfigured() ? await client.searchProducts(query) : unavailable('searchProducts', 'config_missing');
  // P0：auto 失败不再回落到 mock 产品
  return real;
}

async function callDetail({ mode, client, selected }) {
  if (mode === 'mock') return mockResult('productDetail', { ...selected, itinerary: mockItinerary(selected) });
  const real = client.isConfigured()
    ? await client.productDetail(selected.product_id, selected.sku_id)
    : unavailable('productDetail', 'config_missing');
  return real;
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
  return real;
}

function normalizeProduct(record = {}, index = 0) {
  const productId = record.product_id || record.productId || record.outProductId || record.id || '';
  const skuId = record.sku_id || record.skuId || record.outSkuId || '';
  const name = record.product_name || record.productName || record.routeName || record.name || '';
  let destination = record.destination || record.destinationCity || record.city || record.routeCity || '';
  const rawPrice = record.price_amount ?? record.priceAmount ?? record.price?.amount ?? record.salePrice ?? record.minPrice ?? null;
  const stock = record.stock ?? record.inventory ?? record.inventoryStock ?? null;
  const price = sanitizePrice(rawPrice);

  // destination 兜底：接口字段为空时，从产品名提取广西地名
  if (!destination) {
    destination = inferDestinationFromName(name);
  }

  // 从产品名称中提取天数（如 "三日"、"5天"、"四日"）
  const daysMatch = name.match(/(\d+)[天日]|([三四五六七八九十]+)[天日]/);
  let days = null;
  if (daysMatch) {
    if (daysMatch[1]) {
      days = parseInt(daysMatch[1]);
    } else if (daysMatch[2]) {
      const chineseToNumber = { '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
      days = chineseToNumber[daysMatch[2]] || null;
    }
  }

  return {
    product_id: String(productId || ''),
    sku_id: String(skuId || ''),
    product_name: String(name || `旅居产品${index + 1}`),
    destination: String(destination || ''),
    city: String(record.city || destination || ''),
    product_domain: String(record.productDomain || record.product_domain || ''),
    days: days,
    nights: days ? days - 1 : null,
    price_amount: price,
    price_label: record.price_label || (price ? `约${price}元/人` : '价格待确认'),
    price_warning: price !== null && price < 1,
    stock: stock === null || stock === undefined || stock === '' ? null : Number(stock),
    inventory_status: record.inventory_status || record.inventoryStatus || (Number(stock) > 0 ? 'available' : 'unknown'),
    tags: normalizeTags(record.tags || record.productTags || record.routeFeatures || record.health_tags),
    handoff_urls: buildHandoffUrls(record, productId, skuId),
    vendor_trace_id: record.vendor_trace_id || record.vendorRequestId || record.requestId || '',
    raw: record.raw || record,
  };
}

/**
 * 从产品名中提取广西旅居目的地。
 * 金跳动接口 destination 字段常为空，需从产品名兜底提取。
 * @param {string} name - 产品名
 * @returns {string} 提取到的目的地（如"广西七洞乡"），未匹配返回空字符串
 */
const KNOWN_GX_DESTINATIONS = [
  '巴马', '北海', '涠洲岛', '防城港', '东兴', '桂林', '阳朔', '南宁', '柳州',
  '百色', '钦州', '梧州', '贺州', '玉林', '贵港', '河池', '来宾', '崇左',
  '七洞乡', '嘉路', '白浪滩', '簕山', '芒街', '港口区',
];
function inferDestinationFromName(name) {
  if (!name) return '';
  const text = String(name);
  // 按长度降序匹配，避免"广西北海"被"广西"截断
  for (const dest of KNOWN_GX_DESTINATIONS.sort((a, b) => b.length - a.length)) {
    if (text.includes(dest)) return `广西${dest}`;
  }
  return '';
}

/**
 * 查询本地知识库缓存（interface_cache/jintiaodong_index.json）。
 * 当真实接口失败时，从本地缓存读取旅居产品数据。
 * @param {string} message - 用户消息（用于关键词匹配）
 * @param {string} productDomain - 产品域 sojourn_route / sojourn_base
 * @returns {Array} 归一化后的产品数组
 */
function queryLocalKnowledge(message = '', productDomain = '') {
  try {
    if (!fs.existsSync(LOCAL_KB_FILE)) {
      console.log('[jtd] 本地知识库文件不存在:', LOCAL_KB_FILE);
      return [];
    }
    const index = JSON.parse(fs.readFileSync(LOCAL_KB_FILE, 'utf8'));
    if (!Array.isArray(index) || index.length === 0) return [];

    // 提取 data 字段，并归一化
    let products = index
      .filter((r) => r && r.data && (r.data.product_id || r.data.id))
      .map((r) => {
        const p = r.data;
        // 确保 product_domain 字段存在
        if (!p.product_domain && r.type === 'sojourn_product') {
          // 从 product_type 推断
          p.product_domain = p.product_type === '旅居基地' ? 'sojourn_base' : 'sojourn_route';
        }
        return p;
      });

    // 按 productDomain 过滤
    if (productDomain) {
      const filtered = products.filter((p) => !p.product_domain || p.product_domain === productDomain);
      if (filtered.length) products = filtered;
    }

    // 按用户消息关键词过滤（如"巴马"→匹配 destination/product_name 含"巴马"的产品）
    const text = String(message || '');
    if (text) {
      const keywordMatched = products.filter((p) => {
        const name = p.product_name || '';
        const dest = p.destination || '';
        return /巴马|北海|桂林|防城港|七洞乡|东兴/.test(text)
          ? (name.includes(text.match(/巴马|北海|桂林|防城港|七洞乡|东兴/)?.[0] || '') || dest.includes(text.match(/巴马|北海|桂林|防城港|七洞乡|东兴/)?.[0] || ''))
          : true;
      });
      if (keywordMatched.length) products = keywordMatched;
    }

    console.log(`[jtd] 本地知识库读取: 总${index.length}条, 过滤后${products.length}条 (domain=${productDomain})`);
    return products;
  } catch (err) {
    console.warn('[jtd] 本地知识库读取失败:', err?.message || err);
    return [];
  }
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

/**
 * 构造金跳动 H5 跳转地址。
 * 优先使用接口返回的 handoff_urls；若接口未返回，则按接口文档 handoff 模板构造。
 * @see d:\GuiCare\guixiaoyang-chat-system\skill-packages\travel_route\assets\config\jintiaodong_api.json → handoff 节
 */
function buildHandoffUrls(record = {}, productId = '', skuId = '') {
  // 1. 先尝试从接口返回数据中直接提取
  const existing = normalizeHandoffUrls(record.handoff_urls || record.handoffUrls || record);
  if (existing.h5_product_url || existing.h5_order_url) return existing;

  // 2. 接口未返回 → 按接口文档模板构造
  const h5Base = process.env.JTD_H5_BASE_URL || 'https://lvjutest.jtdcn.cn/h5';
  const pid = String(productId || record.productId || record.product_id || '');
  if (!pid) return existing;

  const sku = skuId || record.skuId || record.sku_id || '';
  const skuParam = sku ? `&skuId=${sku}` : '';
  return {
    h5_product_url: `${h5Base}/#/pages/order/index?productId=${pid}${skuParam}`,
    h5_order_url: `${h5Base}/#/pages/order/index?productId=${pid}${skuParam}`,
    mini_program_url: '',
  };
}

function normalizeHandoffUrls(value = {}) {
  // 确保 h5 URL 使用 SPA hash 路由格式（#/pages/...）
  const fixHashRoute = (url) => {
    if (!url) return '';
    // 已有 #/ 则不处理
    if (url.includes('#/pages/')) return url;
    // 旧格式 /h5/pages/ → /h5/#/pages/
    return url.replace(/\/h5\/pages\//, '/h5/#/pages/');
  };
  return {
    h5_product_url: fixHashRoute(value.h5_product_url || value.h5ProductUrl || value.h5Url || value.productUrl || ''),
    h5_order_url: fixHashRoute(value.h5_order_url || value.h5OrderUrl || value.orderUrl || ''),
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
  if (/防城港|东兴|芒街|嘉路|白浪滩|簕山/.test(text)) return '防城港';
  if (/北海|海边|海滨/.test(text)) return '北海';
  if (/桂林|阳朔/.test(text)) return '桂林';
  if (/南宁/.test(text)) return '南宁';
  if (/百色/.test(text)) return '百色';
  if (/巴马|长寿/.test(text)) return '巴马';
  if (/钦州/.test(text)) return '钦州';
  if (/崇左/.test(text)) return '崇左';
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

export function selectProduct(products, text, request = {}) {
  if (!products.length) return null;
  const params = request.context?.action_params || request.params || {};
  const productId = String(params.product_id || request.context?.previous_product_id || '').trim();
  if (productId) {
    const byId = products.find((item) => String(item.product_id) === productId);
    if (byId) return byId;
    // 有锁定 product_id 却未命中时，禁止静默落到 products[0]
    return null;
  }
  const dest = String(params.destination || params.city || request.context?.previous_destination || '').trim();
  const blob = `${text || ''} ${dest}`;
  const pickCity = (re) => products.find((item) => re.test(`${item.destination || ''} ${item.city || ''} ${item.product_name || ''}`)) || null;
  if (/桂林|阳朔|漓江|遇龙河/.test(blob)) return pickCity(/桂林|阳朔/);
  if (/北海|海边|海滨/.test(blob)) return pickCity(/北海/);
  if (/巴马|长寿|百色/.test(blob)) return pickCity(/巴马|百色/);
  if (/防城港|东兴|嘉路/.test(blob)) return pickCity(/防城港|东兴/);
  // 有明确锁定目的地时，不要静默落到 products[0]（常为巴马 mock）
  if (dest) {
    return products.find((item) => {
      const hay = `${item.destination || ''} ${item.city || ''} ${item.product_name || ''}`;
      return hay.includes(dest) || dest.includes(String(item.destination || item.city || ''));
    }) || null;
  }
  // 完全无锁定信号时也不静默 products[0]（首条常为巴马 mock）；由上层走澄清/远程缺口卡
  return null;
}

/** 参考价目录（与 MOCK_PRODUCTS 一致）。real/auto 下默认空，避免假产品渗入确认卡。 */
export function listReferenceTravelProducts() {
  if (!isJtdMockAllowed()) return [];
  if (String(process.env.FLATTALK_ALLOW_JTD_MOCK || '').trim() === '1') {
    return MOCK_PRODUCTS.map((p) => ({ ...p }));
  }
  if (String(process.env.JTD_API_MODE || '').trim() === 'mock') {
    return MOCK_PRODUCTS.map((p) => ({ ...p }));
  }
  return [];
}

function isJtdMockAllowed(env = process.env) {
  if (String(env.FLATTALK_ALLOW_JTD_MOCK || '').trim() === '1') return true;
  const runtime = String(env.FLATTALK_RUNTIME_MODE || env.NODE_ENV || 'local').toLowerCase();
  if (runtime === 'production' || runtime === 'prod') return false;
  return true;
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
