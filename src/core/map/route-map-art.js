/**
 * 旅居线路地图艺术底图
 * 流水线：地理丘陵/卫星底图 → Seedream 图生图美化 → 供 SVG 嵌入
 * 可选：纯文生图（无底图时）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readModelRegistry, resolveModelApiKey } from '../model-runtime/model-registry.js';

const ART_CACHE_DIR = path.join(process.cwd(), 'data', 'sojourn-map-art-cache');

/** 途经点语义：自然 + 人文要素 */
const FEATURE_RULES = [
  { key: 'coast', label: '滨海', glyph: '海', color: '#0288D1', re: /海|滩|湾|岛|港|渔|滨|金滩|白浪|京族三岛|海岸/ },
  { key: 'mountain', label: '山川', glyph: '山', color: '#2E7D32', re: /山|峰|岭|崖|岩|尧山|金钟山|象鼻山|十万大山|森林|林/ },
  { key: 'lake', label: '湖泊', glyph: '湖', color: '#1565C0', re: /湖|潭|泊|水库|漓江|江|河|溪|泉|温泉|溶洞|丰鱼岩|画廊/ },
  { key: 'grassland', label: '草原', glyph: '草', color: '#7CB342', re: /草|原|牧场|田园|稻|花海|湿地/ },
  { key: 'canyon', label: '峡谷', glyph: '峡', color: '#6D4C41', re: /峡|谷|沟|涧|峡谷|山谷|谷地/ },
  { key: 'pavilion', label: '亭台', glyph: '亭', color: '#EF6C00', re: /亭|台|阁|廊|桥|塔|寺|庙|楼/ },
  { key: 'museum', label: '馆所', glyph: '馆', color: '#8E24AA', re: /馆|博物|纪念|文化中心|非遗|博物馆|展览/ },
  { key: 'base', label: '基地', glyph: '基', color: '#43A047', re: /基地|康养中心|酒店|入住|颐养|庄园|大本营/ },
  { key: 'wellness', label: '康养', glyph: '养', color: '#8E24AA', re: /康养|理疗|足浴|艾灸|太极|八段锦|药膳|氧疗/ },
  { key: 'village', label: '村镇', glyph: '村', color: '#FB8C00', re: /村|街|镇|西街|古城|圩|寨/ },
];

export function classifyWaypointFeature(name = '', desc = '', type = '') {
  if (type === 'base' || type === 'arrival') return FEATURE_RULES.find((f) => f.key === 'base');
  if (type === 'departure') return { key: 'departure', label: '返程', glyph: '返', color: '#1976D2' };
  if (type === 'wellness') return FEATURE_RULES.find((f) => f.key === 'wellness');
  const blob = `${name} ${desc}`;
  for (const rule of FEATURE_RULES) {
    if (rule.re.test(blob)) return rule;
  }
  return { key: 'spot', label: '景点', glyph: '景', color: '#FF7826' };
}

export function summarizeRouteFeatures(waypoints = []) {
  const counts = {};
  const list = [];
  for (const wp of waypoints) {
    const f = classifyWaypointFeature(wp.name || '', wp.spot_desc || wp.plan || '', wp.type || '');
    counts[f.key] = (counts[f.key] || 0) + 1;
    list.push({ name: wp.name || '', feature: f.key, label: f.label });
  }
  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, n]) => `${FEATURE_RULES.find((r) => r.key === k)?.label || k}×${n}`);
  return { counts, list, topLabels: top };
}

export function buildRouteArtPrompt({
  routeName = '',
  destination = '',
  waypoints = [],
  mode = 'img2img',
} = {}) {
  const summary = summarizeRouteFeatures(waypoints);
  const names = waypoints.map((w) => w.name).filter(Boolean).slice(0, 8).join('、');
  const featureHint = summary.topLabels.length
    ? summary.topLabels.join('，')
    : '山水康养';

  const common = [
    `中国广西${destination || ''}旅居康养手绘地图插画`,
    `线路「${routeName || '旅居线路'}」`,
    `需清晰体现：${featureHint}`,
    names ? `途经：${names}` : '',
    '风格：温暖水彩+轻矢量，适老友好，高对比但不刺眼',
    '保留地理空间关系：山体起伏、水系走向、谷地、滨海轮廓要可读',
    '点缀亭台楼阁、馆所、康养基地屋顶等人文符号，小而清晰',
    '不要真实人脸，不要文字水印，不要 UI 按钮，不要照片写实街景',
    '俯视稍倾斜的示意地图构图，留出路线叠加空间，色彩柔和',
  ].filter(Boolean).join('。');

  if (mode === 'img2img') {
    return `${common}。请以参考图的丘陵/地形与水系走向为地理骨架做艺术化转绘，强化山川湖泊草原峡谷谷地与人文亭台馆所的语义表达，生成一张可作旅居线路底图的精美插画。`;
  }
  return `${common}。请从零生成一张可作旅居线路底图的精美插画，突出广西喀斯特/滨海/森林等地域特征。`;
}

