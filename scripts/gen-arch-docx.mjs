// 生成 flatTalk 架构分析 docx
import fs from 'node:fs';
import path from 'node:path';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun,
  Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, ShadingType,
} from 'docx';

const MONO = 'Consolas';
const SANS = '微软雅黑';

// A4 纵向可用宽度（页宽 11906 - 左右边距 900*2）转 pt
const PAGE_W_PT = (11906 - 1800) / 20;   // ≈ 505pt
// A4 可用高度，留出图题空间
const PAGE_H_PT = (16838 - 2000) / 20 - 60;  // ≈ 682pt

const DIAG_DIR = 'd:\\GuiCare\\flatTalk\\docs\\diagrams';
const chartMeta = JSON.parse(fs.readFileSync(path.join(DIAG_DIR, 'meta.json'), 'utf8'));
const chartsByName = new Map(chartMeta.map((c) => [c.name, c]));

// ---- 构件工厂 ----
const H = (text, level) => new Paragraph({
  heading: level,
  spacing: { before: 240, after: 120 },
  children: [new TextRun({ text, font: SANS, bold: true })],
});

const P = (text, opts = {}) => new Paragraph({
  spacing: { after: 100 },
  alignment: opts.align,
  children: [new TextRun({ text, font: SANS, size: opts.size ?? 21, bold: opts.bold, italics: opts.italics, color: opts.color })],
});

// 代码 / ASCII 图块（保留空格与换行）
const CODE = (block) => block.split('\n').map((line) => new Paragraph({
  spacing: { after: 0, line: 240 },
  shading: { type: ShadingType.CLEAR, fill: 'F5F5F5' },
  children: [new TextRun({ text: line || ' ', font: MONO, size: 17 })],
}));

const cell = (text, opts = {}) => new TableCell({
  width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
  shading: opts.head ? { type: ShadingType.CLEAR, fill: 'E8E8E8' } : undefined,
  margins: { top: 60, bottom: 60, left: 90, right: 90 },
  children: String(text).split('\n').map((t) => new Paragraph({
    children: [new TextRun({ text: t, font: opts.mono ? MONO : SANS, size: opts.mono ? 17 : 19, bold: opts.head })],
  })),
});

const TBL = (header, rows, widths) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: {
    top: { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
    left: { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
    right: { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' },
    insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' },
  },
  rows: [
    new TableRow({
      tableHeader: true,
      children: header.map((h, i) => cell(h, { head: true, width: widths?.[i] })),
    }),
    ...rows.map((r) => new TableRow({
      children: r.map((c, i) => cell(c, { width: widths?.[i], mono: /^[\w./\\-]+$/.test(String(c)) && String(c).includes('.') })),
    })),
  ],
});

/**
 * 嵌入 mermaid 渲染图（等比缩放到页面可用区域内）
 */
function FIG(name) {
  const meta = chartsByName.get(name);
  if (!meta || !meta.ok) {
    return [P(`[图表缺失: ${name}]`, { color: 'C62828' })];
  }
  const buf = fs.readFileSync(meta.pngPath);
  const ratio = Math.min(PAGE_W_PT / meta.width, PAGE_H_PT / meta.height, 1);
  const w = Math.round(meta.width * ratio);
  const h = Math.round(meta.height * ratio);

  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 60 },
      children: [new ImageRun({ data: buf, type: 'png', transformation: { width: w, height: h } })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 220 },
      children: [new TextRun({ text: meta.title || '', font: SANS, size: 18, color: '666666' })],
    }),
  ];
}

// ============ 正文 ============
const body = [];
// 封面
body.push(new Paragraph({ spacing: { before: 1800 }, children: [] }));
body.push(P('flatTalk 架构分析报告', { size: 52, bold: true, align: AlignmentType.CENTER }));
body.push(P('后端 / 前端模块 · 主流程 · 协作 · 状态转换 · 调用关系', { size: 24, color: '666666', align: AlignmentType.CENTER }));
body.push(new Paragraph({ spacing: { before: 400 }, children: [] }));
body.push(P('分析范围：d:\\GuiCare\\flatTalk\\src', { size: 20, align: AlignmentType.CENTER, color: '888888' }));
body.push(P(`生成时间：${new Date().toLocaleString('zh-CN')}`, { size: 20, align: AlignmentType.CENTER, color: '888888' }));
body.push(new Paragraph({ pageBreakBefore: true, children: [] }));

