/**
 * 语义适配层 — 同义词、概念词、地名归一化
 */

const PLACE_ALIASES = {
  '桂林': '桂林', '桂': '桂林',
  '贺州': '贺州', '贺': '贺州',
  '南宁': '南宁', '邕': '南宁', '首府': '南宁', '省会': '南宁',
  '崇左': '崇左',
  '防城港': '防城港',
  '北海': '北海',
  '钦州': '钦州',
  '河池': '河池',
  '柳州': '柳州',
  '巴马': '巴马',
  '阳朔': '阳朔',
  '东兴': '东兴',
  '龙胜': '龙胜',
  '三江': '三江',
  '黄姚': '黄姚',
  '涠洲岛': '涠洲岛',
  '银滩': '北海',
  '白浪滩': '防城港',
  '金滩': '东兴',
  '象鼻山': '桂林',
  '象山': '桂林',
  '漓江': '桂林',
  '德天瀑布': '崇左',
  '德天': '崇左',
  '百魔洞': '巴马',
  '长寿村': '巴马',
  '盘阳河': '巴马',
  '姑婆山': '贺州',
  '龙脊梯田': '龙胜',
  '花山岩画': '崇左',
  '青秀山': '南宁',
  '三娘湾': '钦州',
  '白龙半岛': '防城港',
  '长寿之乡': ['巴马', '贺州'],
  '世界长寿之乡': ['巴马', '贺州'],
  '富硒': ['贺州'],
  '瑶药': ['贺州', '河池'],
  '温泉': ['贺州', '龙胜'],
  '滨海': ['北海', '防城港', '钦州'],
  '海边': ['北海', '防城港', '钦州'],
  '看海': ['北海', '防城港', '钦州'],
  '边境': ['防城港', '崇左', '东兴'],
  '边关': ['防城港', '崇左'],
  '跨境': ['东兴', '防城港'],
  '瑶族': ['贺州', '河池'],
  '侗族': ['三江'],
  '梯田': ['龙胜'],
  '氧疗': ['桂林', '贺州'],
  '负氧离子': ['桂林', '贺州', '巴马'],
  '避暑': ['桂林', '贺州', '河池'],
  '候鸟': ['北海', '防城港', '海南'],
};

const SCENIC_ALIASES = {
  '象鼻山': '桂林象鼻山', '象山': '桂林象鼻山',
  '西街': '阳朔西街', '阳朔': '阳朔西街',
  '银滩': '北海银滩', '北海滩': '北海银滩',
  '涠洲岛': '涠洲岛',
  '德天': '大新德天瀑布', '德天瀑布': '大新德天瀑布',
  '百魔洞': '巴马百魔洞',
  '长寿村': '巴马长寿村',
  '风雨桥': '三江风雨桥',
  '龙脊': '龙脊梯田', '梯田': '龙脊梯田',
  '姑婆山': '姑婆山森林公园',
  '黄姚': '黄姚古镇',
  '花山': '宁明花山岩画', '花山岩画': '宁明花山岩画',
  '三娘湾': '钦州三娘湾',
  '白龙半岛': '防城港白龙半岛',
  '盘阳河': '盘阳河',
  '青秀山': '青秀山风景区',
};

const CATEGORY_ALIASES = {
  '住': '住', '住宿': '住', '酒店': '住', '宾馆': '住', '旅馆': '住',
  '民宿': '住', '住哪': '住',
  '吃': '吃', '美食': '吃', '餐厅': '吃', '饭店': '吃', '餐饮': '吃',
  '吃什么': '吃', '小吃': '吃',
  '游': '游', '景点': '游', '景区': '游', '玩': '游',
  '好玩的': '游', '有什么好玩的': '游', '游玩': '游',
  '娱': '娱', '娱乐': '娱',
  '购': '购', '购物': '购', '超市': '购', '商场': '购', '商店': '购',
  '便利店': '购',
  '行': '行', '交通': '行', '车站': '行', '机场': '行',
  '养': '养', '养生': '养', '康养': '养', '医院': '养', '诊所': '养',
  '药店': '养', '医疗机构': '养',
  '看病': '养', '就医': '养',
};

export function normalizePlace(raw) {
  if (!raw) return null;
  const kw = raw.trim();
  if (PLACE_ALIASES[kw]) return PLACE_ALIASES[kw];
  for (const [alias, std] of Object.entries(PLACE_ALIASES)) {
    if (kw.includes(alias)) return std;
  }
  return null;
}

export function normalizeScenic(raw) {
  if (!raw) return null;
  const kw = raw.trim();
  if (SCENIC_ALIASES[kw]) return SCENIC_ALIASES[kw];
  for (const [alias, std] of Object.entries(SCENIC_ALIASES)) {
    if (kw.includes(alias)) return std;
  }
  return null;
}

export function normalizeCategory(raw) {
  if (!raw) return null;
  const kw = raw.trim();
  if (CATEGORY_ALIASES[kw]) return CATEGORY_ALIASES[kw];
  for (const [alias, std] of Object.entries(CATEGORY_ALIASES)) {
    if (kw.includes(alias)) return std;
  }
  return null;
}

function pickDestination(norm) {
  if (!norm) return null;
  return Array.isArray(norm) ? norm[0] : norm;
}

export function adaptParams(slots = {}) {
  const result = {
    destination: null,
    route_keyword: null,
    point_name: null,
    category: null,
    entity_name: slots.entity_name || null,
    service_type: slots.service_type || null,
  };

  const NON_PLACE = ['旅居', '路线', '推荐', '养老', '康养', '候鸟', '宜居', '旅', '游', '养'];

  if (slots.place_candidates?.length) {
    for (const cand of slots.place_candidates) {
      if (NON_PLACE.includes(cand)) continue;
      const norm = normalizePlace(cand);
      if (norm) {
        result.destination = pickDestination(norm);
        break;
      }
    }
  }

  if (slots.scenic_candidates?.length) {
    for (const cand of slots.scenic_candidates) {
      const norm = normalizeScenic(cand);
      if (norm) {
        result.route_keyword = norm;
        result.point_name = norm;
        break;
      }
    }
  }

  if (slots.category_hint) {
    result.category = normalizeCategory(slots.category_hint);
  }

  if (!result.destination && slots.concept_words?.length) {
    for (const concept of slots.concept_words) {
      const norm = normalizePlace(concept);
      if (norm) {
        result.destination = pickDestination(norm);
        break;
      }
    }
  }

  return result;
}