export function pickSeedreamModel({ prefer = 'doubao-seedream-5.0-lite' } = {}) {
  const models = readModelRegistry().filter(
    (m) => m && m.is_active !== false && m.model_type === 'image_generation',
  );
  return models.find((m) => m.name === prefer)
    || models.find((m) => /seedream-5\.0-pro/i.test(m.name || ''))
    || models.find((m) => /seedream/i.test(m.name || ''))
    || models[0]
    || null;
}

function ensureArtCacheDir() {
  if (!fs.existsSync(ART_CACHE_DIR)) fs.mkdirSync(ART_CACHE_DIR, { recursive: true });
}

function artCacheKey(parts = {}) {
  return crypto.createHash('md5').update(JSON.stringify(parts)).digest('hex');
}

function readArtCache(key) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ART_CACHE_DIR, `${key}.json`), 'utf8'));
  } catch {
    return null;
  }
}

function writeArtCache(key, payload) {
  ensureArtCacheDir();
  const slim = { ...payload };
  fs.writeFileSync(path.join(ART_CACHE_DIR, `${key}.json`), JSON.stringify(slim, null, 2), 'utf8');
  if (payload?.data_uri) {
    const b64 = String(payload.data_uri).replace(/^data:image\/\w+;base64,/, '');
    try {
      fs.writeFileSync(path.join(ART_CACHE_DIR, `${key}.jpg`), Buffer.from(b64, 'base64'));
    } catch { /* ignore */ }
  }
}

/**
 * 拉取地理底图：优先 terrain（丘陵），其次 satellite，再次 roadmap
 */
export async function fetchGeoBaseMapDataUri({
  centerLat,
  centerLng,
  zoom = 10,
  size = '800*840',
  downloadImageAsBase64,
  buildStaticMapUrl,
} = {}) {
  if (!downloadImageAsBase64 || !buildStaticMapUrl) {
    return { ok: false, error: 'missing_helpers' };
  }
  const center = { lat: centerLat, lng: centerLng };
  const maptypes = ['terrain', 'satellite', 'roadmap'];
  for (const maptype of maptypes) {
    try {
      let url = buildStaticMapUrl(center, [], { zoom, size, scale: 2 });
      if (/[?&]maptype=/.test(url)) {
        url = url.replace(/([?&]maptype=)[^&]*/i, `$1${maptype}`);
      } else {
        url += `${url.includes('?') ? '&' : '?'}maptype=${maptype}`;
      }
      const dataUri = await downloadImageAsBase64(url, 15000);
      if (dataUri && dataUri.startsWith('data:image')) {
        return { ok: true, data_uri: dataUri, maptype, url };
      }
    } catch {
      // try next
    }
  }
  return { ok: false, error: 'geo_base_unavailable' };
}

/**
 * 调用火山 Seedream：文生图 / 图生图
 */
