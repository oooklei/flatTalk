/**
 * 域 5: 对话收割 - 文本相似度计算纯函数模块
 *
 * 提供问题归一化、相似度计算与高置信判断，无副作用、无 I/O。
 * 被 harvest-router.js 使用，也可独立用于测试或离线分析。
 */

const PUNCTUATION_REGEX = /[\s\p{P}\p{S}]/gu;

/**
 * 归一化问题文本：转小写、去标点符号与空白。
 */
export function normalizeQuestion(text = "") {
  return String(text || "")
    .toLowerCase()
    .replace(PUNCTUATION_REGEX, "")
    .trim();
}

function bigrams(text = "") {
  const set = new Set();
  for (let i = 0; i < text.length - 1; i += 1) {
    set.add(text.slice(i, i + 2));
  }
  return set;
}

function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection += 1;
  }
  return intersection / (setA.size + setB.size - intersection);
}

function levenshteinDistance(a = "", b = "") {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j += 1) prev[j] = curr[j];
  }
  return prev[n];
}

function editDistanceSimilarity(a = "", b = "") {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const distance = levenshteinDistance(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

/**
 * 计算两段文本的相似度，综合 Jaccard（bigram 交集）与编辑距离。
 * 返回 0~1 之间的浮点数，1 表示完全相同。
 */
export function calculateSimilarity(text1 = "", text2 = "") {
  const a = normalizeQuestion(text1);
  const b = normalizeQuestion(text2);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const jaccard = jaccardSimilarity(bigrams(a), bigrams(b));
  const editSim = editDistanceSimilarity(a, b);
  return jaccard * 0.6 + editSim * 0.4;
}

/**
 * 判断相似度是否达到高置信阈值。
 */
export function isHighConfidence(similarity = 0, threshold = 0.85) {
  return Number(similarity) >= Number(threshold);
}

export default {
  normalizeQuestion,
  calculateSimilarity,
  isHighConfidence,
};