// ---- 一、技术栈与总体分层 ----
body.push(H('一、技术栈与总体分层', HeadingLevel.HEADING_1));
body.push(P('本项目未使用任何 Web 框架，采用原生 http.createServer 配合手写 URL 路由表实现。全量 ESM 模块，运行于 Node.js。'));
body.push(P('分层结构：', { bold: true }));
body.push(...CODE(`┌─ 前端 (src/public/)   mobile.js / admin/ / card-bridge.js
│                            ↕ HTTP + postMessage
├─ 入口层   server.js (75)  →  app.js (1576, 手写路由表)
├─ 运行时   runtime/local-skill-runtime.js (76)
├─ 编排层   orchestrator/chat-orchestrator.js (1518, run() 单函数 650 行)
├─ 决策层   intent-classifier / scene-router / agents / semantic / lis
├─ 填充层   model-service.js (4749)              ← 巨型文件
├─ 组装层   interaction-composer.js (437)
├─ 渲染层   render/template-card-renderer.js (439) → template-card/ (6 文件)
├─ 技能层   skills/ (8 技能, manifest 驱动, ~130 个 HTML 模板)
└─ 服务层   services/ (20+ 子目录)  →  third/ (4 个 SDK)`));

body.push(P('核心文件规模：', { bold: true }));
body.push(TBL(
  ['文件', '行数', '职责'],
  [
    ['src/server.js', '75', '启动、监听、优雅关闭'],
    ['src/app.js', '1576', '手写 URL 路由表，全部 HTTP 入口'],
    ['src/runtime/local-skill-runtime.js', '76', '技能运行时包装'],
    ['src/core/orchestrator/chat-orchestrator.js', '1518', '编排流水线，run() 占 650 行'],
    ['src/core/model-service.js', '4749', '模板填充 + 意图判定 + 数据构造（职责混杂）'],
    ['src/core/interaction-composer.js', '437', 'actions 与 followups 组装去重'],
    ['src/core/render/template-card-renderer.js', '439', '卡片渲染与 iframe 隔离决策'],
    ['src/core/scene-router/scoring-engine.js', '178', '场景打分引擎'],
    ['src/core/scene-router/scene-transition-manager.js', '122', '场景转换决策'],
  ],
  [45, 12, 43],
));

// ---- 二、主流程图 ----
body.push(new Paragraph({ pageBreakBefore: true, children: [] }));
body.push(H('二、主流程图', HeadingLevel.HEADING_1));
body.push(P('从 HTTP 请求进入到卡片返回的完整链路。注意 run() 中存在 4 条短路分支，详见图 1-B。'));
body.push(...FIG('01-main-flow'));
body.push(...FIG('01b-shortcuts'));