export async function callSeedreamImage({
  model,
  prompt,
  referenceDataUri = '',
  size = '2048x2048',
  timeoutMs = 120000,
} = {}) {
  if (!model?.api_base || !model?.model_id) {
    return { ok: false, error: 'seedream_model_incomplete' };
  }
  const apiKey = resolveModelApiKey(model);
  if (!apiKey) return { ok: false, error: 'seedream_api_key_missing' };

  const body = {
    model: model.model_id,
    prompt: String(prompt || '').slice(0, 2000),
    size,
    response_format: 'b64_json',
    watermark: false,
  };
  if (referenceDataUri) {
    body.image = referenceDataUri;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const endpoint = `${String(model.api_base).replace(/\/$/, '')}/images/generations`;
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await resp.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (!resp.ok) {
      return {
        ok: false,
        error: json?.error?.message || json?.message || `http_${resp.status}`,
        raw: json,
      };
    }
    const item = Array.isArray(json?.data) ? json.data[0] : null;
    if (item?.b64_json) {
      return {
        ok: true,
        data_uri: `data:image/jpeg;base64,${item.b64_json}`,
        mode: referenceDataUri ? 'img2img' : 'text2img',
      };
    }
    if (item?.url) {
      return {
        ok: true,
        url: item.url,
        mode: referenceDataUri ? 'img2img' : 'text2img',
        raw: json,
      };
    }
    return { ok: false, error: 'empty_image', raw: json };
  } catch (e) {
    return {
      ok: false,
      error: e?.name === 'AbortError' ? 'seedream_timeout' : (e?.message || 'seedream_failed'),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 完整艺术底图：地理丘陵 → Seedream 图生图；失败则退回丘陵/卫星
 */
export async function buildRouteMapArtBackground({
  routeId = '',
  routeName = '',
  destination = '',
  waypoints = [],
  centerLat,
  centerLng,
  zoom = 10,
  size = '800*840',
  enableAi = true,
  preferModel = 'doubao-seedream-5.0-lite',
  downloadImageAsBase64,
  buildStaticMapUrl,
} = {}) {
  const features = summarizeRouteFeatures(waypoints);
  const cacheKey = artCacheKey({
    routeId,
    routeName,
    destination,
    zoom,
    size,
    enableAi: !!enableAi,
    wp: waypoints.map((w) => `${w.name}|${w.lat}|${w.lng}`).join(';'),
  });
  const cached = readArtCache(cacheKey);
  if (cached?.data_uri) {
    return { ...cached, cached: true, features };
  }

  const geo = await fetchGeoBaseMapDataUri({
    centerLat,
    centerLng,
    zoom,
    size,
    downloadImageAsBase64,
    buildStaticMapUrl,
  });

  let result = {
    ok: false,
    data_uri: '',
    source: 'none',
    maptype: geo.maptype || '',
    features,
    prompt: '',
    error: '',
  };

  const aiEnabled = enableAi !== false
    && String(process.env.FLATTALK_ROUTE_MAP_AI || '1') !== '0';

  if (aiEnabled) {
    const model = pickSeedreamModel({ prefer: preferModel });
    const prompt = buildRouteArtPrompt({
      routeName,
      destination,
      waypoints,
      mode: geo.ok ? 'img2img' : 'text2img',
    });
    result.prompt = prompt;
    if (model) {
      const gen = await callSeedreamImage({
        model,
        prompt,
        referenceDataUri: geo.ok ? geo.data_uri : '',
        size: '2048x2048',
        timeoutMs: Number(process.env.FLATTALK_ROUTE_MAP_AI_TIMEOUT_MS || 120000),
      });
      if (gen.ok && gen.data_uri) {
        result = {
          ok: true,
          data_uri: gen.data_uri,
          source: gen.mode === 'img2img' ? 'seedream_img2img' : 'seedream_text2img',
          maptype: geo.maptype || '',
          features,
          prompt,
          model: model.name,
        };
        writeArtCache(cacheKey, result);
        return { ...result, cached: false };
      }
      if (gen.ok && gen.url && downloadImageAsBase64) {
        const downloaded = await downloadImageAsBase64(gen.url, 20000);
        if (downloaded) {
          result = {
            ok: true,
            data_uri: downloaded,
            source: gen.mode === 'img2img' ? 'seedream_img2img' : 'seedream_text2img',
            maptype: geo.maptype || '',
            features,
            prompt,
            model: model.name,
          };
          writeArtCache(cacheKey, result);
          return { ...result, cached: false };
        }
      }
      result.error = gen.error || 'seedream_failed';
    } else {
      result.error = 'no_seedream_model';
    }
  }

  if (geo.ok && geo.data_uri) {
    result = {
      ok: true,
      data_uri: geo.data_uri,
      source: `geo_${geo.maptype || 'static'}`,
      maptype: geo.maptype || '',
      features,
      prompt: result.prompt,
      error: result.error,
    };
    writeArtCache(cacheKey, result);
    return { ...result, cached: false };
  }

  return { ...result, ok: false };
}
