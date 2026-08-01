/**
 * 向量检索服务。
 *
 * 当传入可用的 embedClient（callEmbedding 等同构异步函数）与 embedModel 时，
 * 优先使用向量嵌入计算余弦相似度检索；embedClient 不可用或调用失败时，
 * 透明回退到原有的关键词 bigram 匹配逻辑（scoreText），保证向后兼容。
 *
 * @param {object} [options]
 * @param {Function} [options.embedClient] - 异步嵌入函数：(model, input) => { ok, embedding }
 * @param {object} [options.embedModel] - 嵌入模型配置（含 api_base / model_id 等）
 * @param {number} [options.minScore] - 向量结果的最低相似度阈值，默认 0
 * @returns {{ search: Function }}
 */
export function createVectorStore(options = {}) {
  const embedClient = typeof options.embedClient === 'function' ? options.embedClient : null;
  const embedModel = embedClient ? options.embedModel : null;
  const minScore = Number.isFinite(options.minScore) ? options.minScore : 0;

  // chunk_id -> Float32Array 嵌入缓存（惰性计算）
  const embeddingCache = new Map();

  return {
    async search({ query = '', chunks = [], limit = 3 } = {}) {
      const topLimit = Math.max(1, Number(limit) || 3);

      // 优先尝试向量检索；不可用或失败时回退到关键词匹配
      if (embedClient && embedModel && String(query || '').trim()) {
        const result = await searchByEmbedding({ query, chunks, limit: topLimit, minScore });
        if (result) return result;
      }

      // 回退：关键词 bigram 匹配（与原实现一致）
      const scored = chunks
        .map((chunk) => ({ ...chunk, score: scoreText(query, `${chunk.title} ${chunk.text}`) }))
        .filter((chunk) => chunk.score > 0)
        .sort((a, b) => b.score - a.score);
      return scored.slice(0, topLimit);
    },
  };

  /**
   * 基于向量嵌入的检索。返回 null 表示需要回退到关键词匹配。
   */
  async function searchByEmbedding({ query, chunks, limit, minScore }) {
    if (!chunks.length) return [];
    const queryEmbed = await getEmbedding(query);
    if (!queryEmbed) return null;

    const scored = [];
    for (const chunk of chunks) {
      const chunkEmbed = await getChunkEmbedding(chunk);
      if (!chunkEmbed) return null; // 嵌入失败，整体回退
      const score = cosineSimilarity(queryEmbed, chunkEmbed);
      if (score > minScore) scored.push({ ...chunk, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /**
   * 获取单段文本的嵌入向量，失败返回 null。
   */
  async function getEmbedding(text) {
    try {
      const res = await embedClient(embedModel, String(text || ''));
      if (res?.ok && Array.isArray(res.embedding) && res.embedding.length) {
        return toFloat32(res.embedding);
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 获取（并缓存）某个 chunk 的嵌入向量，失败返回 null。
   */
  async function getChunkEmbedding(chunk) {
    const id = chunk?.chunk_id || `${chunk?.document_id || ''}#${chunk?.text?.slice(0, 32)}`;
    if (embeddingCache.has(id)) return embeddingCache.get(id);
    const embed = await getEmbedding(`${chunk.title} ${chunk.text}`.trim());
    if (!embed) return null;
    embeddingCache.set(id, embed);
    return embed;
  }
}

/**
 * 将数值数组归一化为 Float32Array。
 */
function toFloat32(vec) {
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i += 1) out[i] = Number(vec[i]) || 0;
  return out;
}

/**
 * 计算两个向量的余弦相似度。输入可为 number[] 或 Float32Array。
 */
export function cosineSimilarity(a, b) {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i += 1) {
    const x = Number(a[i]) || 0;
    const y = Number(b[i]) || 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function scoreText(query, text) {
  const terms = tokenizeQuery(query);
  if (terms.length === 0) return 0;
  const haystack = String(text || '');
  return terms.reduce((score, term) => score + (haystack.includes(term) ? weightTerm(term) : 0), 0);
}

function tokenizeQuery(query) {
  const value = String(query || '').trim();
  if (!value) return [];
  const terms = new Set(
    value
      .split(/[\s,，。！？；;、：:（）()【】"'“”]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2),
  );
  const policyTerms = [
    '养老政策', '政策', '补贴', '津贴', '高龄津贴', '长护险', '长期护理保险',
    '护理补贴', '养老金', '养老保险', '社区居家养老', '助餐', '适老化',
    '失能评估', '能力评估', '申请条件', '办理条件', '办理材料', '流程',
    '民政', '人社', '老人', '老年人', '家属',
  ];
  for (const term of policyTerms) {
    if (value.includes(term)) terms.add(term);
  }
  for (const segment of value.match(/[\u4e00-\u9fff]{2,}/g) || []) {
    if (segment.length <= 8) terms.add(segment);
    for (let i = 0; i < segment.length - 1; i += 1) {
      terms.add(segment.slice(i, i + 2));
    }
  }
  return Array.from(terms);
}

function weightTerm(term) {
  if (term.length >= 4) return 3;
  if (term.length === 3) return 2;
  return 1;
}
