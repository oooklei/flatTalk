// src/core/city-extractor/normalize.js

// 景点 → 所属城市归一化映射
const SCENIC_TO_CITY = {
  '涠洲岛': '北海', '银滩': '北海', '老街': '北海',
  '亚龙湾': '三亚', '天涯海角': '三亚', '蜈支洲岛': '三亚',
  '阳朔': '桂林', '龙脊梯田': '桂林', '漓江': '桂林',
  '千里岩': '烟台',
  '鼓浪屿': '厦门',
  '西湖': '杭州',
};

// 热门旅居城市正则表（用于快速预筛，避免调 LLM）
const HOT_CITIES = [
  '北海', '桂林', '南宁', '巴马', '昆明', '大理', '丽江',
  '三亚', '海口', '厦门', '西双版纳', '文昌', '琼海',
  '成都', '杭州', '苏州', '青岛',
];

/**
 * 将景点名归一化为所属城市名
 * @param {string} rawName - 原始名称（可能是景点名或城市名）
 * @returns {string} 归一化后的城市名
 */
export function normalizeCity(rawName) {
  if (!rawName) return rawName;
  return SCENIC_TO_CITY[rawName] || rawName;
}

/**
 * 从文本中匹配热门城市（正则快速预筛）
 * @param {string} text - 用户消息或相关文本
 * @returns {string[]} 匹配到的热门城市数组（归一化、去重后）
 */
export function matchHotCity(text) {
  if (!text) return [];
  const matches = new Set();
  for (const city of HOT_CITIES) {
    if (text.includes(city)) {
      matches.add(normalizeCity(city));
    }
  }
  return Array.from(matches);
}
