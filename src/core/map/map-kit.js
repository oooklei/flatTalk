/**
 * 地图数据构建包（服务端）
 * 统一处理所有"有地图走线和中心（基地、POI 点为中心）"页面的数据构建。
 *
 * 三种地图模式：
 *   1. route  — 走线模式：途经点连线（Polyline）+ 多类型 Marker + 景点图层
 *   2. base   — 基地中心模式：多基地 Marker（同类）+ 中心定位
 *   3. poi    — POI 中心模式：POI 散点 Marker（按分类着色）+ 雷达半径
 *
 * 用法：
 *   import { buildRouteMapData, buildCenterMapData, buildPoiMapData } from './map-kit.js';
 *   const mapData = buildRouteMapData({ destination, waypoints, spots });
 *   // → 返回可直接展开进模板 data 的字段：map_key, centerLat, waypoints_json, ...
 */

import fs from 'node:fs';
import path from 'node:path';
import { matchPublishedPackages } from '../scene-router/publish-index.js';
import { getActiveWsPair, signWsRequest } from '../../services/map/tencent-key-pool.js';

// 腾讯地图 JS API Key
const DEFAULT_MAP_JS_KEY = 'KI4BZ-5GGLT-POOXY-LQK77-6XA62-YVFPH';

function getMapKey() {
  return process.env.TENCENT_MAP_JS_KEY || DEFAULT_MAP_JS_KEY;
}

// 广西旅居目的地坐标映射表
const DESTINATION_COORDS = {
  '巴马': { lat: 24.0487, lng: 107.2586, name: '巴马瑶族自治县' },
  '巴马瑶族自治县': { lat: 24.0487, lng: 107.2586, name: '巴马瑶族自治县' },
  '北海': { lat: 21.4817, lng: 109.1196, name: '北海市' },
  '北海市': { lat: 21.4817, lng: 109.1196, name: '北海市' },
  '涠洲岛': { lat: 21.0388, lng: 109.1419, name: '涠洲岛' },
  '防城港': { lat: 21.6146, lng: 108.3545, name: '防城港市' },
  '防城港市': { lat: 21.6146, lng: 108.3545, name: '防城港市' },
  '港口区': { lat: 21.6146, lng: 108.3545, name: '防城港港口区' },
  '东兴': { lat: 21.5479, lng: 107.9722, name: '东兴市' },
  '桂林': { lat: 25.2734, lng: 110.2902, name: '桂林市' },
  '桂林市': { lat: 25.2734, lng: 110.2902, name: '桂林市' },
  '阳朔': { lat: 24.7784, lng: 110.4890, name: '阳朔县' },
  '南宁': { lat: 22.8170, lng: 108.3669, name: '南宁市' },
  '南宁市': { lat: 22.8170, lng: 108.3669, name: '南宁市' },
  '柳州': { lat: 24.3264, lng: 109.4280, name: '柳州市' },
  '百色': { lat: 23.9022, lng: 106.6182, name: '百色市' },
  '钦州': { lat: 21.9522, lng: 108.6286, name: '钦州市' },
  '梧州': { lat: 23.4765, lng: 111.2791, name: '梧州市' },
  '贺州': { lat: 24.4033, lng: 111.5527, name: '贺州市' },
  '玉林': { lat: 22.6360, lng: 110.1540, name: '玉林市' },
  '贵港': { lat: 23.1114, lng: 109.5982, name: '贵港市' },
  '河池': { lat: 24.6965, lng: 108.0853, name: '河池市' },
  '来宾': { lat: 23.7333, lng: 109.2217, name: '来宾市' },
  '崇左': { lat: 22.4041, lng: 107.3540, name: '崇左市' },
  '嘉路': { lat: 21.5279, lng: 108.1668, name: '嘉路康养中心' },
  '嘉路康养中心': { lat: 21.5279, lng: 108.1668, name: '嘉路康养中心' },
  '七洞乡': { lat: 23.6817, lng: 109.0512, name: '来宾市兴宾区七洞乡' },
};

