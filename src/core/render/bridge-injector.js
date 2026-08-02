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
