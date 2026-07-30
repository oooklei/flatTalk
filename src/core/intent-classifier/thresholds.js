export const INTENT_THRESHOLDS = Object.freeze({
  sos: Number(process.env.FLATTALK_SOS_CONFIDENCE || 0.85),
  health: Number(process.env.FLATTALK_HEALTH_CONFIDENCE || 0.70),
  service: Number(process.env.FLATTALK_SERVICE_CONFIDENCE || 0.70),
  chat: Number(process.env.FLATTALK_CHAT_CONFIDENCE || 0.60),
  lowConfidence: Number(process.env.FLATTALK_INTENT_LOW_CONFIDENCE || 0.70),
});
