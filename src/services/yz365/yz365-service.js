/**
 * 云诊365健康检测数据服务
 * 对接云诊365平台 checkDetail API
 */

import crypto from 'crypto';
import { BaseInterfaceService } from '../interface-base.js';

const DEFAULT_CONFIG = {
  baseUrl: process.env.YZ365_BASE_URL || 'http://171.111.198.212:9013',
  path: process.env.YZ365_PATH || '/stage-api/sd/yz365/checkDetail',
  method: 'POST',
  appKey: process.env.YZ365_APP_KEY || 'rnOU1BN1qEnK4rlh',
  appSecret: process.env.YZ365_APP_SECRET || 'uZBFfcdg8cKcv73uCfYtf9uM',
  timeoutSeconds: parseInt(process.env.YZ365_TIMEOUT_MS || '20000', 10) / 1000,
};

const WARNING_LEVEL_MAP = {
  '高风险': '紧急',
  '预警': '紧急',
  '中风险': '关注',
  '中度风险': '关注',
  '低风险': '一般',
  '轻度风险': '一般',
};

const WARNING_LEVEL_RANK = {
  '一般': 1,
  '关注': 2,
  '紧急': 3,
};

function sign(appKey, appSecret, timestamp, nonce, body) {
  const content = `${appKey}${timestamp}${nonce}${body}${appSecret}`;
  return crypto.createHmac('sha256', appSecret).update(content).digest('hex');
}

function mapWarningLevel(riskLevel, riskName) {
  for (const key of [riskLevel, riskName]) {
    if (key && WARNING_LEVEL_MAP[key]) {
      return WARNING_LEVEL_MAP[key];
    }
  }
  return '一般';
}

function overallWarningLevel(levels) {
  let best = '一般';
  let bestRank = 0;
  for (const lv of levels.length > 0 ? levels : ['一般']) {
    const r = WARNING_LEVEL_RANK[lv] || 0;
    if (r > bestRank) {
      bestRank = r;
      best = lv;
    }
  }
  return best;
}

function normalizeRecords(apiResult) {
  const resp = apiResult?.response || {};
  const data = resp.data;
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (typeof data === 'object') {
    for (const key of ['list', 'records', 'rows', 'result']) {
      if (Array.isArray(data[key])) return data[key];
    }
    // 单条详情
    if (data.personName || data.healthIndex || data.diseaseRiskDetails || data.checkTime) {
      return [data];
    }
  }
  return [];
}

function makeYz365RecordId(record = {}, index = 0) {
  return [
    'yz365',
    record.personPhone || record.memberPhone || record.idNumber || record.personName || 'unknown',
    record.checkTime || record.deviceCode || index,
  ].map((part) => String(part).replace(/\s+/g, '_')).join('_');
}

function analyzeCheckRecord(record) {
  const details = record.diseaseRiskDetails || [];
  const matched = [];
  const levels = [];

  for (const item of details) {
    if (typeof item !== 'object') continue;
    const level = mapWarningLevel(item.riskLevel, item.riskName);
    levels.push(level);
    matched.push({
      diseaseName: item.diseaseName,
      riskIndex: item.riskIndex,
      riskName: item.riskName,
      riskLevel: item.riskLevel,
      warningLevel: level,
      tip: item.tip,
    });
  }

  const warning = overallWarningLevel(levels);

  return {
    device_signal: {
      personName: record.personName,
      personAge: record.personAge,
      personSex: record.personSex,
      personPhone: record.personPhone,
      idNumber: record.idNumber,
      checkTime: record.checkTime,
      deviceCode: record.deviceCode,
      deviceName: record.deviceName,
      teamName: record.teamName,
      healthIndex: record.healthIndex,
      constitutionNames: record.constitutionNames,
      symptomName: record.symptomName,
      tongueFeature: record.tongueFeature,
      faceFeature: record.faceFeature,
      pdfUrl: record.pdfUrl,
      indicatorList: record.indicatorList || [],
    },
    risk_rule_match: {
      diseaseRisks: record.diseaseRisks,
      matchedRules: matched,
      meridianRiskS: record.meridianRiskS || [],
      mainPerformance: record.mainPerformance || [],
      occurrenceMechanism: record.occurrenceMechanism,
    },
    warning_level: {
      level: warning,
      levels: ['一般', '关注', '紧急'],
      healthIndex: record.healthIndex,
      summary: `综合预警等级：${warning}；健康指数：${record.healthIndex}`,
    },
  };
}

export class Yz365Service extends BaseInterfaceService {
  constructor(config = {}) {
    super({
      skillKey: 'health_risk_warning',
      provider: 'yunzhen365',
      sourcePath: '云诊365',
      config: { ...DEFAULT_CONFIG, ...config },
    });
  }

