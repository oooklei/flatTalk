// src/core/compact-followups/renderer.js

import { labelForActionKey, isRawActionKeyText } from '../actions/action-labels.js';

// 互逆动作对
const COMPLEMENTARY_PAIRS = [
  ['收藏', '取消收藏'],
  ['关注', '取消关注'],
  ['预定', '取消预定'],
  ['报名', '取消报名'],
];

/**
 * 将 compact_followups 数组渲染为胶囊 HTML
 * @param {Array} followups - 紧密追问数组
 * @returns {string} HTML 字符串（空数组返回空字符串）
 */
export function renderCompactFollowups(followups) {
  const validFollowups = normalizeCompactFollowups(followups);
  if (validFollowups.length === 0) return '';

  const chips = validFollowups.map((f) => {
    const styleClass = f.style === 'primary' ? ' compact-chip--primary'
      : f.style === 'danger' ? ' compact-chip--danger'
      : f.input ? ' compact-chip--input'
      : '';
    const paramsAttr = f.params ? ` data-params='${JSON.stringify(f.params)}'` : '';
    const inputAttr = f.input ? ` data-input='${JSON.stringify(f.input)}'` : '';
    const actionAttr = f.action_key ? ` data-action-key="${f.action_key}"` : '';
    return `  <button class="compact-chip${styleClass}"${actionAttr}${paramsAttr}${inputAttr}>${escapeHtml(f.label || '')}</button>`;
  });

  return `<div class="compact-followups">\n${chips.join('\n')}\n</div>`;
}

export function normalizeCompactFollowups(followups) {
  if (!Array.isArray(followups)) return [];
  return followups
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const actionKey = normalizeVisibleText(item.action_key || item.key || '');
      const rawLabel = normalizeVisibleText(item.label || item.text || item.title || item.name);
      const label = labelForActionKey(actionKey, rawLabel);
      const rawPrompt = normalizeVisibleText(item.user_prompt || item.prompt || item.label || item.text || '');
      const userPrompt = rawPrompt && !isRawActionKeyText(rawPrompt) ? rawPrompt : label;
      return {
        ...item,
        label,
        user_prompt: userPrompt,
        action_key: actionKey,
      };
    })
    .filter((item) => item.label && item.action_key);
}

/**
 * 互斥去重：从 message followups 中剔除与 compact followups 重复的条目
 * @param {Array} compactFollowups - 卡片紧密追问（全量保留）
 * @param {Array} messageFollowups - 消息追问（被去重）
 * @returns {Array} 去重后的消息追问数组
 */
export function dedupeFollowups(compactFollowups = [], messageFollowups = []) {
  const normalizedCompactFollowups = normalizeCompactFollowups(compactFollowups);
  if (!normalizedCompactFollowups.length) return messageFollowups;
  if (!messageFollowups.length) return [];

  // 收集 compact 的 action_key 集合
  const compactKeys = new Set(normalizedCompactFollowups.map((f) => f.action_key).filter(Boolean));

  // 收集 compact 的 label 集合（归一化）
  const compactLabels = new Set(normalizedCompactFollowups.map((f) => normalizeLabel(f.label)).filter(Boolean));

  // 收集互逆对
  const compactComplements = new Set();
  for (const f of normalizedCompactFollowups) {
    for (const [a, b] of COMPLEMENTARY_PAIRS) {
      if (normalizeLabel(f.label).includes(normalizeLabel(a))) compactComplements.add(normalizeLabel(b));
      if (normalizeLabel(f.label).includes(normalizeLabel(b))) compactComplements.add(normalizeLabel(a));
    }
  }

  return messageFollowups.filter((mf) => {
    // 规则 1: action_key 相同
    if (mf.action_key && compactKeys.has(mf.action_key)) return false;
    // 规则 2: label 语义相近（字符级 Jaccard ≥0.3，针对中文短标签调低阈值）
    const mfLabel = normalizeLabel(mf.label);
    for (const cl of compactLabels) {
      if (labelSimilarity(mfLabel, cl) >= 0.3) return false;
    }
    // 规则 3: 互逆动作
    for (const cc of compactComplements) {
      if (mfLabel.includes(cc)) return false;
    }
    return true;
  });
}

// --- 内部工具函数 ---

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeLabel(label = '') {
  return String(label).trim().toLowerCase().replace(/\s+/g, '');
}

function normalizeVisibleText(value = '') {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;|&#x[aA]0;/g, ' ')
    .trim();
}

/**
 * 计算两个标签的词面相似度（基于字符重叠）
 * @returns {number} 0.0-1.0
 */
function labelSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  // 字符级 Jaccard 相似度
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const ch of setA) {
    if (setB.has(ch)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}