body.push(P('主流程步骤明细：', { bold: true }));
body.push(TBL(
  ['序', '步骤', '位置', '说明'],
  [
    ['1', 'normalizeRequest', 'chat-orchestrator.js L819', '请求归一化'],
    ['2', 'loadIntentContext', 'chat-orchestrator.js L725', '调用 intent-classifier 得到粗粒度意图'],
    ['3', 'SOS 短路', 'chat-orchestrator.js L87-175', 'intent=SOS 或 P0 时硬编码技能与模板，跳过场景评分'],
    ['4', 'understandAndAdapt', 'chat-orchestrator.js L180-188', 'LLM 语义增强'],
    ['5', '轻量追问短路', 'chat-orchestrator.js L201-290', 'followup_source 与 skill_key 均存在时跳过路由与检索'],
    ['6', 'action_key 锁定短路', 'chat-orchestrator.js L311-331', '完全跳过 identifyScene，confidence 直接置 1'],
    ['7', 'identifyScene', 'chat-orchestrator.js L333-338', '8 个规则集并行打分后排序'],
    ['8', '消歧短路', 'chat-orchestrator.js L340-378', 'ambiguity_options 非空时直接返回选项卡'],
    ['9', 'resolveSkillTemplates', 'chat-orchestrator.js L381', '读取技能 manifest 得到候选模板'],
    ['10', 'retrieveMultiKnowledge', 'chat-orchestrator.js L400-411', 'RAG 知识检索'],
    ['11', 'loadBusinessData', 'chat-orchestrator.js L412-415', '按场景查业务表'],
    ['12', 'extractCities', 'chat-orchestrator.js L417-429', '仅 travel_route 场景做城市抽取'],
    ['13', 'fillTemplateSlots', 'model-service.js L90', '模板槽位填充'],
    ['14', 'composeInteractions', 'interaction-composer.js L285', '组装 actions 与 followups'],
    ['15', 'renderTemplateCardResult', 'template-card-renderer.js L24', '渲染 HTML 并决定是否 iframe 隔离'],
    ['16', 'buildEnvelope', 'contracts/envelope.js', '构造统一响应契约'],
  ],
  [5, 22, 30, 43],
));
body.push(P('关键事实：action_key 锁定短路会完全跳过场景识别，这导致点击卡片按钮的行为路径与用户直接输入文字的行为路径产生分叉。', { bold: true }));

// ---- 三、状态转换图 ----
body.push(new Paragraph({ pageBreakBefore: true, children: [] }));
body.push(H('三、场景识别状态转换图', HeadingLevel.HEADING_1));

body.push(H('3.1 打分公式', HeadingLevel.HEADING_2));
body.push(P('定义于 src/core/scene-router/scoring-engine.js  scoreRuleSet (L48-L92)：'));
body.push(...CODE(`confidence = clamp( (正向证据 + 角色加权 + 上下文加权 - 冲突惩罚) / threshold )

其中：
  正向证据    collectTermEvidence(input, ruleSet.evidence_groups)   命中组的 weight 累加
  角色加权    collectRoleBoost(input, ruleSet.role_boost)           角色命中白名单则加 weight
  上下文加权  collectContextBoost(input, ruleSet.context_boost)     previous_scene 匹配且命中延续词
  冲突惩罚    collectConflicts(input, ruleSet.conflicts)            命中冲突词则累加 penalty
  threshold   ruleSet.threshold ?? 1

特例 (L59-L61)：confidence >= 1 且冲突组含 acute_health_risk 时，强制降为 0.99`));

body.push(P('阈值常量 DEFAULT_THRESHOLDS (L1-L5)：', { bold: true }));
body.push(TBL(
  ['阈值', '数值', '含义'],
  [
    ['accept', '0.85', 'confidence >= 0.85 判为 accept'],
    ['review', '0.55', '0.55 <= confidence < 0.85 判为 review'],
    ['margin', '0.20', 'top 与 second 的 confidence 差需达此值才算 routed'],
  ],
  [20, 15, 65],
));
body.push(P('decide 函数 (L166-L170)：confidence >= accept → accept；>= review → review；否则 reject。'));
body.push(P('routed 判定 (index.js L90)：top.decision === accept 且 margin >= 0.2。'));

body.push(H('3.2 状态转换决策树', HeadingLevel.HEADING_2));
body.push(P('定义于 src/core/scene-router/scene-transition-manager.js  decideTransition (L77-L122)。判定按 case E → A → B → C → D 顺序短路：'));
body.push(...FIG('02-scene-transition'));

