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

/** 关键词/标题软命中：整词 > 去尾缀词干 > 最长中文子串(≥3) */
function scorePhraseHit(text, phrase) {
  const p = String(phrase || '').trim();
  if (!p) return 0;
  if (text.includes(p)) return Math.min(12, 2 + p.length);
  const stem = p.replace(/(体验线|文化线|边境线|康养线|旅居线|线路|路线|三日游|线|游)$/g, '');
  if (stem.length >= 4 && text.includes(stem)) return Math.min(11, 2 + stem.length);
  // 文本中的短标签出现在短语里（如「京族」∈「京族滨海文化线」）
  const shortTags = [];
  if (/京族/.test(p)) shortTags.push('京族');
  if (/银发爱情/.test(p)) shortTags.push('银发爱情');
  if (/芒街/.test(p)) shortTags.push('芒街');
  if (/百魔洞/.test(p)) shortTags.push('百魔洞');
  if (/七洞/.test(p)) shortTags.push('七洞', '七洞乡');
  for (const t of shortTags) {
    if (text.includes(t)) return Math.min(10, 4 + t.length);
  }
  // 最长连续中文子串 ≥4
  const src = stem.length >= 3 ? stem : p;
  for (let len = Math.min(src.length, 8); len >= 4; len -= 1) {
    for (let i = 0; i <= src.length - len; i += 1) {
      const sub = src.slice(i, i + len);
      if (/^[\u4e00-\u9fff]+$/.test(sub) && text.includes(sub)) {
        return Math.min(9, len);
      }
    }
  }
  return 0;
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
    const titleHit = scorePhraseHit(text, title);
    if (titleHit) score += titleHit >= 10 ? 20 : Math.max(6, titleHit);

    for (const kw of p.keywords || []) {
      const kwHit = scorePhraseHit(text, kw);
      if (kwHit) score += kwHit;
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

/**
 * 按 route_id 精确取已发布包（供第二刀点选锁定；未发布或不存在返回 null）
 */
export function getPublishedPackageById(routeId, { baseDir } = {}) {
  const id = String(routeId || '').trim();
  if (!id) return null;
  const pkgs = listPublishedPackages(baseDir);
  const found = pkgs.find((p) => p.route_id === id || p._dir === id);
  if (!found) return null;
  return {
    route_id: found.route_id,
    score: 999,
    meta: found,
    product_template_id: PRODUCT_TYPE_TO_ROUTE_TEMPLATE[found.product_type] || 'route_wellness',
  };
}
