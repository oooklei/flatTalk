/**
 * 数据补全引擎（Data Augmentor）
 *
 * 功能：
 * 1. 从内部 API 和公开搜索补全缺失数据
 * 2. 支持多种数据源：知识库、JTD API、Tavily、地图、天气
 * 3. 数据清洗（复用 containsUnsafeValue 规则）
 * 4. 超时控制和失败处理
 *
 * 数据源优先级：
 * 1. 内部来源（KB/JTD）- 优先
 * 2. 公开搜索（Tavily）- 兜底
 */

import fs from 'fs';
import path from 'path';
import { containsUnsafeValue } from './template-composition-selector.js';
import { TavilyPoiEnricher } from '../adapters/tavily-poi-enricher.js';
import { TencentMapPoiAdapter } from '../adapters/tencent-map-poi.js';

// 默认配置
const DEFAULT_REGISTRY = {
  version: 'gxy-augment-registry.v1',
  field_strategies: {},
  constraints: {
    max_fields_per_request: 5,
    field_timeout_ms: 5000,
    total_timeout_ms: 10000,
  },
};

export class DataAugmentor {
  constructor(config = {}) {
    // 加载配置
    this.registry = config.registry || this._loadRegistry(config.configPath) || DEFAULT_REGISTRY;
    this.timeout = config.timeout || this.registry.constraints?.total_timeout_ms || 10000;
    this.fieldTimeout = config.fieldTimeout || this.registry.constraints?.field_timeout_ms || 5000;

    // 初始化外部服务适配器
    this.tavilyEnricher = new TavilyPoiEnricher({
      timeout: this.fieldTimeout,
    });

    this.mapAdapter = new TencentMapPoiAdapter({
      timeout: this.fieldTimeout,
    });
  }

