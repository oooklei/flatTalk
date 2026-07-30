export function createKnowledgeRetriever({ chunkStore, vectorStore, remoteAdapter = null }) {
  return {
    async retrieve({ skill_key = 'meal_plan', query = '', limit = 3, filters = {} } = {}) {
      // 本地知识库优先：先检索「技能专属 + common 通用」本地内容，命中结果排在前面；
      // 远程知识库仅在启用时作为补充（排在本地的后面），合并后按 limit 截断。
      const skillKeys = Array.from(new Set([skill_key === 'common' ? 'common' : skill_key, 'common']));
      const seen = new Set();
      const local = [];
      for (const sk of skillKeys) {
        const chunks = sk === 'common' ? await chunkStore.listAll() : await chunkStore.listBySkill(sk);
        const matches = await vectorStore.search({ query, chunks, limit });
        for (const m of matches) {
          const key = String(m.content || m.text || '').trim();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          local.push({ ...m, origin: 'local', skill_key: sk });
        }
      }

      const localStatus = local.length ? 'local_hit' : 'local_empty';

      // 远程仅在启用时作为补充，且本地结果优先（排在前面）
      if (!remoteAdapter?.enabled) {
        const merged = local.slice(0, Math.max(1, Number(limit) || 3));
        return {
          source: 'local_first',
          status: localStatus,
          skill_key,
          local_status: localStatus,
          local_count: local.length,
          local_matches: local,
          remote_status: 'disabled',
          remote_count: 0,
          remote_matches: [],
          matches: merged,
        };
      }

      const remote = await remoteAdapter.search({ skill_key, query, limit, filters });
      const remoteMatches = (remote.ok && Array.isArray(remote.matches) ? remote.matches : [])
        .filter((m) => {
          const key = String(m.content || m.text || '').trim();
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((m) => ({ ...m, origin: 'remote' }));

      const merged = [...local, ...remoteMatches].slice(0, Math.max(1, Number(limit) || 3));
      let status;
      if (local.length) status = 'local_hit';
      else if (remoteMatches.length) status = 'remote_hit';
      else if (remote.error) status = 'remote_error';
      else status = 'empty';

      return {
        source: 'local_first',
        status,
        skill_key,
        local_status: localStatus,
        local_count: local.length,
        local_matches: local,
        remote_status: remote.ok ? (remoteMatches.length ? 'remote_hit' : 'remote_empty') : (remote.status || 'remote_error'),
        remote_count: remoteMatches.length,
        remote_matches: remoteMatches,
        remote_error: remote.error || null,
        remote_http_status: remote.http_status || null,
        matches: merged,
      };
    },
  };
}