body.push(P('四种转换类型 TRANSITION_TYPE (L13-L18)：', { bold: true }));
body.push(TBL(
  ['类型', '值', '触发条件', '后续行为'],
  [
    ['ROUTE', 'route', 'top accept 且 routed；或 top 为 review；或默认', '直接路由到 top 场景'],
    ['AMBIGUOUS', 'ambiguous', '双 accept 且 margin 不足且 score 差小于 1', '返回消歧选项卡，取前 3 个 confidence>0.3 的候选'],
    ['FALLBACK', 'fallback', 'top decision 为 reject；或候选列表为空', '走 answer 兜底'],
    ['CONTINUE', 'continue', '存在 previous_scene 且命中延续词且旧场景非 reject', '延续旧场景'],
  ],
  [14, 12, 40, 34],
));

body.push(P('延续词列表 CONTINUATION_TERMS (L21-L25)：', { bold: true }));
body.push(...CODE(`继续、换一个、再来、下一个、上一个、再看看、还有呢、
其他的、换一种、再来一个、换个、再看、别的`));

body.push(P('场景优先级 SCENE_PRIORITY (L28-L37)，confidence 与 score 均相同时的裁决顺序：', { bold: true }));
body.push(...CODE(`health_risk_warning  >  service_quality_eval  >  find_service
   >  dispatch_manage  >  nearby_resource  >  meal_plan
   >  travel_route     >  common`));

body.push(P('硬编码旁路补丁（需注意）：', { bold: true }));
body.push(P('src/core/scene-router/index.js L52-L70 存在一处绕过打分体系的特例。当 isJialuNearbyOnlyUtterance 判定为「嘉路机构裸问」时，强制将 nearby_resource 的 score 抬到 12、confidence 置 1、decision 置 accept，同时将 travel_route 的 score 压到 1、confidence 压到 0.3、decision 置 reject。并在 L84 通过 forceRouted 绕过 margin 检查。'));

// ---- 四、意图识别四套机制 ----
body.push(new Paragraph({ pageBreakBefore: true, children: [] }));
body.push(H('四、意图识别：四套并存机制', HeadingLevel.HEADING_1));
body.push(P('项目中存在 4 套彼此独立、互不复用的意图判断机制，在同一次请求中会依次执行。'));
body.push(TBL(
  ['机制', '位置', '粒度', '输出形态'],
  [
    ['A  intent-classifier', 'src/core/intent-classifier/index.js', '粗（5 类）', 'SOS / HEALTH / SERVICE / CHAT / AMBIGUOUS'],
    ['B  ruleSet.infer_intent', 'src/core/scene-router/rules/*.js', '细', 'travel_route_budget 等细粒度意图串'],
    ['C  agents.matchScore', 'src/core/agents/supervisor.js L38', 'Agent 级', 'skill_key'],
    ['D  isXxxText 系列', 'src/core/model-service.js', '模板级', '布尔判定'],
  ],
  [20, 32, 13, 35],
));

body.push(H('4.1 机制 A：intent-classifier', HeadingLevel.HEADING_2));
body.push(P('降级链：规则 → BERT → TextCNN → 规则兜底，由 classifyWithModelLayers 控制。'));
body.push(P('但 model-client.js 在未配置模型端点时返回 null，因此生产环境实际执行的是纯关键词计数分支 classifyByRules → scoreByRules → countHits。'));
body.push(P('打分公式：', { bold: true }));
body.push(...CODE(`confidence = Math.min(0.95, 0.62 + hits * 0.08)

词表硬编码在文件顶部：
  HEALTH_WORDS   L7-L10
  SERVICE_WORDS  L12-L22   （含大量 \\uXXXX 转义中文，可读性差）
  CHAT_WORDS     L24`));
body.push(P('配套文件：emergency-detector.js（LEVEL_1/LEVEL_2 关键词 + detectEmergency）、entity-extractor.js（正则抽 5 个槽位）、thresholds.js、tone-analysis.js、schema.js（INTENT_TYPES 仅 5 种）。'));

body.push(H('4.2 机制 B：ruleSet.infer_intent', HeadingLevel.HEADING_2));
body.push(P('每个规则文件自带 infer_intent 函数。以 travel-route.js L111-L125 为例，是 13 条 if (has(input, [...])) return "..." 的顺序短路，先命中先返回，无打分机制。'));
body.push(P('调用点在 scoring-engine.js L64-L68：优先使用请求携带的 intent（如 followup 按钮传入），否则才调用 infer_intent，最后回落到 ruleSet.default_intent。'));