const DEFAULT_COORD = { lat: 21.5279, lng: 108.1668, name: '嘉路康养中心' };

/** 从目的地名提取坐标（支持模糊匹配） */
export function resolveCoord(destination) {
  if (!destination) return { ...DEFAULT_COORD };
  const dest = String(destination).trim();
  if (DESTINATION_COORDS[dest]) return { ...DESTINATION_COORDS[dest] };
  for (const key of Object.keys(DESTINATION_COORDS)) {
    if (dest.includes(key)) return { ...DESTINATION_COORDS[key] };
  }
  return { ...DEFAULT_COORD, name: dest };
}

/** 计算一组点的边界框 */
export function computeFitBounds(points = []) {
  const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (valid.length < 2) return null;
  const lats = valid.map((p) => p.lat);
  const lngs = valid.map((p) => p.lng);
  return {
    minLat: Math.min(...lats), minLng: Math.min(...lngs),
    maxLat: Math.max(...lats), maxLng: Math.max(...lngs),
  };
}

/** 脱敏：移除点数据中的内部字段（source 等），避免在前端暴露技术组件名称 */
export function sanitizePoints(points = []) {
  if (!Array.isArray(points)) return [];
  return points.map(({ source: _omit, ...rest }) => {
    if (rest.spots && Array.isArray(rest.spots)) {
      rest.spots = rest.spots.map(({ source: _s, ...spotRest }) => spotRest);
    }
    return rest;
  });
}

// ============================================================
// 走线模式：途经点连线 + 多类型 Marker + 景点图层
// ============================================================

/**
 * 构建走线版地图数据。
 * @param {object} opts
 * @param {string} opts.destination - 目的地
 * @param {Array}  opts.waypoints   - 途经点 [{name,lat,lng,day,type,plan,spots,spot_images}]
 * @param {Array}  [opts.spots]     - 独立景点点（可选，不嵌在 waypoints 里时）
 * @returns {object} 可展开进模板 data 的地图字段
 */
