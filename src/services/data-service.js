import { createTableDataService } from './table-data/index.js';
import { createKnowledgeDataService } from './knowledge-data/index.js';
import { createInterfaceDataService } from './interface-data/index.js';
import { createJtdTravelService } from './travel/jtd-service.js';

export function createDataService(options = {}) {
  return {
    tableData: createTableDataService(options.tableData ?? {}),
    knowledgeData: createKnowledgeDataService(options.knowledgeData ?? {}),
    interfaceData: createInterfaceDataService(options.interfaceData ?? {}),
    travelData: {
      jtd: options.travelData?.jtd ?? createJtdTravelService(options.travelData?.jtdOptions ?? {}),
    },
  };
}
