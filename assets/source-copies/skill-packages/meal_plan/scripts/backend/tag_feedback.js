import { feedbackTags as feedbackTagsShared } from "../../../platform/scripts/backend/tag_feedback.js";

export function feedbackTags(entityId, entityType, tagCandidates, sourceId) {
  return feedbackTagsShared(entityId, entityType, tagCandidates, sourceId, "meal_plan");
}
