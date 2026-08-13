/**
 * 地图模板辅助函数（服务端）
 * 为模板渲染提供统一的 CSS + JS 片段，以及 data-* 属性 HTML 生成器。
 *
 * 用法（在 model-service.js 的 fill*Card 中）：
 *   import { mapCanvasHtml, MAP_CSS, MAP_BRIDGE_JS } from '../map/map-helpers.js';
 *   // 在模板里用 {{{map_canvas}}} 占位，数据里传 mapCanvasHtml({mode:'route', ...mapData})
 *   // CSS 和桥接 JS 由渲染器统一注入
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 地图统一 CSS（适用于所有模式）
export const MAP_CSS = `
.mk-map-wrap{position:relative;width:100%;border-radius:12px;overflow:hidden;background:#E8EEF4;}
.mk-map-canvas{width:100%;height:280px;display:block;}
.mk-map-legend{position:absolute;bottom:8px;left:10px;background:rgba(255,255,255,.94);border-radius:8px;padding:6px 10px;font-size:11px;line-height:1.6;box-shadow:0 1px 4px rgba(0,0,0,.12);z-index:10;}
.mk-map-legend .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;vertical-align:middle;}
.mk-map-pin{display:inline-flex;align-items:center;gap:3px;margin-right:8px;}
.mk-map-pin .ic{width:14px;height:14px;border-radius:50%;display:inline-block;}
`;

// 缓存桥接 JS 内容
let _bridgeCache = null;
export function getMapBridgeJS() {
  if (_bridgeCache) return _bridgeCache;
  try {
    _bridgeCache = readFileSync(resolve(__dirname, 'map-bridge.js'), 'utf8');
  } catch {
    _bridgeCache = '/* map-bridge.js 加载失败 */';
  }
  return _bridgeCache;
}

/**
 * 生成地图容器的 data-* 属性字符串。
 * 把 mapData（来自 map-kit.js）序列化为 HTML data 属性。
 */
export function mapDataAttrs(mapData = {}) {
  const attrs = [
    `data-map-mode="${mapData.map_mode || 'route'}"`,
  ];
  if (mapData.centerLat != null) attrs.push(`data-center-lat="${mapData.centerLat}"`);
  if (mapData.centerLng != null) attrs.push(`data-center-lng="${mapData.centerLng}"`);
  if (mapData.centerName) attrs.push(`data-center-name="${escapeAttr(mapData.centerName)}"`);
  if (mapData.center_json) attrs.push(`data-center="${escapeAttr(mapData.center_json)}"`);
  if (mapData.map_key) attrs.push(`data-map-key="${escapeAttr(mapData.map_key)}"`);
  if (mapData.waypoints_json) attrs.push(`data-waypoints="${escapeAttr(mapData.waypoints_json)}"`);
  if (mapData.spots_json) attrs.push(`data-spots="${escapeAttr(mapData.spots_json)}"`);
  if (mapData.markers_json) attrs.push(`data-markers="${escapeAttr(mapData.markers_json)}"`);
  if (mapData.polyline_path_json) attrs.push(`data-polyline-path="${escapeAttr(mapData.polyline_path_json)}"`);
  if (mapData.fit_bounds_json && mapData.fit_bounds_json !== 'null') attrs.push(`data-fit-bounds="${escapeAttr(mapData.fit_bounds_json)}"`);
  if (mapData.static_map_url) attrs.push(`data-static-map-url="${escapeAttr(mapData.static_map_url)}"`);
  if (mapData.radius_km) attrs.push(`data-radius-km="${mapData.radius_km}"`);
  return attrs.join(' ');
}

function escapeAttr(v) {
  return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 生成完整地图容器 HTML（含 canvas + 图例）。
 * @param {object} opts
 * @param {string} opts.canvasId - canvas 元素 ID
 * @param {string} [opts.height] - canvas 高度（CSS）
 * @param {string} [opts.legend] - 图例 HTML（可选）
 * @param {object} opts.mapData  - map-kit 返回的地图数据
 */
export function mapCanvasHtml({ canvasId = 'mapCanvas', height = '280px', legend = '', mapData = {} } = {}) {
  const attrs = mapDataAttrs(mapData);
  const legendHtml = legend
    ? `<div class="mk-map-legend">${legend}</div>`
    : '';
  return `<div class="mk-map-wrap">
    <div id="${canvasId}" class="mk-map-canvas" style="height:${height}" ${attrs}></div>
    ${legendHtml}
  </div>`;
}

/**
 * 生成标准走线图例 HTML。
 */
export function routeLegendHtml() {
  return `<span class="mk-map-pin"><span class="ic" style="background:#2E7D32"></span>抵达</span>
    <span class="mk-map-pin"><span class="ic" style="background:#FF7826"></span>游览</span>
    <span class="mk-map-pin"><span class="ic" style="background:#1976D2"></span>康养</span>
    <span class="mk-map-pin"><span class="ic" style="background:#D32F2F"></span>返程</span>`;
}

/**
 * 生成 POI 图例 HTML（按分类）。
 */
export function poiLegendHtml() {
  return `<span class="mk-map-pin"><span class="ic" style="background:#1976D2"></span>康养</span>
    <span class="mk-map-pin"><span class="ic" style="background:#E53935"></span>医疗</span>
    <span class="mk-map-pin"><span class="ic" style="background:#FB8C00"></span>餐饮</span>
    <span class="mk-map-pin"><span class="ic" style="background:#FF7826"></span>景点</span>`;
}
