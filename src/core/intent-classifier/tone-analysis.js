import { clampScore } from './schema.js';

const URGENT_WORDS = ['救命', '马上', '立刻', '快点', '很急', '受不了', '喘不过气', '晕倒', '摔倒'];

export function analyzeTone({ text = '', asr_context = {} } = {}) {
  const speed = Number(asr_context.speed ?? asr_context.speech_rate);
  const volume = Number(asr_context.volume);
  const duration = Number(asr_context.duration);
  const urgentWordHits = URGENT_WORDS.filter((word) => String(text).includes(word));
  let score = urgentWordHits.length ? 0.45 : 0;

  if (Number.isFinite(speed) && speed > 1.25) score += 0.2;
  if (Number.isFinite(volume) && volume > 0.75) score += 0.15;
  if (Number.isFinite(duration) && duration < 2 && urgentWordHits.length) score += 0.1;

  return {
    speed: Number.isFinite(speed) ? speed : null,
    volume: Number.isFinite(volume) ? volume : null,
    duration: Number.isFinite(duration) ? duration : null,
    urgency_score: clampScore(score),
    urgent_words: urgentWordHits,
  };
}
