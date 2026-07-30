export function createChunkStore({ documentStore } = {}) {
  return {
    async listBySkill(skillKey) {
      const documents = await documentStore.listBySkill(skillKey);
      return documents.flatMap((document) => chunkDocument(document));
    },

    async listAll() {
      const documents = await documentStore.listAll();
      return documents.flatMap((document) => chunkDocument(document));
    },
  };
}

function chunkDocument(document) {
  const text = document.text || '';
  const parts = text
    .split(/\n{2,}|\n(?=#{1,6}\s)/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) {
    return [makeChunk(document, 0, text)];
  }
  return parts.map((p, i) => makeChunk(document, i, p));
}

function makeChunk(document, index, text) {
  return {
    chunk_id: `${document.document_id}#${index}`,
    document_id: document.document_id,
    skill_key: document.skill_key,
    title: document.title,
    text,
    source_path: document.source_path,
  };
}

