export function createVectorStore() {
  return {
    async search({ query = '', chunks = [], limit = 3 } = {}) {
      const scored = chunks
        .map((chunk) => ({ ...chunk, score: scoreText(query, `${chunk.title} ${chunk.text}`) }))
        .filter((chunk) => chunk.score > 0)
        .sort((a, b) => b.score - a.score);
      return scored.slice(0, Math.max(1, Number(limit) || 3));
    },
  };
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
