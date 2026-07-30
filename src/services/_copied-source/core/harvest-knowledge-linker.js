/**
 * 域 5: 对话收割 — 收割知识库衔接 (Harvest Knowledge Linker)
 *
 * P3-4: 收割知识库衔接（审核通过 → 同步女娲知识库）
 *
 * 将审核通过的收割记录链接到女娲平台知识库：
 *   1. 从 gxy_dialogue_harvest / stateStore 读取收割记录
 *   2. 构造 Q&A 格式文档（title + content + metadata）
 *   3. 调用女娲 API 上传到知识库
 *   4. 更新收割记录的 knowledge_linked 状态
 *
 * 数据来源优先级：
 *   1. MySQL gxy_dialogue_harvest（如可用，权威持久化）
 *   2. stateStore 列表 dialogue-harvest-candidates
 *
 * 关键约束：
 *   1. MySQL 未配置时退化为 stateStore 模式
 *   2. nuwaxClient 未配置时只更新待链接状态，不上传
 *   3. 所有方法返回 Promise，出错抛 Error
 *   4. autoLink 单条失败不阻断其他记录
 *
 * @lifecycle active
 * @scope all
 * @writes-remote true  （调用女娲 API 上传知识库文档）
 * @requires-apply false  （运行时即写即用）
 * @description P3-4 收割知识库衔接
 */

const STATE_KEY_CANDIDATES = "dialogue-harvest-candidates";
const STATE_KEY_LINK_LOG = "harvest-knowledge-link-log";

/**
 * 规范化收割记录字段。
 */
function sanitizeHarvest(raw = {}) {
  return {
    candidate_id: raw.candidate_id || raw.candidateId || "",
    question: raw.question || "",
    answer: raw.answer || "",
    confidence: Number(raw.confidence ?? 0),
    skill_key: raw.skill_key || raw.skillKey || "",
    intent: raw.intent || "",
    template_id: raw.template_id || raw.templateId || "",
    route_summary: raw.route_summary || raw.routeSummary || {},
    status: raw.status || "auto_pending_admin_review",
    knowledge_linked: raw.knowledge_linked === true || raw.knowledgeLinked === true,
    knowledge_doc_id: raw.knowledge_doc_id || raw.knowledgeDocId || "",
    knowledge_linked_at: raw.knowledge_linked_at || raw.knowledgeLinkedAt || "",
    created_at: raw.created_at || "",
    updated_at: raw.updated_at || "",
  };
}

export class HarvestKnowledgeLinker {
  /**
   * @param {object} opts
   * @param {object} opts.stateStore - StateStore 实例
   * @param {object|null} [opts.mysqlPool=null] - mysql2 连接池实例
   * @param {object|null} [opts.nuwaxClient=null] - 女娲 API 客户端（须实现 uploadKnowledgeDocument(doc)）
   * @param {object|null} [opts.logger=null] - 日志器
   */
  constructor({ stateStore, mysqlPool = null, nuwaxClient = null, logger = null } = {}) {
    if (!stateStore) throw new Error("HarvestKnowledgeLinker requires stateStore");
    this.stateStore = stateStore;
    this.mysqlPool = mysqlPool || null;
    this.nuwaxClient = nuwaxClient || null;
    this.logger = logger;
  }