  /**
   * 从文件加载配置
   */
  _loadRegistry(configPath) {
    if (!configPath) return null;

    try {
      // 尝试多种路径
      const possiblePaths = [
        configPath,
        path.join(process.cwd(), configPath),
        path.join(process.cwd(), 'guixiaoyang-chat-system', configPath),
      ];

      for (const filePath of possiblePaths) {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf-8');
          return JSON.parse(content);
        }
      }

      return null;
    } catch (e) {
      console.error(`Failed to load augment registry: ${e.message}`);
      return null;
    }
  }

  /**
   * 主补全方法
   *
   * @param {object} data - 原始数据
   * @param {Array<string>} missingFields - 缺失字段列表
   * @param {object} context - 上下文信息（用于构建搜索查询）
   * @returns {object} { data, augmented_fields, augment_trace }
   */
  augment(data, missingFields, context = {}) {
    const startTime = Date.now();
    const constraints = this.registry.constraints || {};
    const maxFields = constraints.max_fields_per_request || 5;

    // 限制单次补全字段数
    const fieldsToAugment = (missingFields || []).slice(0, maxFields);

    const result = {
      data: { ...data },
      augmented_fields: [],
      augment_trace: [],
    };

    for (const field of fieldsToAugment) {
      // 检查总超时
      if (Date.now() - startTime > this.timeout) {
        result.augment_trace.push({
          field,
          source: 'none',
          status: 'failed',
          error: 'total_timeout_exceeded',
        });
        continue;
      }

      // 获取该字段的补全策略
      const strategy = this.registry.field_strategies?.[field];
      if (!strategy) {
        result.augment_trace.push({
          field,
          source: 'none',
          status: 'failed',
          error: 'no_strategy_defined',
        });
        continue;
      }

      // 尝试补全
      const augmentResult = this._augmentField(field, strategy, context);

      if (augmentResult.ok && augmentResult.value !== undefined) {
        result.data[field] = augmentResult.value;
        result.augmented_fields.push(field);
        result.augment_trace.push({
          field,
          source: augmentResult.source,
          status: 'success',
          timestamp: new Date().toISOString(),
        });
      } else {
        result.augment_trace.push({
          field,
          source: augmentResult.source || 'none',
          status: 'failed',
          augment_failed: true,
          error: augmentResult.error || 'augmentation_failed',
        });
      }
    }

    return result;
  }

  /**
   * 补全单个字段
   */
  _augmentField(field, strategy, context) {
    // 1. 先尝试内部来源
    if (strategy.internal) {
      const internalResult = this._fetchFromInternal(field, strategy.internal, context);
      if (internalResult.ok) {
        // 清洗数据
        const sanitized = this._sanitize(internalResult.value, strategy.sanitize);
        if (!this.containsUnsafeValue(sanitized)) {
          return { ok: true, value: sanitized, source: `internal:${strategy.internal.source}` };
        }
      }
    }

    // 2. 尝试兜底方案
    if (strategy.fallback) {
      const fallbackResult = this._fetchFromFallback(field, strategy.fallback, context);
      if (fallbackResult.ok) {
        // 清洗数据
        const sanitized = this._sanitize(fallbackResult.value, strategy.sanitize);
        if (!this.containsUnsafeValue(sanitized)) {
          return { ok: true, value: sanitized, source: `fallback:${strategy.fallback.type}` };
        }
      }
      return { ok: false, error: fallbackResult.error, source: `fallback:${strategy.fallback.type}` };
    }

    return { ok: false, error: 'no_data_source_available' };
  }

  /**
   * 从内部来源获取数据
   *
   * @returns {object} { ok: boolean, value?: any, reason?: string }
   */
  fetchFromInternal(field, config, context) {
    return this._fetchFromInternal(field, config, context);
  }

  _fetchFromInternal(field, config, context) {
    const source = config.source;

    // 根据来源类型分发
    switch (source) {
      case 'kb':
        return this._fetchFromKB(config.kb_name, field, context);
      case 'api':
        return this._fetchFromInternalAPI(config.service, field, context);
      default:
        return { ok: false, reason: 'not_implemented', error: `Unknown internal source: ${source}` };
    }
  }

  /**
   * 从知识库获取数据（暂未实现）
   */
  _fetchFromKB(kbName, field, context) {
    // TODO: 实现知识库查询
    return { ok: false, reason: 'not_implemented', error: 'Knowledge base not implemented' };
  }

  /**
   * 从内部 API 获取数据（暂未实现）
   */
  _fetchFromInternalAPI(service, field, context) {
    // TODO: 实现 JTD/地图/天气等内部 API 调用
    return { ok: false, reason: 'not_implemented', error: `Internal API ${service} not implemented` };
  }

  /**
   * 从兜底方案获取数据
   */
  _fetchFromFallback(field, config, context) {
    const type = config.type;

    switch (type) {
      case 'tavily_image_search':
        return this._tavilyImageSearch(field, config, context);
      case 'tavily_web_search':
      case 'tavily_web_content':
        return this._tavilyWebSearch(field, config, context);
      case 'map_poi':
        return this._mapPoiSearch(field, config, context);
      default:
        return { ok: false, error: `Unknown fallback type: ${type}` };
    }
  }

  /**
   * Tavily 图片搜索
   */
  async _tavilyImageSearch(field, config, context) {
    const query = this.buildSearchQuery(field, context);
    const maxResults = config.max_results || 3;

    try {
      const result = await this.tavilyEnricher.search(`${query} 图片`, {
        maxResults,
        searchDepth: 'basic',
      });

      if (result.ok && result.images && result.images.length > 0) {
        return { ok: true, value: result.images.slice(0, maxResults) };
      }

      return { ok: false, error: result.error || 'no_images_found' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /**
   * Tavily 网页搜索
   */
  async _tavilyWebSearch(field, config, context) {
    const query = this.buildSearchQuery(field, context);
    const maxChars = config.max_chars || 500;

    try {
      const result = await this.tavilyEnricher.search(query, {
        maxResults: 3,
        searchDepth: 'basic',
      });

      if (result.ok && result.answer) {
        const content = result.answer.substring(0, maxChars);
        return { ok: true, value: content };
      }

      if (result.ok && result.results && result.results.length > 0) {
        const content = (result.results[0].content || '').substring(0, maxChars);
        return { ok: true, value: content };
      }

      return { ok: false, error: result.error || 'no_content_found' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /**
   * 地图 POI 搜索
   */
  async _mapPoiSearch(field, config, context) {
    const keyword = context.keyword || context.destination || '';
    const lat = context.lat || context.latitude;
    const lng = context.lng || context.longitude;

    if (!keyword) {
      return { ok: false, error: 'no_keyword_provided' };
    }

    try {
      // 如果有坐标，用周边搜索
      if (lat && lng) {
        const pois = await this.mapAdapter.searchNearby(keyword, lat, lng, 5000);
        return { ok: true, value: pois };
      }

      // 否则用建议搜索
      const suggestions = await this.mapAdapter.suggestion(keyword, {
        region: context.city || context.region,
      });
      return { ok: true, value: suggestions };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /**
   * 构建搜索查询
   */
  buildSearchQuery(field, context) {
    const parts = [];

    // 根据字段类型添加关键词
    const fieldKeywords = {
      destination_images: '景点 图片',
      spot_introductions: '景点 介绍',
      poi_descriptions: 'POI 描述',
      weather_info: '天气',
    };

    // 添加上下文关键词
    if (context.destination) parts.push(context.destination);
    if (context.spot) parts.push(context.spot);
    if (context.city) parts.push(context.city);
    if (context.keyword) parts.push(context.keyword);

    // 添加字段特定关键词
    if (fieldKeywords[field]) {
      parts.push(fieldKeywords[field]);
    }

    return parts.filter(Boolean).join(' ');
  }

  /**
   * 数据清洗
   */
  _sanitize(value, sanitizeRules) {
    if (!value || !sanitizeRules || sanitizeRules.length === 0) {
      return value;
    }

    let result = value;

    for (const rule of sanitizeRules) {
      switch (rule) {
        case 'strip_script':
          result = this.stripScripts(result);
          break;
        case 'https_only':
          result = this.enforceHttps(result);
          break;
        case 'whitelist_domain':
          result = this._applyDomainWhitelist(result);
          break;
      }
    }

    return result;
  }

  /**
   * 清除脚本标签
   */
  stripScripts(value) {
    if (typeof value === 'string') {
      return value
        .replace(/<\s*\/?\s*script[^>]*>/gi, '')
        .replace(/on[a-z]+\s*=\s*["'][^"']*["']/gi, '')
        .replace(/javascript:/gi, '');
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.stripScripts(item));
    }

    if (typeof value === 'object' && value !== null) {
      const result = {};
      for (const [key, val] of Object.entries(value)) {
        result[key] = this.stripScripts(val);
      }
      return result;
    }

    return value;
  }

  /**
   * 强制 HTTPS
   */
  enforceHttps(value) {
    if (typeof value === 'string') {
      return value.replace(/http:\/\//g, 'https://');
    }

    if (Array.isArray(value)) {
      return value.map((item) => {
        if (typeof item === 'string') {
          return item.replace(/http:\/\//g, 'https://');
        }
        return item;
      });
    }

    return value;
  }

  /**
   * 应用域名白名单
   */
  _applyDomainWhitelist(value) {
    const whitelist = this.registry.domain_whitelist || [];

    if (!whitelist.length || typeof value !== 'string') {
      return value;
    }

    // 检查 URL 是否在白名单中
    try {
      const url = new URL(value);
      const isAllowed = whitelist.some(
        (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)
      );

      return isAllowed ? value : '';
    } catch {
      return value;
    }
  }

  /**
   * 安全值检查（复用 template-composition-selector 的方法）
   */
  containsUnsafeValue(value) {
    return containsUnsafeValue(value);
  }
}

export default DataAugmentor;
