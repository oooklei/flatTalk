/**
 * 腾讯静态地图本地缓存代理
 * - 成功拉取的 PNG/JPG 落盘，供配额耗尽（status=121）时降级
 * - 这是周边助手「缓存瓦片图降级」的服务端实现（与旅居 SVG 方案无关）
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import {
  getOrderedWsKeyPairs,
  isWsQuotaStatus,
  markWsKeyExhausted,
  signWsRequest,
} from './tencent-key-pool.js';

const CACHE_DIR = path.join(process.cwd(), 'data', 'map-static-cache');
const META_FILE = path.join(CACHE_DIR, 'index.json');

function ensureDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function loadMeta() {
  ensureDir();
  try {
    return JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
  } catch {
    return { entries: {} };
  }
}

function saveMeta(meta) {
  ensureDir();
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2), 'utf8');
}

export function makeStaticCacheKey({ centerLat, centerLng, zoom = 11, size = '600*420', markers = '' } = {}) {
  const raw = [
    Number(centerLat).toFixed(5),
    Number(centerLng).toFixed(5),
    zoom,
    size,
    String(markers || '').slice(0, 200),
  ].join('|');
  return crypto.createHash('md5').update(raw).digest('hex');
}

function buildTencentStaticUrl(pair, { centerLat, centerLng, zoom = 11, size = '600*420', markers = '' } = {}) {
  if (!pair?.key) return '';

  const params = {
    center: `${centerLat},${centerLng}`,
    zoom: String(zoom),
    size: String(size),
    maptype: 'roadmap',
  };
  if (markers) params.markers = markers;

  const encodedQuery = Object.keys(params).sort()
    .map((k) => `${k}=${encodeURIComponent(params[k])}`).join('&');
  let url = `https://apis.map.qq.com/ws/staticmap/v2?${encodedQuery}&key=${encodeURIComponent(pair.key)}`;
  const sig = signWsRequest('/ws/staticmap/v2', params, pair);
  if (sig) url += `&sig=${sig}`;
  return url;
}

function httpsGetBuffer(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          contentType: String(res.headers['content-type'] || ''),
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('staticmap_timeout'));
    });
  });
}

function placeholderPngSvg({ centerLat, centerLng, label = '周边地图' } = {}) {
  // 无缓存且腾讯配额耗尽时，返回简易 SVG（仍优于纯空白）
  const title = String(label || '周边地图').slice(0, 20);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="420" viewBox="0 0 600 420">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#E8EEF4"/><stop offset="100%" stop-color="#D5E3EC"/></linearGradient></defs>
      <rect width="600" height="420" fill="url(#g)"/>
      <circle cx="300" cy="210" r="12" fill="#0E7C86"/>
      <circle cx="300" cy="210" r="28" fill="none" stroke="#0E7C86" stroke-width="2" stroke-dasharray="4 4" opacity=".5"/>
      <text x="300" y="190" text-anchor="middle" font-size="14" fill="#0E7C86" font-family="sans-serif">${title}</text>
      <text x="300" y="250" text-anchor="middle" font-size="12" fill="#6B7A8F" font-family="sans-serif">${Number(centerLat).toFixed(4)}, ${Number(centerLng).toFixed(4)}</text>
      <text x="300" y="390" text-anchor="middle" font-size="11" fill="#9AA7B2" font-family="sans-serif">静态瓦片缓存未命中（腾讯配额或网络异常）</text>
    </svg>`,
    'utf8',
  );
}

/**
 * 获取静态图 Buffer：优先磁盘缓存 → 拉取腾讯 → 写缓存；失败用缓存/占位
 */
