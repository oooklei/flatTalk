/**
 * 外部接口数据服务基类
 *
 * 统一职责（全局约定）：取数 → 归一 → 存入对应技能本地知识库。
 * 所有对接外部平台的接口服务（云诊365、云诊舌诊、金跳动旅居、订单、工单、消息等）
 * 都应继承本基类，以复用「运行时取数 + 本地知识库落库」能力。
 *
 * 子类约定：
 *  - 在 constructor 中调用 super({ skillKey, provider, sourcePath, config })
 *  - 实现 fetchRecords(...args) 返回归一化记录数组（每条含唯一 id），并在取数后调用 this.capture(records)
 *  - 或直接复用 fetchAndCapture(...) 统一入口
 */
import { captureToLocalKnowledge } from './interface-knowledge-capture.js';

export class BaseInterfaceService {
  constructor({ skillKey, provider, sourcePath = '', config = {} } = {}) {
    this.skillKey = skillKey;
    this.provider = provider;
    this.sourcePath = sourcePath;
    this.config = config;
  }

  /**
   * 子类实现：调用外部接口并归一化为知识库记录数组。
   * @returns {Promise<Array>} records
   */
  // eslint-disable-next-line no-unused-vars
  async fetchRecords(...args) {
    throw new Error('BaseInterfaceService.fetchRecords 必须由子类实现');
  }

  /**
   * 取数并同时入库（统一入口）。
   * @returns {Promise<{records: Array, captured: {written:number, total:number}}>}
   */
  async fetchAndCapture(...args) {
    const records = await this.fetchRecords(...args);
    const captured = this.capture(records);
    return { records, captured };
  }

  /**
   * 将记录推入异步写入队列（不阻塞调用方，后台自动写入+重试）。
   * @param {Array} records
   */
  capture(records = [], options = {}) {
    if (!Array.isArray(records) || records.length === 0) return { written: 0, total: 0 };
    return captureToLocalKnowledge({
      skillKey: this.skillKey,
      provider: this.provider,
      sourcePath: this.sourcePath,
      records,
      ...options,
    });
  }
}
