/**
 * 云诊舌诊数据服务
 * 对接云诊科技「舌诊/面诊检测报告」接口（gxy-shezhen-sdk），
 * 与云诊365（yz365）并列为健康风险预警的远程数据来源。
 *
 * 继承 BaseInterfaceService：取数后自动写入 health_risk_warning 技能本地知识库。
 */
import { BaseInterfaceService } from '../interface-base.js';

// 云诊舌诊 SDK（CommonJS，所在目录声明 type:commonjs）
import GxyShezhen from '../../third/shezhen/gxy-shezhen-sdk.js';

const DEFAULT_CONFIG = {
  secret: process.env.SHEZHEN_SECRET || 'sign_U9IAnIMAFv',
  apiUrl: process.env.SHEZHEN_API_URL || 'https://aiyl-m.yunxida.com/backend-api/portal-api',
  userId: process.env.SHEZHEN_USER_ID || 'user001',
  userIds: (process.env.SHEZHEN_USER_IDS || process.env.SHEZHEN_USER_ID || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean),
  timeout: 10000,
};

const WARNING_LEVEL_RANK = { '一般': 1, '关注': 2, '紧急': 3 };

function pickLevel(info = {}) {
  const raw = String(info.warningLevel || info.level || info.riskLevel || '');
  if (/高/.test(raw) && !/低/.test(raw)) return '紧急'; // 高风险 / 高
  if (/中|关注|预警|偏低|偏高/.test(raw)) return '关注';
  if (/低/.test(raw)) return '一般'; // 低风险
  if (typeof info.riskIndex === 'number') {
    if (info.riskIndex >= 60) return '紧急';
    if (info.riskIndex >= 30) return '关注';
    return '一般';
  }
  return '一般';
}

function toRiskItem(r) {
  if (typeof r === 'string') return { riskName: r, warningLevel: '关注' };
  const name = r.diseaseName || r.riskName || r.name || r.item || r.indicator || '健康风险';
  return { riskName: name, warningLevel: pickLevel(r), riskIndex: r.riskIndex };
}

/**
 * 将一份舌诊/面诊报告（真实 YunzhenCheckReport 字段，见 云诊/shezhen/README.md）
 * 归一化为本地知识库记录 + 卡片可用信号。
 */
function analyzeReport(record = {}) {
  const sexText = record.sex === 1 ? '男' : record.sex === 2 ? '女' : (record.elderSex || '未知');

  const signals = {
    reportId: record.id,
    userId: record.thirdId || record.userName,
    userName: record.name || record.userName,
    elderAge: record.age,
    elderSex: sexText,
    detectTime: record.checkTime,
    deviceName: record.deviceName,
    constitution: record.constitutionNames,
    symptomName: record.symptomName,
    healthIndex: record.healthIndex,
    tongueFeature: record.tongueFeature,
    faceFeature: record.faceFeature,
    tongueImageUrl: record.tongueImageUrl,
    faceImageUrl: record.faceImageUrl,
    pdfUrl: record.pdfUrl,
  };

  // 疾病风险：真实数据在 diseaseRisksJson（JSON 字符串），需二次解析
  let rawRisks = [];
  if (typeof record.diseaseRisksJson === 'string' && record.diseaseRisksJson.trim()) {
    try { rawRisks = JSON.parse(record.diseaseRisksJson); } catch (e) { rawRisks = []; }
  } else if (Array.isArray(record.risks)) {
    rawRisks = record.risks;
  } else if (Array.isArray(record.warnings)) {
    rawRisks = record.warnings;
  }
  const risks = rawRisks.map(toRiskItem);

  const level = risks.length
    ? risks.reduce((best, r) => (WARNING_LEVEL_RANK[r.warningLevel] > WARNING_LEVEL_RANK[best] ? r.warningLevel : best), '一般')
    : (record.warningLevel ? pickLevel(record) : '一般');

  return {
    id: record.id || `${record.thirdId || record.userName || 'u'}_${record.checkTime || Date.now()}`,
    source: 'yunzhen-shezhen',
    signals,
    risks,
    warning_level: { level, risks },
    pdfUrl: record.pdfUrl,
  };
}

export class ShezhenService extends BaseInterfaceService {
  constructor(config = {}) {
    super({
      skillKey: 'health_risk_warning',
      provider: 'yunzhen-shezhen',
      sourcePath: '云诊舌诊',
      config: { ...DEFAULT_CONFIG, ...config },
    });
    GxyShezhen.init({
      secret: this.config.secret,
      apiUrl: this.config.apiUrl,
      timeout: this.config.timeout,
    });
  }