export function buildRouteMapData({ destination, waypoints = [], spots = [], routeId, version = 'standard', utterance } = {}) {
  const center = resolveCoord(destination);
  const validWps = sanitizePoints(
    waypoints.filter((wp) => Number.isFinite(wp.lat) && Number.isFinite(wp.lng))
  );

  // ★ 优先使用预制作资源包（0 次 API 调用）
  let pkg = findPrebuiltPackage(routeId, version);
  // 包目的地与话语/目标城冲突时丢弃（例：请求北海却命中七洞乡预制作 SVG）
  if (pkg?.svg && packageConflictsWithDestination(pkg, destination, utterance)) {
    console.warn('[map-kit] drop prebuilt package due to destination mismatch', {
      routeId: routeId || pkg.routeId,
      destination,
      pkgDest: pkg.routeData?.destination,
    });
    pkg = null;
  }
  // Prefer published index when utterance or destination available
  if ((!pkg || !pkg.svg) && (utterance || destination)) {
    const hits = matchPublishedPackages(utterance || destination);
    if (hits.length >= 1) {
      const unique = !hits[1] || hits[0].score > hits[1].score;
      if (unique) {
        const hitPkg = findPrebuiltPackage(hits[0].route_id, version);
        if (hitPkg?.svg && !packageConflictsWithDestination(hitPkg, destination, utterance)) {
          pkg = { ...hitPkg, routeId: hits[0].route_id, publish: hits[0] };
        }
      } else {
        return {
          map_mode: 'publish_ambiguous',
          ambiguous_routes: hits.slice(0, 3).map((h) => ({
            route_id: h.route_id,
            title: h.meta?.title,
            score: h.score,
          })),
          map_key: getMapKey(),
          centerLat: center.lat,
          centerLng: center.lng,
          centerName: center.name,
        };
      }
    }
  }
  // then existing findPrebuiltPackageByDestination fallback (unpublished scan)
  if (!pkg || !pkg.svg) {
    pkg = findPrebuiltPackageByDestination(destination, version) || pkg;
    if (pkg?.svg && packageConflictsWithDestination(pkg, destination, utterance)) pkg = null;
    if (pkg?.svg) console.log('[publish-fallback]', 'unpublished_destination_scan', destination);
  }
  if (pkg && pkg.svg) {
    const pkgWps = (pkg.routeData?.waypoints || validWps).filter(
      (wp) => Number.isFinite(wp.lat) && Number.isFinite(wp.lng)
    );
    const pkgSpots = pkgWps.flatMap((wp) => wp.spots || []);
    return {
      map_key: getMapKey(),
      centerLat: center.lat,
      centerLng: center.lng,
      centerName: center.name,
      center_json: JSON.stringify(center),
      waypoints_json: JSON.stringify(pkgWps),
      waypoints: pkgWps,
      spots_json: JSON.stringify(sanitizePoints(pkgSpots)),
      spots: sanitizePoints(pkgSpots),
      hasSpots: pkgSpots.length > 0,
      map_mode: 'static_svg',
      static_svg: pkg.svg,
      static_svg_url: (routeId || pkg.routeId) ? `/api/sojourn-map/${routeId || pkg.routeId}/${version}.svg` : '',
      polyline_path_json: JSON.stringify(pkg.routeData?.polyline_path || []),
    };
  }

  const polylinePath = validWps.map((wp) => ({ lat: wp.lat, lng: wp.lng }));
  const fitBounds = computeFitBounds(validWps);

  // 提取所有特色景点（waypoints 内嵌 + 独立传入）
  const allSpots = [
    ...validWps.flatMap((wp) =>
      (wp.spots || []).map((s) => ({ ...s, parent_waypoint: wp.name, parent_day: wp.day }))
    ),
    ...sanitizePoints(spots),
  ];
  const spotImages = validWps.flatMap((wp) => wp.spot_images || []).slice(0, 4);

  return {
    map_key: getMapKey(),
    centerLat: center.lat,
    centerLng: center.lng,
    centerName: center.name,
    center_json: JSON.stringify(center),
    static_map_url: buildStaticMapUrl(center, validWps.slice(0, 30)),
    markers_json: JSON.stringify(validWps),
    map_markers: validWps,
    // 走线专用
    waypoints_json: JSON.stringify(validWps),
    waypoints: validWps,
    polyline_path: polylinePath,
    polyline_path_json: JSON.stringify(polylinePath),
    fit_bounds: fitBounds,
    fit_bounds_json: fitBounds ? JSON.stringify(fitBounds) : 'null',
    route_planning_url: buildRoutePlanningUrl(validWps),
    // 景点图层
    spots_json: JSON.stringify(allSpots),
    spots: allSpots,
    spot_images: spotImages,
    spot_images_json: JSON.stringify(spotImages),
    hasSpots: allSpots.length > 0,
    // 元信息：告诉前端 JS 用 route 模式渲染
    map_mode: 'route',
  };
}

// ============================================================
// 基地中心模式：多基地 Marker（同类）+ 中心定位
// ============================================================

/**
 * 构建基地中心版地图数据。
 * @param {object} opts
 * @param {string} opts.destination - 主目的地
 * @param {Array}  opts.bases       - 基地列表 [{name,location,...}]，自动补坐标
 * @returns {object}
 */
export function buildBaseMapData({ destination, bases = [] } = {}) {
  const center = resolveCoord(destination);
  const baseMarkers = bases.map((b) => {
    const coord = resolveCoord(b.location || b.destination || destination);
    return { name: b.name || b.product_name || '康养基地', lat: coord.lat, lng: coord.lng, address: b.location || '', cat: 'base' };
  });
  const validMarkers = baseMarkers.filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng));

  return {
    map_key: getMapKey(),
    centerLat: center.lat,
    centerLng: center.lng,
    centerName: center.name,
    center_json: JSON.stringify(center),
    static_map_url: buildStaticMapUrl(center, validMarkers.slice(0, 30)),
    markers_json: JSON.stringify(validMarkers),
    map_markers: validMarkers,
    fit_bounds: computeFitBounds(validMarkers),
    fit_bounds_json: JSON.stringify(computeFitBounds(validMarkers) || {}),
    map_mode: 'base',
  };
}

