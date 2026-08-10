import { HttpClient } from './http-client.js';
import { createTagSystemAdapter } from './tag-system-adapter.js';
import { getTagSystemBiz } from './tag-system-biz.js';

export function createInterfaceDataService(options = {}) {
  return {
    httpClient: options.httpClient ?? new HttpClient(options.http ?? {}),
    tagSystem: options.tagSystemAdapter ?? createTagSystemAdapter(options.tagSystem ?? {}),
    // 直连 tag-system 数据库的业务数据访问层（订单/工单/feedback）
    tagSystemBiz: options.tagSystemBiz ?? getTagSystemBiz(),
  };
}