  /**
   * 将单条收割记录链接到知识库。
   * @param {string} harvestId - 收割记录 ID（candidate_id）
   * @returns {Promise<{ok:boolean, knowledge_doc_id:string|null, harvest_id:string, error?:string}>}
   */
  async linkHarvestToKnowledge(harvestId) {
    if (!harvestId) throw new Error("linkHarvestToKnowledge requires harvestId");

    const harvest = await this._loadHarvest(harvestId);
    if (!harvest) {
      return { ok: false, knowledge_doc_id: null, harvest_id: harvestId, error: "harvest_not_found" };
    }
    if (harvest.knowledge_linked && harvest.knowledge_doc_id) {
      // 已链接，幂等返回
      return { ok: true, knowledge_doc_id: harvest.knowledge_doc_id, harvest_id: harvestId };
    }
    if (harvest.status !== "approved") {
      return { ok: false, knowledge_doc_id: null, harvest_id: harvestId, error: `harvest_status_not_approved:${harvest.status}` };
    }
    if (!harvest.question || !harvest.answer) {
      return { ok: false, knowledge_doc_id: null, harvest_id: harvestId, error: "empty_question_or_answer" };
    }

    const doc = this._buildKnowledgeDocument(harvest);

    // nuwaxClient 未配置 → 只记录待链接状态，不上传
    if (!this.nuwaxClient || typeof this.nuwaxClient.uploadKnowledgeDocument !== "function") {
      await this._markPendingLink(harvest, doc);
      this._log("harvest-link-skipped-no-nuwax-client", { harvest_id: harvestId });
      return { ok: false, knowledge_doc_id: null, harvest_id: harvestId, error: "nuwax_client_not_configured" };
    }

    try {
      const uploadResult = await this.nuwaxClient.uploadKnowledgeDocument(doc);
      const knowledgeDocId = uploadResult?.doc_id || uploadResult?.document_id || uploadResult?.id || `kw_${harvestId}_${Date.now()}`;
      await this._markLinked(harvest, knowledgeDocId);
      this._log("harvest-linked", { harvest_id: harvestId, knowledge_doc_id: knowledgeDocId });
      return { ok: true, knowledge_doc_id: knowledgeDocId, harvest_id: harvestId };
    } catch (err) {
      await this._markLinkFailed(harvest, err.message);
      this._log("harvest-link-error", { harvest_id: harvestId, error: err.message });
      return { ok: false, knowledge_doc_id: null, harvest_id: harvestId, error: err.message };
    }
  }

  /**
   * 批量链接收割记录到知识库。单条失败不阻断其他记录。
   * @param {Array<string>} harvestIds
   * @returns {Promise<{linked_count:number, failed_count:number, details:Array}>}
   */
  async batchLink(harvestIds = []) {
    if (!Array.isArray(harvestIds) || !harvestIds.length) {
      return { linked_count: 0, failed_count: 0, details: [] };
    }
    const details = [];
    let linked = 0;
    let failed = 0;
    for (const harvestId of harvestIds) {
      try {
        const result = await this.linkHarvestToKnowledge(harvestId);
        if (result.ok) linked += 1;
        else failed += 1;
        details.push(result);
      } catch (err) {
        failed += 1;
        details.push({ ok: false, harvest_id: harvestId, error: err.message });
        this._log("harvest-batch-link-error", { harvest_id: harvestId, error: err.message });
      }
    }
    return { linked_count: linked, failed_count: failed, details };
  }

  /**
   * 查询收割记录已链接的知识库文档信息。
   * @param {string} harvestId
   * @returns {Promise<{linked:boolean, knowledge_doc_id?:string, knowledge_linked_at?:string}|null>}
   */
  async getLinkedKnowledge(harvestId) {
    if (!harvestId) throw new Error("getLinkedKnowledge requires harvestId");
    const harvest = await this._loadHarvest(harvestId);
    if (!harvest) return null;
    return {
      linked: Boolean(harvest.knowledge_linked),
      knowledge_doc_id: harvest.knowledge_doc_id || "",
      knowledge_linked_at: harvest.knowledge_linked_at || "",
    };
  }

  /**
   * 取消链接（仅更新本地状态，不删除女娲侧文档）。
   * @param {string} harvestId
   * @returns {Promise<{unlinked:boolean, harvest_id:string}>}
   */
  async unlinkHarvestFromKnowledge(harvestId) {
    if (!harvestId) throw new Error("unlinkHarvestFromKnowledge requires harvestId");
    const now = new Date().toISOString();
    if (this.mysqlPool) {
      try {
        await this.mysqlPool.execute(
          "UPDATE gxy_dialogue_harvest SET knowledge_linked=0, knowledge_doc_id='', knowledge_linked_at='', updated_at=? WHERE candidate_id=?",
          [now, harvestId]
        );
      } catch (err) {
        this._log("harvest-unlink-mysql-error", { error: err.message, harvest_id: harvestId });
      }
    }
    // stateStore 更新
    const candidates = await this.stateStore.getList(STATE_KEY_CANDIDATES, 1000);
    const updated = candidates.map((item) => {
      if (item.candidate_id === harvestId || item.candidateId === harvestId) {
        return {
          ...item,
          knowledge_linked: false,
          knowledge_doc_id: "",
          knowledge_linked_at: "",
          updated_at: now,
        };
      }
      return item;
    });
    if (JSON.stringify(updated) !== JSON.stringify(candidates)) {
      await this.stateStore.set(`${STATE_KEY_CANDIDATES}:snapshot`, updated, 24 * 60 * 60 * 1000);
    }
    this._log("harvest-unlinked", { harvest_id: harvestId });
    return { unlinked: true, harvest_id: harvestId };
  }