body.push(H('4.3 机制 C：agents supervisor', HeadingLevel.HEADING_2));
body.push(P('src/core/agents/supervisor.js  route() (L38) 为 5 步顺序决策：'));
body.push(TBL(
  ['步', '位置', '判定', '结果'],
  [
    ['1', 'L42', 'detectEmergency 命中', '走 SOS'],
    ['2', 'L48', 'action_key 前缀匹配', '锁定对应 agent'],
    ['3', 'L59', 'active_agent 粘性保持，并由 bestOtherAgent (L24) 做对抗性再判定', '保持或切换'],
    ['4', 'L82', 'keyword match 且 bestScore >= 0.3', '选中最高分 agent'],
    ['5', 'L97', '以上均未命中', 'fallback 到 common'],
  ],
  [6, 10, 52, 32],
));
body.push(P('base-agent.js 中 canHandle (L47) 于 L65 处含硬编码续写判定正则：/换|调整|改成|继续|再|这个|不要|加|减|更多|软烂|清淡/。8 个 agent 各自维护独立词表，travel-route-agent.js 最大（172 行）。'));

body.push(H('4.4 机制 D：model-service 内的 isXxxText', HeadingLevel.HEADING_2));
body.push(P('model-service.js 内部又实现了一遍同类关键词判定，包括 isMealPlanText (L334)、isTravelRouteText (L1199)、isNearbyResourceText (L1203)、isFindServiceText (L1849)、isDispatchManageText (L1853)、isHealthRiskText (L356)、isPolicyText (L352) 等。'));

body.push(P('重复定义问题：', { bold: true }));
body.push(P('以 travel_route 为例，其关键词表至少在 4 处独立定义：intent-classifier/index.js L16-L21、scene-router/rules/travel-route.js L3-L21、agents/agents/travel-route-agent.js、model-service.js L1199。修改任一处均不会影响其余三处，这是「改一处不生效」类缺陷的根源。'));

// ---- 五、交互组装 ----
body.push(new Paragraph({ pageBreakBefore: true, children: [] }));
body.push(H('五、交互组装：actions 与 followups 的竞争关系', HeadingLevel.HEADING_1));
body.push(P('composeInteractions 定义于 src/core/interaction-composer.js L285-L349。其设计原则写在 L311 注释中：'));
body.push(P('「聊天侧以追问（followup_suggestions）为主；actions 仅保留追问未覆盖的操作键」', { italics: true, bold: true }));

body.push(P('前置门槛 (L286)：sceneDecision.decision !== accept 时直接返回空数组。因此 review 级别的场景不会产生任何按钮。', { bold: true }));

body.push(H('5.1 组装流水线', HeadingLevel.HEADING_2));
body.push(...FIG('03-interaction-composer'));

body.push(P('方向说明：L338-L340 是 actions 被 followups 过滤，而非反向。语义重复的按钮只会保留在 followups 一侧。', { bold: true }));

