export class SessionStore {
  constructor({ stateStore, ttlSeconds = 7 * 24 * 60 * 60, repository = null } = {}) {
    if (!stateStore) throw new Error('stateStore is required');
    this.stateStore = stateStore;
    this.ttlSeconds = ttlSeconds;
    this.repository = repository;
  }

  async getOrCreate(conversationId) {
    const id = conversationId || makeId('conv');
    const existing = await this.stateStore.getJson(conversationKey(id));
    if (existing) {
      // 向后兼容：确保 agents 结构存在
      if (!existing.agents) {
        existing.agents = {};
        if (existing.turns && existing.turns.length > 0) {
          existing.agents.common = {
            turns: existing.turns,
            last_template: existing.turns.at(-1)?.envelope?.template_id || '',
            scoped_data: {},
            frozen: false,
          };
        }
      }
      if (!existing.global_context) {
        existing.global_context = {};
      }
      return existing;
    }

    return {
      conversation_id: id,
      turns: [],
      agents: {},
      active_agent: '',
      global_context: {},
      updated_at: new Date().toISOString(),
    };
  }

  async appendTurn(conversationId, turn) {
    const session = await this.getOrCreate(conversationId);
    const nextTurn = {
      ...turn,
      turn_id: turn.turn_id || makeId(`turn_${session.turns.length + 1}`),
      created_at: turn.created_at || new Date().toISOString(),
    };
    session.turns.push(nextTurn);
    session.updated_at = new Date().toISOString();

    // per-agent turns 隔离
    const agentKey = nextTurn.envelope?.agent_key || nextTurn.envelope?.skill_key || 'common';
    if (!session.agents[agentKey]) {
      session.agents[agentKey] = { turns: [], last_template: '', scoped_data: {}, frozen: false };
    }
    session.agents[agentKey].turns.push(nextTurn);
    session.agents[agentKey].last_template = nextTurn.envelope?.template_id || session.agents[agentKey].last_template;
    session.agents[agentKey].frozen = false;
    session.active_agent = agentKey;

    // 冻结其他 Agent
    for (const key of Object.keys(session.agents)) {
      if (key !== agentKey) {
        session.agents[key].frozen = true;
      }
    }

    await this.save(session);

    // 持久化到数据库（conversation_turns 表）
    if (this.repository) {
      try {
        await this.repository.create('conversation_turns', {
          turn_id: nextTurn.turn_id,
          conversation_id: session.conversation_id,
          agent_key: agentKey,
          skill_key: nextTurn.envelope?.skill_key || agentKey,
          template_id: nextTurn.envelope?.template_id || '',
          created_at: nextTurn.created_at,
        });
      } catch (err) {
        // 落库失败不影响缓存流程
        console.warn('[SessionStore] conversation_turns persist failed:', err.message);
      }
    }

    return nextTurn;
  }

  async syncClientConversation(input = {}) {
    const conversationId = input.id || input.conversation_id || input.conversationId || makeId('conv');
    const existing = await this.getOrCreate(conversationId);
    const now = new Date().toISOString();
    const clientConversation = {
      ...input,
      id: conversationId,
      updatedAt: input.updatedAt || input.updated_at || Date.now(),
    };
    const session = {
      ...existing,
      conversation_id: conversationId,
      title: input.title || existing.title || '',
      status: input.status || existing.status || '',
      favorite: Boolean(input.favorite ?? existing.favorite),
      latestQuestion: input.latestQuestion || existing.latestQuestion || '',
      latestAnswer: input.latestAnswer || existing.latestAnswer || '',
      roleKey: input.roleKey || existing.roleKey || '',
      userToken: input.userToken || existing.userToken || '',
      presetKey: input.presetKey || existing.presetKey || '',
      client_conversation: clientConversation,
      updated_at: now,
    };
    await this.save(session);
    return session;
  }

  async syncClientConversations(conversations = []) {
    const saved = [];
    for (const conversation of conversations) {
      if (conversation && typeof conversation === 'object') {
        saved.push(await this.syncClientConversation(conversation));
      }
    }
    return saved;
  }

  async getPreviousTurn(conversationId) {
    const session = await this.getOrCreate(conversationId);
    return session.turns.at(-1) || null;
  }

  async getAgentContext(conversationId, agentKey) {
    const session = await this.getOrCreate(conversationId);
    return session.agents?.[agentKey] || null;
  }

