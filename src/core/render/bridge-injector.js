import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const bridgePath = path.resolve(moduleDir, '../../public/card-bridge.js');
let bridgeScriptCache = null;

function getBridgeScript() {
  if (bridgeScriptCache !== null) return bridgeScriptCache;
  try {
    bridgeScriptCache = fs.readFileSync(bridgePath, 'utf-8');
  } catch {
    bridgeScriptCache = '';
  }
  return bridgeScriptCache;
}

// 地图桥接 JS + CSS（按需注入：页面含 data-map-mode 时才加载）
let mapKitCache = null;
function getMapKitAssets() {
  if (mapKitCache !== null) return mapKitCache;
  const mapBridgePath = path.resolve(moduleDir, '../map/map-bridge.js');
  let bridge = '';
  try { bridge = fs.readFileSync(mapBridgePath, 'utf-8'); } catch { /* ignore */ }
  const css = `
.mk-map-wrap{position:relative;width:100%;border-radius:12px;overflow:hidden;background:#E8EEF4;}
.mk-map-canvas{width:100%;height:280px;display:block;}
.mk-map-legend{position:absolute;bottom:8px;left:10px;background:rgba(255,255,255,.94);border-radius:8px;padding:6px 10px;font-size:11px;line-height:1.6;box-shadow:0 1px 4px rgba(0,0,0,.12);z-index:10;}
.mk-map-legend .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;vertical-align:middle;}
.mk-map-pin{display:inline-flex;align-items:center;gap:3px;margin-right:8px;}
.mk-map-pin .ic{width:14px;height:14px;border-radius:50%;display:inline-block;}
`;
  mapKitCache = { bridge, css };
  return mapKitCache;
}

export function injectBridge(html, options = {}) {
  if (!html || typeof html !== 'string') return html || '';

  // 先注入地图 Key（即使 bridge script 已存在，Key 可能还没注入）
  let result = html;
  if (options.map_key && !html.includes('__MAP_KEY__')) {
    const mapKeyTag = `<script>window.__MAP_KEY__=${JSON.stringify(options.map_key)};</script>`;
    if (html.includes('</body>')) {
      result = html.replace('</body>', `${mapKeyTag}</body>`);
    } else {
      result = html + mapKeyTag;
    }
  }

  // 注入地图工具包 —— 仅腾讯地图容器（route|base|poi），跳过 static_svg 走线卡
  const needsLiveMap = /data-map-mode\s*=\s*["'](route|base|poi)["']/i.test(result)
    || /class=["'][^"']*\bmk-map-(?:wrap|canvas)\b/i.test(result);
  if (needsLiveMap && !result.includes('map-kit-bridge')) {
    const assets = getMapKitAssets();
    const mapTags = `<style>${assets.css}</style><script id="map-kit-bridge">${assets.bridge}</script>`;
    if (result.includes('</body>')) {
      result = result.replace('</body>', `${mapTags}</body>`);
    } else {
      result = result + mapTags;
    }
  }

  // 注入 bridge script（去重保护）
  if (result.includes('card-bridge-script')) return result;

  const script = getBridgeScript();
  if (!script) return result;

  const bridgeTag = `<script id="card-bridge-script">${script}</script>`;
  if (result.includes('</body>')) {
    return result.replace('</body>', `${bridgeTag}</body>`);
  }
  return result + bridgeTag;
}
