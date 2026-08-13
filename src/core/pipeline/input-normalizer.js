export const MAX_USER_CHARS = 500;

export function assertWithinLimit(text) {
  const s = String(text || '');
  if ([...s].length > MAX_USER_CHARS) {
    return { ok: false, error: 'text_too_long', message: '请将问题控制在500字以内，并分段提问。', length: [...s].length };
  }
  return { ok: true, length: [...s].length };
}

function rulesNormalize(text) {
  let t = String(text || '');
  t = t.replace(/[\u3000]/g, ' ').replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
  t = t.replace(/綫/g, '线').replace(/綫路/g, '线路').replace(/易州/g, '涠洲');
  return t.trim();
}

export async function normalizeInput(text, { llmCall = null, timeoutMs = 2000 } = {}) {
  const original_text = String(text || '');
  const limit = assertWithinLimit(original_text);
  if (!limit.ok) return { ...limit, needs_clarify: true, normalized_text: original_text, fixes: [] };

  let normalized_text = rulesNormalize(original_text);
  let fixes = normalized_text !== original_text ? [{ type: 'rules' }] : [];
  let needs_clarify = false;

  if (typeof llmCall === 'function') {
    try {
      const result = await Promise.race([
        llmCall({
          messages: [
            {
              role: 'system',
              content:
                '纠正错别字、火星文、明显谐音，保留专有名词。输出 JSON：{"normalized_text":"...","fixes":[{"type":"typo"}],"needs_clarify":false}',
            },
            { role: 'user', content: original_text },
          ],
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
      ]);
      const parsed = JSON.parse(String(result.content || '').replace(/```json|```/g, '').trim());
      if (parsed.normalized_text) {
        normalized_text = String(parsed.normalized_text);
        fixes = Array.isArray(parsed.fixes) ? parsed.fixes : fixes;
        needs_clarify = Boolean(parsed.needs_clarify);
      }
    } catch {
      // keep rules result
    }
  }

  return { ok: true, original_text, normalized_text, fixes, needs_clarify };
}