  async getGlobalContext(conversationId) {
    const session = await this.getOrCreate(conversationId);
    return session.global_context || {};
  }

  async listConversations() {
    const ids = await this.stateStore.listJson('conversations:index');
    const conversations = [];
    const seen = new Set();
    const staleIds = [];

    for (const conversationId of ids) {
      if (seen.has(conversationId)) continue;
      seen.add(conversationId);
      const session = await this.stateStore.getJson(conversationKey(conversationId));
      if (session) {
        conversations.push({
          conversation_id: session.conversation_id,
          id: session.conversation_id,
          title: session.title || session.client_conversation?.title || '',
          status: session.status || session.client_conversation?.status || '',
          favorite: Boolean(session.favorite || session.client_conversation?.favorite),
          latestQuestion: session.latestQuestion || session.client_conversation?.latestQuestion || '',
          latestAnswer: session.latestAnswer || session.client_conversation?.latestAnswer || '',
          turn_count: session.turns?.length || 0,
          updated_at: session.updated_at,
          messages: JSON.stringify(session.client_conversation || toClientConversation(session)),
        });
      } else {
        staleIds.push(conversationId);
      }
    }

    // 清理失效索引（保持 Redis LIST 语义，禁止 setJson 写成 STRING）
    if (staleIds.length > 0) {
      const validIds = ids.filter((id) => !staleIds.includes(id));
      await this.stateStore.replaceListJson('conversations:index', validIds);
    }

    return conversations;
  }

  async save(session) {
    await this.stateStore.setJson(conversationKey(session.conversation_id), session, {
      ttlSeconds: this.ttlSeconds,
    });
    const ids = await this.stateStore.listJson('conversations:index');
    if (!ids.includes(session.conversation_id)) {
      await this.stateStore.pushJson('conversations:index', session.conversation_id);
    }
    return session;
  }

  async deleteConversation(conversationId) {
    if (!conversationId) return false;
    await this.stateStore.clear(conversationKey(conversationId));
    // 清理索引中的已删除 ID（保持 LIST）
    const ids = await this.stateStore.listJson('conversations:index');
    const filtered = ids.filter((id) => id !== conversationId);
    if (filtered.length !== ids.length) {
      await this.stateStore.replaceListJson('conversations:index', filtered);
    }
    return true;
  }

  async markHarvested(conversationId, metadata = {}) {
    const session = await this.getOrCreate(conversationId);
    if (!session.conversation_id) return null;
    session.harvest = {
      synced: true,
      synced_at: new Date().toISOString(),
      ...metadata,
    };
    await this.save(session);

    // 导出 conversation_turns 到持久化存储
    if (this.repository) {
      try {
        for (const turn of session.turns || []) {
          const exists = await this.repository.findById('conversation_turns', turn.turn_id);
          if (!exists) {
            await this.repository.create('conversation_turns', {
              turn_id: turn.turn_id,
              conversation_id: session.conversation_id,
              skill_key: turn.envelope?.skill_key || turn.skill_key || '',
              template_id: turn.envelope?.template_id || turn.template_id || '',
              created_at: turn.created_at || new Date().toISOString(),
            });
          }
        }
      } catch (err) {
        console.warn('[SessionStore] harvest export failed:', err.message);
      }
    }

    return session.harvest;
  }
}

export function createSessionStore(options = {}) {
  return new SessionStore(options);
}

function conversationKey(conversationId) {
  return `conversation:${conversationId}`;
}

function toClientConversation(session = {}) {
  const messages = [];
  for (const turn of session.turns || []) {
    if (turn.user_message) {
      messages.push({ role: 'user', content: turn.user_message, at: turn.created_at || null });
    }
    const answer = turn.envelope?.answer || turn.envelope?.message || turn.envelope?.llm?.answer || '';
    if (answer) {
      messages.push({ role: 'ai', content: answer, markdown: false, at: turn.created_at || null });
    }
  }
  return {
    id: session.conversation_id,
    title: session.title || session.latestQuestion || '新对话',
    createdAt: session.createdAt || Date.now(),
    updatedAt: session.updated_at || Date.now(),
    status: session.status || '已答复',
    favorite: Boolean(session.favorite),
    latestQuestion: session.latestQuestion || '',
    latestAnswer: session.latestAnswer || '',
    messages,
  };
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
