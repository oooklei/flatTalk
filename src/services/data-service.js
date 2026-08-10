import { createTableDataService } from './table-data/index.js';
import { createKnowledgeDataService } from './knowledge-data/index.js';
import { createInterfaceDataService } from './interface-data/index.js';
import { createQualityMetricsService } from './quality/quality-metrics-service.js';
import { createJtdTravelService } from './travel/jtd-service.js';
import { createRemoteHealthService } from './remote-health/remote-health-service.js';

export function createDataService(options = {}) {
  const interfaceData = createInterfaceDataService(options.interfaceData ?? {});
  return {
    tableData: createTableDataService(options.tableData ?? {}),
    knowledgeData: createKnowledgeDataService(options.knowledgeData ?? {}),
    interfaceData,
    // 服务质量指标（评价来自 service_order+work_order，投诉建议咨询来自 feedback），tag-system 直连 + 本地兜底
    quality: createQualityMetricsService({ tagSystemBiz: interfaceData.tagSystemBiz, ...(options.quality ?? {}) }),
    travelData: {
      jtd: options.travelData?.jtd ?? createJtdTravelService(options.travelData?.jtdOptions ?? {}),
    },
    remoteHealth: options.remoteHealth ?? createRemoteHealthService(options.remoteHealthOptions ?? {}),
  };
}
