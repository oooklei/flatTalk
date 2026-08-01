import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// 嘉路周边配套已迁移至跨技能共享数据层（src/data/jialu_kangyang_center），re-export 避免重复维护
import { getJialuFacilities as _getJialuFacilities } from '../../data/jialu_kangyang_center/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.join(__dirname, 'knowledge');

// 缓存知识库数据
let knowledgeCache = null;

/**
 * 加载本地知识库
 */
function loadKnowledge() {
  if (knowledgeCache) return knowledgeCache;

  const knowledge = {
    facilities: [],      // 嘉路康养中心周边配套（由共享数据层提供，此处保留空兼容）
    institutions: [],    // 广西旅居养老机构
    routes: [],          // 防城港5条线路
    premiumRoutes: [],   // 十条精品路线
    longevityHometowns: [], // 长寿之乡
  };

  try {
    // 加载广西旅居养老机构
    const institutionsPath = path.join(KNOWLEDGE_DIR, 'guangxi_institutions.json');
    if (fs.existsSync(institutionsPath)) {
      const data = JSON.parse(fs.readFileSync(institutionsPath, 'utf-8'));
      knowledge.institutions = data.institutions || [];
      knowledge.longevityHometowns = data.longevityHometowns || [];
    }

    // 加载防城港5条线路
    const routesPath = path.join(KNOWLEDGE_DIR, 'fangchenggang_routes.json');
    if (fs.existsSync(routesPath)) {
      const data = JSON.parse(fs.readFileSync(routesPath, 'utf-8'));
      knowledge.routes = data.routes || [];
    }

    // 加载十条精品路线
    const premiumPath = path.join(KNOWLEDGE_DIR, 'ten_premium_routes.json');
    if (fs.existsSync(premiumPath)) {
      const data = JSON.parse(fs.readFileSync(premiumPath, 'utf-8'));
      knowledge.premiumRoutes = data.routes || [];
    }

    // 加载长寿之乡（如果还没有从 institutions 加载）
    const longevityPath = path.join(KNOWLEDGE_DIR, 'longevity_hometowns.json');
    if (fs.existsSync(longevityPath) && knowledge.longevityHometowns.length === 0) {
      const data = JSON.parse(fs.readFileSync(longevityPath, 'utf-8'));
      knowledge.longevityHometowns = data.hometowns || [];
    }

    knowledgeCache = knowledge;
    return knowledge;
  } catch (error) {
    console.error('[LocalKnowledge] 加载知识库失败:', error.message);
    return knowledge;
  }
}

/**
 * 本地知识库检索
 * @param {Object} options
 * @param {string} options.query - 查询文本
 * @param {string} options.category - 分类（facilities/institutions/routes/premiumRoutes/longevityHometowns）
 * @param {number} options.limit - 返回数量限制
 */
export function searchLocalKnowledge({ query = '', category = '', limit = 5 } = {}) {
  const knowledge = loadKnowledge();
  const results = [];

  // 关键词提取：按空格/标点分词 + bigram 切分（适配无空格中文短语）
  const queryLower = query.toLowerCase();
  const splitKeywords = queryLower.split(/[\s,，、。！？；;：:（）()【】"'“”]+/).filter(k => k.length >= 2);
  const bigrams = [];
  const chineseSegments = queryLower.match(/[一-鿿]+/g) || [];
  for (const seg of chineseSegments) {
    for (let i = 0; i < seg.length - 1; i += 1) {
      bigrams.push(seg.slice(i, i + 2));
    }
  }
  // 去重：优先使用长关键词，bigram 作为补充
  const keywords = [...new Set([...splitKeywords, ...bigrams])];

  // 确定搜索范围
  const categories = category ? [category] : ['facilities', 'institutions', 'routes', 'premiumRoutes', 'longevityHometowns'];

  for (const cat of categories) {
    const items = knowledge[cat] || [];

    for (const item of items) {
      let score = 0;
      const text = JSON.stringify(item).toLowerCase();
      const itemName = (item.name || item.路线名称 || item.机构名称 || '').toLowerCase();

      // 计算关键词匹配分数
      for (const keyword of keywords) {
        if (text.includes(keyword)) {
          score += keyword.length >= 3 ? 2 : 1;
          // 名称/路线名称匹配加分
          if (itemName.includes(keyword)) {
            score += 3;
          }
        }
      }

      // 要求至少达到一定阈值才返回（避免"养老"一词匹配所有内容）
      const minScore = keywords.length >= 2 ? 2 : 3;
      if (score >= minScore) {
        results.push({
          category: cat,
          score,
          item,
        });
      }
    }
  }

  // 按分数排序并返回 top N
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

/**
 * 查询嘉路康养中心周边配套
 * 注：数据源已迁移至共享数据层 src/data/jialu_kangyang_center，此处直接 re-export。
 * @param {Object} options
 * @param {string} options.type - 设施类型（医院、餐厅、景点等）
 * @param {number} options.maxDistance - 最大距离（公里）
 * @param {number} options.limit - 返回数量
 */
export function getJialuFacilities(args) {
  return _getJialuFacilities(args);
}

/**
 * 查询广西旅居养老机构
 * @param {Object} options
 * @param {string} options.city - 城市
 * @param {string} options.name - 机构名称关键词
 */
export function getInstitutions({ city = '', name = '' } = {}) {
  const knowledge = loadKnowledge();
  let institutions = knowledge.institutions || [];

  if (city) {
    institutions = institutions.filter(i =>
      (i.所在市县 || i.city || '').toLowerCase().includes(city.toLowerCase())
    );
  }

  if (name) {
    institutions = institutions.filter(i =>
      (i.机构名称 || i.name || '').toLowerCase().includes(name.toLowerCase())
    );
  }

  return institutions;
}

/**
 * 获取旅居路线推荐
 * @param {Object} options
 * @param {string} options.city - 目标城市
 * @param {string} options.interest - 兴趣偏好（滨海/森林/边境/民俗等）
 */
export function getRoutes({ city = '', interest = '' } = {}) {
  const knowledge = loadKnowledge();
  const allRoutes = [
    ...(knowledge.routes || []),
    ...(knowledge.premiumRoutes || []),
  ];

  let routes = allRoutes;

  if (city) {
    routes = routes.filter(r => {
      const text = JSON.stringify(r).toLowerCase();
      return text.includes(city.toLowerCase());
    });
  }

  if (interest) {
    routes = routes.filter(r => {
      const text = JSON.stringify(r).toLowerCase();
      return text.includes(interest.toLowerCase());
    });
  }

  return routes;
}

/**
 * 获取长寿之乡信息
 * @param {Object} options
 * @param {string} options.city - 城市
 */
export function getLongevityHometowns({ city = '' } = {}) {
  const knowledge = loadKnowledge();
  let hometowns = knowledge.longevityHometowns || [];

  if (city) {
    hometowns = hometowns.filter(h =>
      (h.地区 || h.city || '').toLowerCase().includes(city.toLowerCase())
    );
  }

  return hometowns;
}

export default {
  searchLocalKnowledge,
  getJialuFacilities,
  getInstitutions,
  getRoutes,
  getLongevityHometowns,
};