  /**
   * 列出待链接的收割记录（status=approved 且 knowledge_linked=false）。
   * @param {number} [limit=50]
   * @returns {Promise<Array>}
   */
  async listPendingLink(limit = 50) {
    const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 500);
    if (this.mysqlPool) {
      try {
        const [rows] = await this.mysqlPool.query(
          `SELECT candidate_id, question, answer, confidence, skill_key, intent, template_id, route_summary, status, created_at
           FROM gxy_dialogue_harvest
           WHERE status='approved' AND (knowledge_linked=0 OR knowledge_linked IS NULL)
           ORDER BY created_at ASC
           LIMIT ?`,
          [safeLimit]
        );
        if (Array.isArray(rows) && rows.length) return rows.map(sanitizeHarvest);
      } catch (err) {
        this._log("harvest-pending-mysql-error", { error: err.message });
      }
    }
    const all = await this.stateStore.getList(STATE_KEY_CANDIDATES, 1000);
    return all
      .filter((item) => item.status === "approved" && !item.knowledge_linked)
      .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
      .slice(0, safeLimit);
  }

  /**
   * 自动链接（定时任务调用）。
   * 查询所有 status=approved 且 knowledge_linked=false 的记录，逐条链接到知识库。
   * @param {number} [limit=50] - 单次处理上限，避免一次性压垮女娲 API
   * @returns {Promise<{linked_count:number, failed_count:number, total_pending:number, details:Array}>}
   */
  async autoLink(limit = 50) {
    const pending = await this.listPendingLink(limit);
    if (!pending.length) {
      return { linked_count: 0, failed_count: 0, total_pending: 0, details: [] };
    }
    const details = await this.batchLink(pending.map((item) => item.candidate_id));
    return {
      linked_count: details.linked_count,
      failed_count: details.failed_count,
      total_pending: pending.length,
      details: details.details,
    };
  }

  // —— 内部辅助 ——

  /**
   * 构造女娲知识库 Q&A 文档。
   * 格式与设计文档 P3-4 一致：
   *   {
   *     title: "Q: 用户问题",
   *     content: "A: 收割答案",
   *     metadata: { source, harvest_id, conversation_id, confidence }
   *   }
   */
  _buildKnowledgeDocument(harvest) {
    const harvestId = harvest.candidate_id || harvest.candidateId || "";
    const routeSummary = harvest.route_summary || {};
    return {
      title: `Q: ${String(harvest.question || "").slice(0, 200)}`,
      content: `A: ${String(harvest.answer || "")}`,
      metadata: {
        source: "dialogue_harvest",
        harvest_id: harvestId,
        conversation_id: routeSummary.conversation_id || routeSummary.conversationId || "",
        confidence: Number(harvest.confidence ?? 0),
        skill_key: harvest.skill_key || "",
        intent: harvest.intent || "",
        template_id: harvest.template_id || "",
        linked_at: new Date().toISOString(),
      },
    };
  }

  async _loadHarvest(harvestId) {
    if (!harvestId) return null;
    if (this.mysqlPool) {
      try {
        const [rows] = await this.mysqlPool.query(
          "SELECT candidate_id, question, answer, confidence, skill_key, intent, template_id, route_summary, status, knowledge_linked, knowledge_doc_id, knowledge_linked_at, created_at, updated_at FROM gxy_dialogue_harvest WHERE candidate_id=? LIMIT 1",
          [harvestId]
        );
        if (Array.isArray(rows) && rows.length) {
          const row = rows[0];
          if (typeof row.route_summary === "string") {
            try { row.route_summary = JSON.parse(row.route_summary); } catch { row.route_summary = {}; }
          }
          if (typeof row.knowledge_linked === "number") {
            row.knowledge_linked = row.knowledge_linked === 1;
          }
          return sanitizeHarvest(row);
        }
      } catch (err) {
        this._log("harvest-load-mysql-error", { error: err.message, harvest_id: harvestId });
      }
    }
    const candidates = await this.stateStore.getList(STATE_KEY_CANDIDATES, 1000);
    const found = candidates.find((item) => item.candidate_id === harvestId || item.candidateId === harvestId);
    return found ? sanitizeHarvest(found) : null;
  }

  async _markLinked(harvest, knowledgeDocId) {
    const now = new Date().toISOString();
    if (this.mysqlPool) {
      try {
        await this.mysqlPool.execute(
          "UPDATE gxy_dialogue_harvest SET knowledge_linked=1, knowledge_doc_id=?, knowledge_linked_at=?, updated_at=? WHERE candidate_id=?",
          [knowledgeDocId, now, now, harvest.candidate_id]
        );
      } catch (err) {
        this._log("harvest-mark-linked-mysql-error", { error: err.message, harvest_id: harvest.candidate_id });
      }
    }
    // 更新 stateStore 列表
    await this._updateStateStoreCandidate(harvest.candidate_id, {
      knowledge_linked: true,
      knowledge_doc_id: knowledgeDocId,
      knowledge_linked_at: now,
      updated_at: now,
    });
    await this.stateStore.pushList(STATE_KEY_LINK_LOG, {
      action: "linked",
      harvest_id: harvest.candidate_id,
      knowledge_doc_id: knowledgeDocId,
      at: now,
    }, 500);
  }

  async _markPendingLink(harvest, doc) {
    const now = new Date().toISOString();
    await this._updateStateStoreCandidate(harvest.candidate_id, {
      knowledge_linked: false,
      knowledge_doc_id: "",
      knowledge_link_pending: true,
      knowledge_link_pending_at: now,
      updated_at: now,
    });
    await this.stateStore.pushList(STATE_KEY_LINK_LOG, {
      action: "pending",
      harvest_id: harvest.candidate_id,
      at: now,
      reason: "nuwax_client_not_configured",
    }, 500);
  }

  async _markLinkFailed(harvest, errorMessage) {
    const now = new Date().toISOString();
    if (this.mysqlPool) {
      try {
        await this.mysqlPool.execute(
          "UPDATE gxy_dialogue_harvest SET knowledge_link_error=?, updated_at=? WHERE candidate_id=?",
          [errorMessage, now, harvest.candidate_id]
        );
      } catch (err) {
        this._log("harvest-mark-failed-mysql-error", { error: err.message, harvest_id: harvest.candidate_id });
      }
    }
    await this._updateStateStoreCandidate(harvest.candidate_id, {
      knowledge_linked: false,
      knowledge_doc_id: "",
      knowledge_link_error: errorMessage,
      knowledge_link_failed_at: now,
      updated_at: now,
    });
    await this.stateStore.pushList(STATE_KEY_LINK_LOG, {
      action: "failed",
      harvest_id: harvest.candidate_id,
      at: now,
      error: errorMessage,
    }, 500);
  }

  async _updateStateStoreCandidate(harvestId, updates) {
    if (!harvestId) return;
    const candidates = await this.stateStore.getList(STATE_KEY_CANDIDATES, 1000);
    let modified = false;
    const updated = candidates.map((item) => {
      if (item.candidate_id === harvestId || item.candidateId === harvestId) {
        modified = true;
        return { ...item, ...updates };
      }
      return item;
    });
    if (modified) {
      await this.stateStore.set(`${STATE_KEY_CANDIDATES}:snapshot`, updated, 24 * 60 * 60 * 1000);
    }
  }

  _log(name, payload = {}) {
    if (this.logger && typeof this.logger.write === "function") {
      this.logger.write(name, payload);
    }
  }
}

export default HarvestKnowledgeLinker;