  /** 基类要求：调用外部接口并归一化 */
  async fetchRecords({ userId, pageNo = 1, pageSize = 10 } = {}) {
    const uid = userId || this.config.userId;
    if (!uid) return [];
    const res = await GxyShezhen.getReports({ userId: uid, pageNo, pageSize });
    if (!res || !res.ok) return [];
    const data = res.data || {};
    const records = data.result?.records || data.records || [];
    if (!Array.isArray(records)) return [];
    return records.map(analyzeReport);
  }

  /** 业务包装：取最新一页报告，运行时使用 + 同时入库 */
  async syncAll({ userIds, pageSize = 50, maxPagesPerUser = 20 } = {}) {
    const ids = Array.from(new Set(
      (Array.isArray(userIds) && userIds.length ? userIds : this.config.userIds || [])
        .map((v) => String(v || '').trim())
        .filter(Boolean),
    ));

    if (ids.length === 0) {
      return {
        provider: 'yunzhen-shezhen',
        ok: false,
        recordCount: 0,
        apiTotal: 0,
        records: [],
        captured: { written: 0, total: 0 },
        warnings: ['shezhen_requires_user_ids'],
      };
    }

    const records = [];
    const warnings = [];
    let apiTotal = 0;
    let ok = true;

    for (const userId of ids) {
      for (let pageNo = 1; pageNo <= maxPagesPerUser; pageNo += 1) {
        try {
          const res = await GxyShezhen.getReports({ userId, pageNo, pageSize });
          ok = ok && !!res?.ok;
          const page = res?.data?.result || {};
          const pageRecords = Array.isArray(page.records) ? page.records : [];
          if (pageNo === 1) apiTotal += Number(page.total || 0);
          records.push(...pageRecords.map(analyzeReport));

          if (!res?.ok || pageRecords.length === 0) break;
          if (Number(page.pages) && pageNo >= Number(page.pages)) break;
          if (pageRecords.length < pageSize) break;
        } catch (error) {
          ok = false;
          warnings.push(`${userId}:${error.message}`);
          break;
        }
      }
    }

    const captured = this.capture(records, { replace: true });
    return {
      provider: 'yunzhen-shezhen',
      ok,
      recordCount: records.length,
      apiTotal,
      records,
      captured,
      userCount: ids.length,
      warnings,
    };
  }

  async getElderReports({ userId, pageNo = 1, pageSize = 10 } = {}) {
    if (!userId) {
      const synced = await this.syncAll({ pageSize });
      const records = synced.records || [];
      const topLevels = records.map((r) => r.warning_level.level).filter(Boolean);
      const level = topLevels.length ? topLevels[0] : null;
      return {
        source: 'yunzhen-shezhen',
        ok: records.length > 0,
        total: records.length,
        overallWarningLevel: level,
        records,
        sync: synced,
      };
    }
    const records = await this.fetchRecords({ userId, pageNo, pageSize });
    this.capture(records); // 全局约定：取数即入库
    const topLevels = records.map((r) => r.warning_level.level);
    const level = topLevels.length
      ? topLevels.reduce((best, l) => (WARNING_LEVEL_RANK[l] > WARNING_LEVEL_RANK[best] ? l : best), '一般')
      : null;
    return {
      source: 'yunzhen-shezhen',
      ok: records.length > 0,
      total: records.length,
      overallWarningLevel: level,
      records,
    };
  }

  /** 归一为健康风险卡片数据（与 yz365.buildHealthRiskData 同构） */
  buildHealthRiskData(apiResult, elderName) {
    if (!apiResult || apiResult.total === 0) {
      return { hasData: false, elderName: elderName || '未知', level: '一般' };
    }
    const latest = apiResult.records[0];
    const s = latest.signals || {};
    const level = apiResult.overallWarningLevel || '一般';
    const levelColorMap = { '一般': '#68b032', '关注': '#e8a020', '紧急': '#e54d42' };
    const levelIconMap = { '一般': '✓', '关注': '⚠', '紧急': '⚡' };
    return {
      hasData: true,
      elderName: s.userName || elderName || '未知',
      elderAge: s.elderAge || '未知',
      elderSex: s.elderSex || '未知',
      checkTime: s.detectTime,
      healthIndex: s.healthIndex,
      level,
      levelColor: levelColorMap[level] || '#68b032',
      levelIcon: levelIconMap[level] || '✓',
      matchedRules: latest.risks || [],
      constitutionNames: s.constitution ? [s.constitution] : [],
      summary: `综合预警等级：${level}（云诊舌诊）`,
    };
  }
}

export function createShezhenService(config = {}) {
  return new ShezhenService(config);
}