body.push(H('5.2 意图归一化去重', HeadingLevel.HEADING_2));
body.push(P('followupIntentKey (L369-L401) 用一组正则把同义文案收敛成同一意图键，实现跨来源去重。若已有 action_key 则直接使用（转小写）。部分规则如下：'));
body.push(TBL(
  ['匹配正则', '归一化意图键'],
  [
    ['/天气|潮汐/', 'travel_route.check_weather_risk'],
    ['/可订|预订|预定/', 'travel_route.check_availability'],
    ['/预算/', 'travel_route.calculate_budget'],
    ['/对比|比较/ 且 /(目的地|路线|基地)/', 'travel_route.compare_destinations'],
    ['/重新规划|换.*(路线|目的地)/', 'travel_route.replan'],
    ['/智能推荐|推荐服务/', 'find_service.recommend'],
    ['/全部服务|服务目录/', 'find_service.catalog'],
    ['/护工|护理人员|上门护理/', 'find_service.list_workers'],
    ['/养老机构|服务机构|看机构|入住机构|养老院/', 'find_service.list_orgs'],
    ['/全部.*(资源|配套)|全部配套/', 'nearby_resource.all'],
    ['/只看医疗|医疗资源/', 'nearby_resource.medical'],
    ['/餐馆|吃饭|餐饮/', 'nearby_resource.food'],
    ['/游玩|景点|好玩/', 'nearby_resource.leisure'],
    ['/重新读取|刷新信号/', 'health_risk_warning.refresh_signals'],
    ['/规则命中/', 'health_risk_warning.view_rule_detail'],
    ['/人工复核|转人工/', 'health_risk_warning.request_manual_review'],
    ['/调理方案/', 'health_risk_warning.view_advice'],
    ['/一周计划|一周食谱/', 'meal_plan.generate_weekly_plan'],
    ['/慢病调整|按慢病/', 'meal_plan.adjust_for_condition'],
    ['/派单列表/', 'dispatch_manage.list'],
    ['/查看工单|服务工单/', 'dispatch_manage.work_order'],
    ['/查看进度|派单进度/', 'dispatch_manage.status'],
  ],
  [48, 52],
));
body.push(P('白名单通配：isActionAllowed (L403-L413) 与 isFollowupAllowed (L415-L423) 均支持 scene_key.* 形式的通配授权。'));

// ---- 六、模块调用图 ----
body.push(new Paragraph({ pageBreakBefore: true, children: [] }));
body.push(H('六、模块与函数调用图（含第三方）', HeadingLevel.HEADING_1));
body.push(...FIG('04-module-graph'));
body.push(P('下表为分层调用明细，含具体文件与外部系统对应关系：', { bold: true }));
body.push(...CODE(`【入口】
  server.js ──► app.js ──┬──► runtime/local-skill-runtime ──► chat-orchestrator
                         ├──► server/sse-chat.js          (SSE 流式)
                         ├──► admin/index.js              (后台管理)
                         └──► public/                     (静态资源)

【决策层】  chat-orchestrator 调用
  ├─► intent-classifier            粗粒度意图
  ├─► semantic/understand          LLM 语义增强
  ├─► scene-router ──┬─► scoring-engine            打分
  │                  ├─► scene-transition-manager  转换决策
  │                  ├─► ambiguity-resolver        消歧
  │                  ├─► intent-template-map       意图到模板映射
  │                  ├─► publish-index             已发布产品包匹配
  │                  ├─► decision-log              决策日志
  │                  └─► rules/ × 8                规则集
  ├─► lis/routing-gate             LIS 门控
  └─► agents/supervisor            Agent 路由

【数据层】
  ├─► rag-service ──┬─► knowledge-data/vector-store
  │                 ├─► knowledge-data/chunk-store
  │                 ├─► knowledge-data/document-store
  │                 ├─► knowledge-data/retriever
  │                 └─► flyai/*                    FlyAI 知识库
  ├─► table-data ──┬─► repository.js               内存实现
  │                └─► repository-pg.js  ──► PostgreSQL
  ├─► cache/redis-state-store       ──► Redis
  ├─► write-queue                   写队列
  └─► city-extractor                城市抽取

【生成层】
  model-service.js (4749) ──► model-runtime/
        ├─► model-registry              模型注册
        ├─► openai-compatible-client    OpenAI 兼容协议
        ├─► volcengine-signer           火山引擎签名
        ├─► prompt-loader   ──► prompts/*.md
        ├─► template-card-llm-service
        └─► extra-template-fills

【输出层】
  ├─► interaction-composer            actions / followups 组装
  ├─► compact-followups/renderer      紧凑追问渲染
  ├─► render/template-card-renderer ──┬─► template-card/discover  模板发现
  │                                    ├─► template-card/select    模板选择
  │                                    └─► template-card/render    模板渲染
  ├─► render/bridge-injector          注入卡片桥接脚本
  └─► actions/action-dispatcher        action_key 分发
        └─► action-resource-map.json

【外部服务与第三方】
  ├─► services/map/tencent-map-adapter    ──► 腾讯地图 API
  │      ├─ tencent-key-pool                  多 key 轮换
  │      └─ static-map-cache                  静态图缓存
  ├─► services/weather/tencent-weather    ──► 腾讯天气
  ├─► services/nearby-resource/tavily-*   ──► Tavily 全网搜索
  ├─► services/yz365/*                    ──► 云诊 365
  ├─► services/shezhen/*                  ──► 舌诊服务
  ├─► services/travel/jtd-client           ──► 金条洞旅游
  ├─► services/remote-health/*             ──► 远程健康
  ├─► services/order/order-service         ──► 订单
  ├─► services/workorder/workorder-service ──► 工单
  └─► services/interface-data/ ──┬─ tag-system-adapter  ──► tag-system
                                  ├─ tag-system-biz
                                  ├─ pg-tag-reader      ──► PostgreSQL
                                  └─ http-client

【第三方 SDK】 src/third/
  ├─ gxy-order-sdk.js      ──┐
  ├─ gxy-workorder-sdk.js  ──┤
  ├─ gxy-shezhen-sdk.js    ──┼──► lib/hmac-signature.js  (HMAC 签名)
  └─ gxy-message-sdk.js    ──┘

【技能层】 skills/ × 8  ──► 由 template-card/discover 扫描 manifest.json 加载`));

