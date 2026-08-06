// src/core/semantic/fallback.js
import { normalizeSemantic, SEMANTIC_SOURCES } from './schema.js';
import { adaptParams, normalizeCategory, normalizePlace } from './adapter.js';

const CATEGORY_WORDS = ['商店', '购物', '超市', '便利店', '医院', '药店', '餐厅', '饭店', '民宿', '酒店', '景点', '公交', '车站'];
const PLACE_SCAN = ['防城港', '桂林', '北海', '南宁', '巴马', '贺州', '东兴', '阳朔', '钦州', '崇左'];

export function rulesFallback(text = '') {
  const t = String(text || '').trim();
  const concept_words = [];
  const place_candidates = [];
  let category_hint = null;

  for (const w of PLACE_SCAN) {
    if (t.includes(w)) place_candidates.push(w);
  }
  for (const w of CATEGORY_WORDS) {
    if (t.includes(w)) {
      concept_words.push(w);
      if (!category_hint) category_hint = normalizeCategory(w) || w;
    }
  }
  if (/附近|周边|旁边/.test(t) && !concept_words.includes('附近')) concept_words.push('附近');

  const slots = {
    place_candidates,
    scenic_candidates: [],
    concept_words,
    category_hint,
    entity_name: null,
    service_type: null,
    time: null,
  };
  const adapted = adaptParams(slots);
  // 若 adapt 未出 destination，直接扫 normalizePlace
  if (!adapted.destination) {
    for (const w of PLACE_SCAN) {
      if (t.includes(w)) { adapted.destination = normalizePlace(w) || w; break; }
    }
  }
  return normalizeSemantic({
    core_need: t ? `用户说：${t.slice(0, 40)}` : '',
    slots,
    adapted,
    source: SEMANTIC_SOURCES.RULES_FALLBACK,
    confidence: adapted.category || adapted.destination ? 0.45 : 0.2,
  }, SEMANTIC_SOURCES.RULES_FALLBACK);
}