  async checkDetail(body = {}) {
    const { baseUrl, path, appKey, appSecret, timeoutSeconds } = this.config;
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID().replace(/-/g, '');
    const bodyText = Object.keys(body).length > 0 ? JSON.stringify(body) : '{}';
    const signature = sign(appKey, appSecret, timestamp, nonce, bodyText);

    const url = `${baseUrl}${path}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          'Accept': 'application/json',
          'appKey': appKey,
          'timestamp': timestamp,
          'nonce': nonce,
          'sign': signature,
        },
        body: bodyText,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();
      return {
        ok: response.ok,
        httpStatus: response.status,
        request: { url, body, timestamp, nonce },
        response: data,
      };
    } catch (error) {
      return {
        ok: false,
        httpStatus: null,
        request: { url, body },
        response: null,
        error: error.message,
      };
    }
  }

  async fetchRecords({ pageNum = 1, pageSize = 50 } = {}) {
    const result = await this.checkDetail({ pageNum, pageSize });
    const records = normalizeRecords(result);
    return records.map((record, index) => ({
      id: makeYz365RecordId(record, index),
      ...analyzeCheckRecord(record),
    }));
  }

  async syncAll({ pageSize = 50, maxPages = 20 } = {}) {
    const records = [];
    let total = null;
    let lastResult = null;

    for (let pageNum = 1; pageNum <= maxPages; pageNum += 1) {
      const result = await this.checkDetail({ pageNum, pageSize });
      lastResult = result;
      const pageRecords = normalizeRecords(result);
      const data = result?.response?.data || {};
      const parsedTotal = Number(data.total);
      if (Number.isFinite(parsedTotal)) total = parsedTotal;

      records.push(...pageRecords.map((record, index) => ({
        id: makeYz365RecordId(record, `${pageNum}_${index}`),
        ...analyzeCheckRecord(record),
      })));

      if (!result.ok || pageRecords.length === 0) break;
      if (total != null && records.length >= total) break;
      if (pageRecords.length < pageSize) break;
    }

    const captured = this.capture(records, { replace: true });
    return {
      provider: 'yunzhen365',
      ok: !!lastResult?.ok,
      httpStatus: lastResult?.httpStatus ?? null,
      code: lastResult?.response?.code ?? null,
      message: lastResult?.response?.msg ?? lastResult?.error ?? null,
      records,
      recordCount: records.length,
      apiTotal: total,
      captured,
    };
  }

  async getElderHealthCheck(elderName, idNumber = null) {
    if (!idNumber) {
      const synced = await this.syncAll({ pageSize: 50 });
      const analyzed = synced.records || [];
      const topLevels = analyzed.map(a => a.warning_level.level);

      return {
        source: 'yz365.checkDetail',
        ok: synced.ok,
        total: analyzed.length,
        overallWarningLevel: analyzed.length > 0 ? overallWarningLevel(topLevels) : null,
        records: analyzed,
        rawError: synced.ok ? null : synced.message,
      };
    }

    const result = await this.checkDetail({ idNumber });
    const records = normalizeRecords(result);
    const analyzed = records.map((record, index) => ({
      id: makeYz365RecordId(record, index),
      ...analyzeCheckRecord(record),
    }));
    const topLevels = analyzed.map(a => a.warning_level.level);

    this.capture(analyzed);

    return {
      source: 'yz365.checkDetail',
      ok: result.ok,
      total: records.length,
      overallWarningLevel: analyzed.length > 0 ? overallWarningLevel(topLevels) : null,
      records: analyzed,
      rawError: result.ok ? null : (result.error || result.response),
    };
  }

  buildHealthRiskData(apiResult, elderName) {
    const summary = this.buildWarningSummary(apiResult);

    if (!summary.ok || summary.total === 0) {
      return {
        hasData: false,
        elderName: elderName || '未知',
        message: '未获取到云诊体检报告数据',
        level: '一般',
        levelColor: '#68b032',
        levelIcon: '✓',
      };
    }

    const latestRecord = summary.records[0];
    const signal = latestRecord.device_signal;
    const warning = latestRecord.warning_level;
    const displayLevel = warning.level === '\u4e00\u822c' ? '\u5173\u6ce8' : warning.level;

    const levelColorMap = {
      '一般': '#68b032',
      '关注': '#e8a020',
      '紧急': '#e54d42',
    };
    const levelIconMap = {
      '一般': '✓',
      '关注': '⚠',
      '紧急': '⚡',
    };

    return {
      hasData: true,
      elderName: signal.personName || elderName || '未知',
      elderAge: signal.personAge,
      elderSex: signal.personSex,
      checkTime: signal.checkTime,
      healthIndex: signal.healthIndex,
      level: displayLevel,
      levelColor: levelColorMap[displayLevel] || '#e8a020',
      levelIcon: levelIconMap[warning.level] || '✓',
      matchedRules: latestRecord.risk_rule_match?.matchedRules || [],
      constitutionNames: signal.constitutionNames || [],
      symptomName: signal.symptomName,
      pdfUrl: signal.pdfUrl,
      summary: warning.summary,
    };
  }

  buildWarningSummary(apiResult) {
    if (Array.isArray(apiResult?.records) && apiResult.records[0]?.device_signal) {
      const analyzed = apiResult.records;
      const topLevels = analyzed.map(a => a.warning_level.level);
      return {
        source: 'yz365.checkDetail',
        ok: apiResult.ok,
        total: analyzed.length,
        overallWarningLevel: analyzed.length > 0 ? overallWarningLevel(topLevels) : null,
        records: analyzed,
        rawError: apiResult.ok ? null : apiResult.rawError,
      };
    }

    const records = normalizeRecords(apiResult);
    const analyzed = records.map(analyzeCheckRecord);
    const topLevels = analyzed.map(a => a.warning_level.level);

    return {
      source: 'yz365.checkDetail',
      ok: apiResult.ok,
      total: records.length,
      overallWarningLevel: analyzed.length > 0 ? overallWarningLevel(topLevels) : null,
      records: analyzed,
      rawError: apiResult.ok ? null : (apiResult.error || apiResult.response),
    };
  }
}

export function createYz365Service(config = {}) {
  return new Yz365Service(config);
}