// ---- 七、前后端协作图 ----
body.push(new Paragraph({ pageBreakBefore: true, children: [] }));
body.push(H('七、前后端协作图', HeadingLevel.HEADING_1));
body.push(...FIG('05-frontend-backend'));

body.push(P('响应契约核心字段（src/contracts/envelope.js）：', { bold: true }));
body.push(TBL(
  ['字段', '用途'],
  [
    ['answer', '文本答复'],
    ['template_id', '选中的模板标识'],
    ['skill_key', '选中的技能标识'],
    ['html', '完整 HTML，供 iframe 隔离渲染'],
    ['html_fallback', '降级 HTML，供直接内联'],
    ['has_html', '决定前端走 iframe 还是内联路径'],
    ['actions[]', '卡片内操作按钮'],
    ['followup_suggestions[]', '底部追问按钮'],
    ['compact_followups[]', '紧凑型追问'],
    ['trace', '决策链路追踪信息'],
  ],
  [26, 74],
));
body.push(P('注意：html 与 html_fallback 并存属历史遗留，has_html 是前端分支的唯一依据。三字段协议语义模糊，前端易只识别其中一个而导致卡片不显示。'));

// ---- 八、技能插件体系 ----
body.push(new Paragraph({ pageBreakBefore: true, children: [] }));
body.push(H('八、技能插件体系', HeadingLevel.HEADING_1));
body.push(P('共 8 个技能，manifest 驱动，累计约 130 个 HTML 模板。'));
body.push(TBL(
  ['技能', '模板数', '特色'],
  [
    ['travel_route', '15', '最复杂。含 9 个 knowledge JSON、local-knowledge-service.js、dashboard-spot-kb.js'],
    ['find_service', '17', '含订单与派单全流程模板'],
    ['health_risk_warning', '15', '含舌诊、面诊、中医辨证类卡片'],
    ['nearby_resource', '12', '含 4 种地图卡（overview / category / route / radar）'],
    ['dispatch_manage', '8', '派单接单、转派、供应商动作'],
    ['service_quality_eval', '7', '机构与人员质量排名、投诉、整改建议'],
    ['meal_plan', '5', '含 followups 静态配置与 sample 数据'],
    ['common', '5', '政策类模板 + fallback_error + answer'],
  ],
  [22, 10, 68],
));
body.push(P('每个技能的标准结构：', { bold: true }));
body.push(...CODE(`skills/<skill_key>/
  ├─ manifest.json                    技能级清单，声明模板列表
  ├─ index.js                         技能入口
  ├─ knowledge/                       本地知识与接口缓存（可选）
  └─ templates/
       ├─ html/
       │    ├─ <template>.html            模板本体
       │    ├─ <template>.manifest.json   模板级清单，声明 slots
       │    ├─ _design_tokens.css          设计令牌
       │    └─ _card_components.css        公共组件样式
       ├─ followups/<template>.json    静态追问配置
       ├─ data/<template>.sample.json  样例数据
       └─ preview/<template>.preview.html  预览页`));

