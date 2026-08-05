import fs from 'node:fs';
import path from 'node:path';

export const PRODUCT_TYPE_TO_ROUTE_TEMPLATE = {
  wellness: 'route_wellness',
  coastal: 'route_coastal',
  culture: 'route_culture',
  ecology: 'route_ecology',
};

function stripAdmin(s) {
  return String(s || '').replace(/省|市|县|区|自治区|特别行政区/g, '');
}

export function readPublishMeta(routeDir) {
  const f = path.join(routeDir, 'publish.json');
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

export function listPublishedPackages(baseDir = path.join(process.cwd(), 'data', 'sojourn-maps')) {
  let dirs = [];
  try {
    dirs = fs.readdirSync(baseDir).filter((n) => fs.statSync(path.join(baseDir, n)).isDirectory());
  } catch {
    return [];
  }
  const out = [];
  for (const id of dirs) {
    const meta = readPublishMeta(path.join(baseDir, id));
    if (!meta || meta.status !== 'published') continue;
    out.push({ ...meta, route_id: meta.route_id || id, _dir: id });
  }
  return out;
}

/** @returns ranked hits: [{ route_id, score, meta, product_template_id }] */
export function matchPublishedPackages(utterance, { baseDir } = {}) {
  const text = String(utterance || '');
  const textNorm = stripAdmin(text);
  const pkgs = listPublishedPackages(baseDir);
  const scored = [];
  for (const p of pkgs) {
    let score = 0;
    const dests = Array.isArray(p.destination) ? p.destination : [p.destination].filter(Boolean);
    let destHit = false;
    for (const d of dests) {
      const dn = stripAdmin(d);
      if (!dn) continue;
      // 只认「话语包含目的地」，避免长话语被短地名反向包含误伤
      if (textNorm.includes(dn)) destHit = true;
    }
    if (destHit) score += 8;

    const title = String(p.title || '');
    if (title && (text.includes(title) || title.split(/\s|→|->|－|-|—/).filter((s) => s.length >= 2).some((seg) => text.includes(seg.trim())))) {
      // 标题整句或标题分段命中
      if (text.includes(title)) score += 20;
      else score += 6;
    }

    for (const kw of p.keywords || []) {
      if (!kw) continue;
      if (text.includes(kw)) score += Math.min(12, 2 + String(kw).length); // 更长短语权重更高
    }

    // 别名命中
    for (const a of p.aliases || []) {
      if (a && text.includes(a)) score += 5;
    }

    if (score <= 0) continue;
    const updated = Date.parse(p.updated_at || 0) || 0;
    scored.push({
      route_id: p.route_id,
      score,
      updated,
      meta: p,
      product_template_id: PRODUCT_TYPE_TO_ROUTE_TEMPLATE[p.product_type] || 'route_wellness',
    });
  }
  scored.sort((a, b) => (b.score - a.score) || (b.updated - a.updated));
  return scored;
}
