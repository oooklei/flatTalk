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

export function injectBridge(html) {
  if (!html || typeof html !== 'string') return html || '';
  if (html.includes('card-bridge-script')) return html;

  const script = getBridgeScript();
  if (!script) return html;

  const bridgeTag = `<script id="card-bridge-script">${script}</script>`;

  if (html.includes('</body>')) {
    return html.replace('</body>', `${bridgeTag}</body>`);
  }
  return html + bridgeTag;
}
