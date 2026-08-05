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

/** 广西旅居常用城/县，用于 destination 亲和与过境长线降权 */
const CITY_HINTS = [
  '防城港', '东兴', '北海', '钦州', '南宁', '巴马', '桂林', '阳朔', '永福', '恭城', '荔浦',
  '崇左', '大新', '宁明', '百色', '河池', '柳州', '梧州', '玉林', '贺州', '来宾', '贵港', '涠洲',
];

/** 品牌/乡镇 → 归属城市（话语无城市名时也能做 destination 亲和） */
const PLACE_ALIASES = {
  嘉路: ['防城港', '东兴'],
  嘉路康养: ['防城港', '东兴'],
  嘉路康养中心: ['防城港', '东兴'],
  嘉路滨海: ['防城港', '东兴'],
  白浪滩: ['防城港'],
  金滩: ['防城港', '东兴'],
  簕山: ['防城港'],
  京族三岛: ['防城港', '东兴'],
  芒街: ['防城港', '东兴'],
  七洞: ['桂林'],
  七洞乡: ['桂林'],
  百魔洞: ['巴马'],
  赐福湖: ['巴马'],
  银滩: ['北海'],
  涠洲: ['北海'],
};

/** 过宽关键词：单独出现不得抬分（「嘉路康养中心」不能因「康养」命中巴马） */
const GENERIC_KEYWORDS = new Set([
  '康养', '旅居', '线路', '路线', '旅游', '养老', '三日游', '七日', '测试', '长寿', '南宁',
]);

function extractCities(textNorm) {
  const t = String(textNorm || '');
  const cities = CITY_HINTS.filter((c) => t.includes(c));
  for (const [alias, mapped] of Object.entries(PLACE_ALIASES)) {
    if (t.includes(alias)) {
      for (const c of mapped) {
        if (!cities.includes(c)) cities.push(c);
      }
    }
  }
  return cities;
}

function destOverlapsCities(dests, cities) {
  return cities.some((c) => dests.some((d) => {
    const dn = stripAdmin(d);
    return dn && (dn.includes(c) || c.includes(dn));
  }));
}

function isCorridorTitle(title) {
  const cities = extractCities(stripAdmin(title));
  return cities.length >= 3 && /[-－—→>]/.test(String(title || ''));
}

/** 关键词/标题软命中：整词 > 去尾缀词干 > 最长中文子串(≥3) */
function scorePhraseHit(text, phrase, { allowGeneric = false } = {}) {
  const p = String(phrase || '').trim();
  if (!p) return 0;
  if (!allowGeneric && (GENERIC_KEYWORDS.has(p) || p.length < 2)) return 0;
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
  if (/嘉路/.test(p)) shortTags.push('嘉路');
  for (const t of shortTags) {
    if (text.includes(t)) return Math.min(10, 4 + t.length);
  }
  // 最长连续中文子串 ≥4（跳过泛词子串）
  const src = stem.length >= 3 ? stem : p;
  for (let len = Math.min(src.length, 8); len >= 4; len -= 1) {
    for (let i = 0; i <= src.length - len; i += 1) {
      const sub = src.slice(i, i + len);
      if (GENERIC_KEYWORDS.has(sub)) continue;
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
    const titleHit = scorePhraseHit(text, title, { allowGeneric: true });
    if (titleHit) score += titleHit >= 10 ? 20 : Math.max(6, titleHit);

    for (const kw of p.keywords || []) {
      const kwHit = scorePhraseHit(text, kw);
      if (kwHit) score += kwHit;
    }

    // 别名命中
    for (const a of p.aliases || []) {
      if (a && text.includes(a)) score += 5;
    }

    // 嘉路/白浪滩等品牌意图：抬高防城港本地包
    if (/嘉路|白浪滩|簕山|京族三岛/.test(text)) {
      if (destOverlapsCities(dests, ['防城港', '东兴'])) score += 14;
      else score = Math.max(0, score - 16);
    }

    // 滨海意图：抬高 coastal / 含滨海标签的包（须在 destination 降权之前加分，避免蹭城复活）
    if (/滨海|海边|银滩|京族|海岛|涠洲/.test(text)) {
      if (p.product_type === 'coastal') score += 4;
      const blob = `${title} ${(p.keywords || []).join(' ')}`;
      if (/滨海|银滩|京族|海边|涠洲/.test(blob)) score += 4;
    }

    // destination 亲和：话语点名城市必须落在包 destination 上，否则降权「标题/关键词蹭过境城」
    const utteredCities = extractCities(textNorm);
    if (utteredCities.length) {
      const overlap = destOverlapsCities(dests, utteredCities);
      if (overlap) {
        score += 10;
        // 单城话术 vs 多城走廊长线：本地包优先（防城港滨海 ≠ 南宁-北海-钦州-防城港）
        if (utteredCities.length === 1 && isCorridorTitle(title)) {
          score = Math.max(0, score - 12);
        }
      } else if (utteredCities.length === 1) {
        score = Math.max(0, score - 14);
      } else {
        // 多城话术但 destination 无交集：需标题至少覆盖 2 个话语城市，否则降权
        const titleCities = extractCities(stripAdmin(title));
        const covered = utteredCities.filter((c) => titleCities.includes(c)).length;
        if (covered < 2) score = Math.max(0, score - 10);
      }
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
