// 模板填槽服务（barrel 文件）。
// 原始实现已按业务域拆分到 ./model-service/ 目录下的子模块，
// 本文件仅做重新导出，保持下游消费者（chat-orchestrator.js、
// template-card-llm-service.js 等）的 import 路径不变。
//
// 对外导出契约（5 项）：
//   - LOCAL_FILL_TEMPLATE_IDS        常量（来自 extra-template-fills）
//   - fillTemplateSlots              总分发入口（来自 dispatch）
//   - fillTravelH5EmbedCard          旅居 H5 嵌入卡（来自 travel-cards）
//   - fillTravelWeatherRiskCard      旅居天气风险卡（来自 travel-cards）
//   - fillTravelWeatherRisk          旅居天气风险（向后兼容别名，来自 travel-cards）

export { LOCAL_FILL_TEMPLATE_IDS } from './model-runtime/extra-template-fills.js';
export { fillTemplateSlots } from './model-service/dispatch.js';
export {
  fillTravelH5EmbedCard,
  fillTravelWeatherRiskCard,
  fillTravelWeatherRisk,
} from './model-service/travel-cards.js';
