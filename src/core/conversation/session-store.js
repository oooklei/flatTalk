export class SessionStore {
  constructor({ stateStore, ttlSeconds = 7 * 24 * 60 * 60 } = {}) {
    if (!stateStore) throw new Error('stateStore is required');
    this.stateStore = stateStore;
    this.ttlSeconds = ttlSeconds;
  }

  async getOrCreate(conversationId) {
    const id = conversationId || makeId('conv');
    const existing = await this.stateStore.getJson(conversationKey(id));
    if (existing) return existing;

    return {
      conversation_id: id,
      turns: [],
      updated_at: new Date().toISOString(),
    };
  }

  async appendTurn(conversationId, turn) {
    const session = await this.getOrCreate(conversationId);
    const nextTurn = {
      ...turn,
      turn_id: turn.turn_id || makeId(`turn_${session.turns.length + 1}`),
    };
    session.turns.push(nextTurn);
    session.updated_at = new Date().toISOString();
    await this.save(session);
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

  async listConversations() {
    const ids = await this.stateStore.listJson('conversations:index');
    const conversations = [];
    const seen = new Set();

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
      }
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
    updatedAt: session.updatedAt || Date.now(),
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
