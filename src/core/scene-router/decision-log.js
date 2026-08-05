const MAX = 200;
const ring = [];

export function logSceneDecision(entry) {
  const row = {
    ts: new Date().toISOString(),
    utterance: String(entry.utterance || '').slice(0, 200),
    candidates: (entry.candidates || []).slice(0, 5).map((c) => ({
      scene_key: c.scene_key,
      score: c.score,
      confidence: c.confidence,
      decision: c.decision,
    })),
    margin: entry.margin,
    conflict_notes: entry.conflict_notes || [],
    transition_type: entry.transition_type || null,
    ambiguity: Boolean(entry.ambiguity),
    final_scene: entry.final_scene || null,
  };
  ring.push(row);
  if (ring.length > MAX) ring.shift();
  if (process.env.FLAT_TALK_ROUTE_LOG !== '0') {
    console.log('[scene-decision]', JSON.stringify(row));
  }
  return row;
}

export function getRecentSceneDecisions(limit = 50) {
  return ring.slice(-limit);
}