// ---- 九、诊断结论 ----
body.push(new Paragraph({ pageBreakBefore: true, children: [] }));
body.push(H('九、诊断结论', HeadingLevel.HEADING_1));
body.push(TBL(
  ['问题', '证据位置', '影响'],
  [
    ['意图判定四重复制', 'intent-classifier / scene-router rules / agents / model-service 各一套', 'travel_route 词表在 4 处重复，改一处不生效'],
    ['巨型文件', 'model-service.js 4749 行', '同时承担意图判定、场景选择、模板填充、数据构造四种职责；约 150 个私有函数仅导出 4 个'],
    ['单函数过长', 'chat-orchestrator.js run() L70-L720', '650 行含 4 条短路，控制流难以追踪'],
    ['旁路补丁', 'scene-router/index.js L52-L70', '硬编码「嘉路」特例绕过打分体系与 margin 检查'],
    ['短路跳过决策', 'chat-orchestrator.js L311-L331', 'action_key 锁定完全跳过 identifyScene，按钮路径与文本路径行为分叉'],
    ['双 HTML 字段', 'envelope 的 html / html_fallback / has_html', '三字段协议语义模糊，前端易只认其一导致卡片不渲染'],
    ['review 无按钮', 'interaction-composer.js L286', 'decision 非 accept 时 actions 与 followups 均为空数组'],
  ],
  [18, 34, 48],
));

// ---- 附录 ----
body.push(new Paragraph({ pageBreakBefore: true, children: [] }));
body.push(H('附录：图表源文件', HeadingLevel.HEADING_1));
body.push(P('本文档全部图表由 Mermaid 渲染生成，渲染引擎与 mermaid.live 一致（mermaid 11.x + Chromium）。'));
body.push(P('图表源码位于 scripts/arch-charts.mjs，可直接复制到 https://mermaid.live/ 编辑与重新导出。'));
body.push(P('渲染产物（SVG 矢量 + PNG 位图）位于 docs/diagrams/ 目录：', { bold: true }));
body.push(TBL(
  ['图表', '文件名', '尺寸(px)'],
  chartMeta.filter((c) => c.ok).map((c) => [
    c.title || c.name,
    `${c.name}.svg / .png`,
    `${c.width} × ${c.height}`,
  ]),
  [46, 34, 20],
));
body.push(P('重新生成命令：', { bold: true }));
body.push(...CODE(`node scripts/render-charts.mjs     # 渲染图表 → docs/diagrams/
node scripts/gen-arch-docx.mjs     # 生成 docx（读取 diagrams/meta.json）`));

// ============ 打包 ============
const doc = new Document({
  creator: 'flatTalk 架构分析',
  title: 'flatTalk 架构分析报告',
  styles: {
    default: {
      document: { run: { font: SANS, size: 21 } },
      heading1: { run: { font: SANS, size: 32, bold: true, color: '1A5490' } },
      heading2: { run: { font: SANS, size: 26, bold: true, color: '2E7D32' } },
    },
  },
  sections: [{
    properties: { page: { margin: { top: 1000, right: 900, bottom: 1000, left: 900 } } },
    children: body,
  }],
});

const OUT = 'd:\\GuiCare\\flatTalk\\docs\\flatTalk-架构分析报告.docx';
fs.mkdirSync('d:\\GuiCare\\flatTalk\\docs', { recursive: true });
const buf = await Packer.toBuffer(doc);
fs.writeFileSync(OUT, buf);
console.log('已生成:', OUT);
console.log('大小:', (buf.length / 1024).toFixed(1), 'KB');
console.log('段落/表格数:', body.length);