// ============================================================
// POI 中心模式：POI 散点 Marker（按分类着色）+ 雷达半径
// ============================================================

/**
 * 构建 POI 中心版地图数据。
 * @param {object} opts
 * @param {object} opts.center    - {lat,lng,name}
 * @param {Array}  opts.pois      - POI 列表 [{name,lat,lng,cat,color,...}]
 * @param {number} [opts.radiusKm]- 雷达半径（km）
 * @returns {object}
 */
export function buildPoiMapData({ center, pois = [], radiusKm = 15 } = {}) {
  const c = center && center.lat ? center : DEFAULT_COORD;
  const validPois = sanitizePoints(
    pois.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
  );

  return {
    map_key: getMapKey(),
    centerLat: c.lat,
    centerLng: c.lng,
    centerName: c.name,
    center_json: JSON.stringify(c),
    static_map_url: buildStaticMapUrl(c, validPois.slice(0, 30)),
    markers_json: JSON.stringify(validPois),
    map_markers: validPois,
    fit_bounds: computeFitBounds(validPois),
    fit_bounds_json: JSON.stringify(computeFitBounds(validPois) || {}),
    radius_km: radiusKm,
    radius_json: JSON.stringify({ lat: c.lat, lng: c.lng, radius: radiusKm }),
    map_mode: 'poi',
  };
}

// ============================================================
// 腾讯地图 WebService 辅助
// ============================================================

/** 构建路径规划 URL（内部代理路径） */
export function buildRoutePlanningUrl(waypoints = []) {
  if (waypoints.length < 2) return '';
  const from = `${waypoints[0].lat},${waypoints[0].lng}`;
  const to = `${waypoints[waypoints.length - 1].lat},${waypoints[waypoints.length - 1].lng}`;
  const via = waypoints.slice(1, -1).map((wp) => `${wp.lat},${wp.lng}`).join(';');
  return `/api/map/route-planning?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${via ? `&via=${encodeURIComponent(via)}` : ''}&policy=1`;
}

/** 构建静态图 URL（降级用） */
export function buildStaticMapUrl(center, markers = [], options = {}) {
  const active = getActiveWsPair();
  const wsKey = active?.key || process.env.TENCENT_MAP_KEY || '';
  const sk = active?.sk || process.env.TENCENT_MAP_SK || '';
  if (!wsKey) return '';

  const params = {
    center: `${center.lat},${center.lng}`,
    zoom: options.zoom || 11,
    size: options.size || '600*420',
    maptype: options.maptype || 'roadmap',
  };
  const points = (markers || []).slice(0, 30)
    .filter((m) => Number.isFinite(Number(m.lat)) && Number.isFinite(Number(m.lng)))
    .map((m) => `${Number(m.lat)},${Number(m.lng)}`);
  if (points.length) params.markers = ['color:blue', 'size:mid', ...points].join('|');

  const encodedQuery = Object.keys(params).sort()
    .map((k) => `${k}=${encodeURIComponent(params[k])}`).join('&');
  let url = `https://apis.map.qq.com/ws/staticmap/v2?${encodedQuery}&key=${encodeURIComponent(wsKey)}`;
  const sig = signWsRequest('/ws/staticmap/v2', params, { key: wsKey, sk });
  if (sig) url += '&sig=' + sig;
  return url;
}

/**
 * 查找预制作资源包（优先子目录，兼容旧版扁平结构）
 */
