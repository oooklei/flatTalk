// 远程服务单例：云诊365 + 云诊舌诊。
// 延迟初始化，避免冷启动时立即触发外部依赖。
// 被 health-cards 等模块按需调用。

import { createYz365Service } from '../../services/yz365/index.js';
import { createShezhenService } from '../../services/shezhen/shezhen-service.js';

// 云诊365服务实例（延迟初始化）
let yz365Service = null;
function getYz365Service() {
  if (!yz365Service) {
    yz365Service = createYz365Service();
  }
  return yz365Service;
}

// 云诊舌诊服务实例（延迟初始化）
let shezhenService = null;
function getShezhenService() {
  if (!shezhenService) {
    shezhenService = createShezhenService();
  }
  return shezhenService;
}

export {
  yz365Service,
  getYz365Service,
  shezhenService,
  getShezhenService,
};
