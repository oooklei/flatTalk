function scoreEvidenceGroups(text, evidenceGroups) {
  if (!evidenceGroups || !text) return 0;
  let score = 0;
  for (const eg of evidenceGroups) {
    for (const term of eg.terms) {
      if (text.includes(String(term).toLowerCase())) {
        score += eg.weight;
        break;
      }
    }
  }
  return score;
}

function scoreKeywords(text, keywords) {
  if (!keywords || !text) return 0;
  let hits = 0;
  for (const kw of keywords) {
    if (text.includes(String(kw).toLowerCase())) hits++;
  }
  return hits;
}

export function createBaseAgent(config = {}) {
  const {
    key, name, actionPrefix = key,
    keywords = [], evidenceGroups = [],
    boundaryTerms = [], boundaryMap = {},
    threshold = 1,
  } = config;

  return {
    key, name, actionPrefix,

    matchScore(message) {
      const text = String(message || '').toLowerCase();
      if (!text) return 0;
      let raw;
      if (evidenceGroups.length > 0) {
        raw = scoreEvidenceGroups(text, evidenceGroups);
      } else {
        raw = scoreKeywords(text, keywords);
      }
      return Math.min(1, raw / Math.max(threshold, 1));
    },

    canHandle(message, context = {}) {
      const text = String(message || '').toLowerCase();
      if (!text) return false;

      for (const term of boundaryTerms) {
        if (text.includes(String(term).toLowerCase())) {
          const suggest = boundaryMap[term];
          if (suggest && suggest !== key) {
            return { suggest, reason: term };
          }
        }
      }

      const score = this.matchScore(message);
      if (score >= 0.3) return true;

      const lastTemplate = context.last_template || context.previous_template;
      if (lastTemplate && context.active_agent === key) {
        if (/换|调整|改成|继续|再|这个|不要|加|减|更多|软烂|清淡/.test(text)) {
          return true;
        }
      }

      return false;
    },

    async handle(req) {
      throw new Error(`Agent "${key}" must implement handle()`);
    },

    getInteractions() {
      return { actions: [], followups: [], compact_followups: [] };
    },
  };
}