function packageConflictsWithDestination(pkg, destination = '', utterance = '') {
  if (!pkg) return false;
  const want = `${destination || ''} ${utterance || ''}`;
  const pkgBlob = `${pkg.routeData?.destination || ''} ${(pkg.routeData?.waypoints || []).map((w) => w.name).join(' ')} ${pkg.routeId || ''}`;
  if (!want.trim() || !pkgBlob.trim()) return false;
  // 请求北海却包全是七洞/来宾
  if (/北海|银滩|涠洲/.test(want) && /七洞|来宾/.test(pkgBlob) && !/北海|银滩|涠洲/.test(pkgBlob)) return true;
  if (/七洞|来宾/.test(want) && /北海|银滩|涠洲/.test(pkgBlob) && !/七洞|来宾/.test(pkgBlob)) return true;
  if (/巴马|百魔洞/.test(want) && /(北海|防城港|七洞)/.test(pkgBlob) && !/巴马|百魔洞/.test(pkgBlob)) return true;
  if (/防城港|东兴|嘉路/.test(want) && /巴马|七洞|北海/.test(pkgBlob) && !/防城港|东兴|嘉路|白浪滩/.test(pkgBlob)) return true;
  return false;
}

function findPrebuiltPackage(routeId, version = 'standard') {
  if (!routeId) return null;
  const baseDir = path.join(process.cwd(), 'data', 'sojourn-maps');

  // 优先从子目录查找（新版资源包）
  const pkgDir = path.join(baseDir, routeId);
  const routeDataFile = path.join(pkgDir, 'route_data.json');
  if (fs.existsSync(routeDataFile)) {
    try {
      const routeData = JSON.parse(fs.readFileSync(routeDataFile, 'utf8'));
      const svgNested = path.join(pkgDir, `map_${version}.svg`);
      const svgFlat = path.join(baseDir, `${routeId}_${version}.svg`);
      let svg = '';
      if (fs.existsSync(svgNested)) svg = fs.readFileSync(svgNested, 'utf8');
      else if (fs.existsSync(svgFlat)) svg = fs.readFileSync(svgFlat, 'utf8');
      return { routeData, svg };
    } catch {}
  }

  // 兼容旧版扁平结构（仅 SVG，无 route_data）
  const flatSvg = path.join(baseDir, `${routeId}_${version}.svg`);
  if (fs.existsSync(flatSvg)) {
    try {
      return { routeData: null, svg: fs.readFileSync(flatSvg, 'utf8') };
    } catch {}
  }
  return null;
}

/**
 * 按目的地名称查找预制作资源包（扫描 sojourn-maps 子目录，匹配 route_data.json 的 destination）
 * 用于 routeId 缺失或不匹配时的兜底查找。
 */
function findPrebuiltPackageByDestination(destination, version = 'standard') {
  if (!destination) return null;
  const baseDir = path.join(process.cwd(), 'data', 'sojourn-maps');
  let dirs = [];
  try { dirs = fs.readdirSync(baseDir).filter((n) => fs.statSync(path.join(baseDir, n)).isDirectory()); }
  catch { return null; }
  const dest = destination.replace(/省|市|县|区|自治区|特别行政区/g, '');
  for (const dir of dirs) {
    try {
      const rdFile = path.join(baseDir, dir, 'route_data.json');
      if (!fs.existsSync(rdFile)) continue;
      const rd = JSON.parse(fs.readFileSync(rdFile, 'utf8'));
      const rdDest = String(rd.destination || '').replace(/省|市|县|区|自治区|特别行政区/g, '');
      if (!rdDest || !(dest.includes(rdDest) || rdDest.includes(dest))) continue;
      // destination 匹配，读取 SVG
      const svgNested = path.join(baseDir, dir, `map_${version}.svg`);
      const svgFlat = path.join(baseDir, `${dir}_${version}.svg`);
      let svg = '';
      if (fs.existsSync(svgNested)) svg = fs.readFileSync(svgNested, 'utf8');
      else if (fs.existsSync(svgFlat)) svg = fs.readFileSync(svgFlat, 'utf8');
      if (svg) return { routeData: rd, svg, routeId: dir };
    } catch {}
  }
  return null;
}

export { DESTINATION_COORDS, DEFAULT_COORD, DEFAULT_MAP_JS_KEY, findPrebuiltPackage, findPrebuiltPackageByDestination };
