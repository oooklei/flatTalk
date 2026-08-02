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

export function injectBridge(html, options = {}) {
  if (!html || typeof html !== 'string') return html || '';
  if (html.includes('card-bridge-script')) return html;

  const script = getBridgeScript();
  if (!script) return html;

  // 注入地图 Key（供迷你地图动态加载使用）
  const mapKeyTag = options.map_key
    ? `<script>window.__MAP_KEY__=${JSON.stringify(options.map_key)};</script>`
    : '';

  const bridgeTag = `<script id="card-bridge-script">${script}</script>`;
  const inject = mapKeyTag + bridgeTag;

  if (html.includes('</body>')) {
    return html.replace('</body>', `${inject}</body>`);
  }
  return html + inject;
}