export async function getStaticMapImage(query = {}) {
  const centerLat = Number(query.lat ?? query.centerLat);
  const centerLng = Number(query.lng ?? query.centerLng);
  const zoom = Number(query.zoom || 11);
  const size = String(query.size || '600*420');
  const markers = String(query.markers || '');
  const label = String(query.label || query.name || '周边地图');

  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) {
    return {
      ok: false,
      status: 400,
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ ok: false, error: 'lat_lng_required' })),
    };
  }

  const cacheKey = makeStaticCacheKey({ centerLat, centerLng, zoom, size, markers });
  const filePath = path.join(CACHE_DIR, `${cacheKey}.bin`);
  const meta = loadMeta();
  const entry = meta.entries[cacheKey];

  // 1) 磁盘缓存命中
  if (entry?.file && fs.existsSync(path.join(CACHE_DIR, entry.file))) {
    const body = fs.readFileSync(path.join(CACHE_DIR, entry.file));
    return {
      ok: true,
      status: 200,
      contentType: entry.contentType || 'image/png',
      body,
      source: 'disk_cache',
      cacheKey,
    };
  }

  // 2) 拉腾讯（主 Key 配额满时自动切 KEY_2）
  const pairs = getOrderedWsKeyPairs();
  let tencentReason = pairs.length ? '' : 'no_TENCENT_MAP_KEY';
  for (let i = 0; i < pairs.length; i += 1) {
    const pair = pairs[i];
    const remoteUrl = buildTencentStaticUrl(pair, { centerLat, centerLng, zoom, size, markers });
    if (!remoteUrl) continue;
    try {
      const resp = await httpsGetBuffer(remoteUrl);
      const ctype = resp.contentType || '';
      const isImage = /^image\//i.test(ctype);
      if (resp.statusCode === 200 && isImage && resp.body.length > 100) {
        ensureDir();
        const fname = `${cacheKey}.bin`;
        fs.writeFileSync(path.join(CACHE_DIR, fname), resp.body);
        meta.entries[cacheKey] = {
          file: fname,
          contentType: ctype.split(';')[0],
          centerLat,
          centerLng,
          zoom,
          size,
          savedAt: new Date().toISOString(),
          bytes: resp.body.length,
          keyId: pair.id,
        };
        saveMeta(meta);
        return {
          ok: true,
          status: 200,
          contentType: ctype.split(';')[0],
          body: resp.body,
          source: 'tencent',
          cacheKey,
          keyId: pair.id,
        };
      }

      let apiStatus = null;
      let apiMessage = '';
      try {
        const j = JSON.parse(resp.body.toString('utf8'));
        apiStatus = j?.status;
        apiMessage = String(j?.message || '');
        if (j && (j.status != null || j.message)) {
          tencentReason = `tencent_${j.status || 'err'}:${apiMessage.slice(0, 80)}`;
        }
      } catch {
        tencentReason = `tencent_http_${resp.statusCode || 0}`;
      }

      if (isWsQuotaStatus(apiStatus) && i < pairs.length - 1) {
        markWsKeyExhausted(pair, { reason: tencentReason || `status_${apiStatus}` });
        continue;
      }

      // 非配额失败或已是最后一把 Key：尝试近邻缓存
      const near = Object.values(meta.entries || {}).find((e) => (
        e && Math.abs(Number(e.centerLat) - centerLat) < 0.02
        && Math.abs(Number(e.centerLng) - centerLng) < 0.02
        && e.file && fs.existsSync(path.join(CACHE_DIR, e.file))
      ));
      if (near) {
        return {
          ok: true,
          status: 200,
          contentType: near.contentType || 'image/png',
          body: fs.readFileSync(path.join(CACHE_DIR, near.file)),
          source: 'near_cache',
          cacheKey: near.file,
          degraded: true,
          reason: tencentReason || 'near_cache_fallback',
        };
      }
      // 最后一把 Key 仍失败则继续走占位
    } catch (e) {
      tencentReason = `tencent_network:${e?.message || e}`;
      // 网络错误不立即标记耗尽，试下一把 Key
      if (i < pairs.length - 1) continue;
    }
  }

  // 3) 占位 SVG
  const svg = placeholderPngSvg({ centerLat, centerLng, label });
  return {
    ok: true,
    status: 200,
    contentType: 'image/svg+xml; charset=utf-8',
    body: svg,
    source: 'placeholder',
    cacheKey,
    degraded: true,
    reason: tencentReason || 'cache_miss',
  };
}

/**
 * 给模板用的同源静态图 URL（走缓存代理，不直连腾讯）
 */
export function buildCachedStaticMapUrl(center, markers = [], options = {}) {
  if (!center || !Number.isFinite(Number(center.lat)) || !Number.isFinite(Number(center.lng))) return '';
  const zoom = options.zoom || 11;
  const size = options.size || '600*420';
  const points = (markers || []).slice(0, 30)
    .filter((m) => Number.isFinite(Number(m.lat)) && Number.isFinite(Number(m.lng)))
    .map((m) => `${Number(m.lat)},${Number(m.lng)}`);
  const markerParam = points.length
    ? ['color:blue', 'size:mid', ...points].join('|')
    : '';
  const qs = new URLSearchParams({
    lat: String(center.lat),
    lng: String(center.lng),
    zoom: String(zoom),
    size: String(size),
    label: String(center.name || '周边地图'),
  });
  if (markerParam) qs.set('markers', markerParam);
  return `/api/map/static?${qs.toString()}`;
}

export default {
  getStaticMapImage,
  buildCachedStaticMapUrl,
  makeStaticCacheKey,
};
