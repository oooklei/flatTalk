/** flatTalk 架构图表的 Mermaid 定义 */

export const CHARTS = [
  // ── 图1 主流程（主干） ──
  {
    name: '01-main-flow',
    title: '图 1  主流程图：请求到卡片返回（主干链路）',
    scale: 2.4,
    code: `flowchart TD
    subgraph L1["① 入口"]
        direction LR
        A["POST<br/>/api/chat/message"] --> B["app.js<br/>handleChat L793"] --> C["local-skill-runtime<br/>runLocalSkill"]
    end

    L1 --> D["chat-orchestrator.run  L70"]

    subgraph L2["② 请求归一与意图"]
        direction LR
        E["normalizeRequest<br/>L819"] --> F["loadIntentContext L725<br/>intent-classifier"] --> G["understandAndAdapt L180<br/>semantic LLM"]
    end

    D --> L2

    subgraph L3["③ 场景决策"]
        direction LR
        H["identifyScene L333<br/>8 规则集并行打分"] --> I["decideTransition<br/>ROUTE/AMBIGUOUS<br/>FALLBACK/CONTINUE"]
    end

    L2 --> L3

    subgraph L4["④ 资源装配"]
        direction LR
        J["resolveSkillTemplates<br/>L381 读 manifest"] --> K["retrieveMultiKnowledge<br/>L400 RAG"] --> L["loadBusinessData<br/>L412 查业务表"] --> M["extractCities L417<br/>仅 travel_route"]
    end

    L3 --> L4

    subgraph L5["⑤ 生成与渲染"]
        direction LR
        N["fillTemplateSlots<br/>model-service.js L90"] --> O["composeInteractions<br/>L285"] --> P["renderTemplateCardResult<br/>L24"] --> Q["buildEnvelope"]
    end

    L4 --> L5
    L5 --> R["HTTP JSON 响应"]

    SC(["4 条短路分支<br/>详见图 1-B"]) -.->|"跳过 ③④"| N

    style A fill:#BBDEFB,stroke:#1565C0
    style N fill:#FFF9C4,stroke:#F9A825
    style R fill:#C8E6C9,stroke:#2E7D32
    style SC fill:#FFCDD2,stroke:#C62828`,
  },

  // ── 图1-B 短路分支 ──
  {
    name: '01b-shortcuts',
    title: '图 1-B  run() 中的 4 条短路分支',
    scale: 2.5,
    code: `flowchart TD
    START["loadIntentContext 完成"] --> S1{"短路①<br/>intent=SOS<br/>或 urgency=P0?"}

    S1 -->|是| Z1["硬编码<br/>skill_key=find_service<br/>template=service_emergency<br/><br/>跳过：场景评分、知识检索"]
    S1 -->|否| SEM["understandAndAdapt<br/>L180"]

    SEM --> S2{"短路②<br/>followup_source<br/>且 skill_key<br/>均存在?"}
    S2 -->|是| Z2["沿用上轮技能<br/><br/>跳过：场景路由、知识检索"]
    S2 -->|否| S3{"短路③<br/>action_key<br/>已锁定?"}

    S3 -->|是| Z3["confidence=1<br/>source=action_key_lock<br/><br/>跳过：identifyScene 全部打分"]
    S3 -->|否| SCENE["identifyScene L333<br/>正常打分"]

    SCENE --> S4{"短路④<br/>ambiguity_options<br/>非空?"}
    S4 -->|是| Z4["返回消歧选项卡<br/><br/>跳过：模板填充、渲染"]
    S4 -->|否| NORMAL["进入正常主流程<br/>L381 之后"]

    Z1 --> FILL["fillTemplateSlots"]
    Z2 --> FILL
    Z3 --> FILL
    NORMAL --> FILL
    Z4 --> ENV["buildEnvelope"]
    FILL --> ENV

    style S1 fill:#FFE0B2,stroke:#E65100
    style S2 fill:#FFE0B2,stroke:#E65100
    style S3 fill:#FFCDD2,stroke:#C62828
    style S4 fill:#FFE0B2,stroke:#E65100
    style Z3 fill:#FFCDD2,stroke:#C62828
    style NORMAL fill:#C8E6C9,stroke:#2E7D32`,
  },

  // ── 图2 场景状态转换 ──
  {
    name: '02-scene-transition',
    title: '图 2  场景识别状态转换图',
    scale: 2.5,
    code: `flowchart TD
    A["8 个 ruleSet 并行打分<br/>scoreRuleSet L48"] --> B["confidence = clamp<br/>(正向+角色+上下文-冲突) / threshold"]
    B --> C["stableSortCandidates L57<br/>confidence↓ → score↓ → SCENE_PRIORITY"]

    C --> D{"decide L166<br/>判定 top"}
    D -->|"conf >= 0.85"| ACC["accept"]
    D -->|"0.55 =< conf < 0.85"| REV["review"]
    D -->|"conf < 0.55"| REJ["reject"]

    ACC --> M{"margin >= 0.2 ?"}
    M -->|是| ROUTED["routed = true"]
    M -->|否| COMPETE["routed = false<br/>存在竞争"]

    ROUTED --> T
    COMPETE --> T
    REV --> T
    REJ --> T

    T{"decideTransition L77<br/>按 E→A→B→C→D 顺序短路"}

    T -->|"case E L88<br/>命中延续词<br/>且旧场景非 reject"| CONT["CONTINUE<br/>延续旧场景"]
    T -->|"case A L96<br/>top.accept 且 routed"| RT1["ROUTE<br/>路由到 top"]
    T -->|"case B L101<br/>双 accept 且<br/>score 差 < 1"| AMB["AMBIGUOUS<br/>取前 3 且 conf>0.3<br/>返回消歧卡"]
    T -->|"case C L111<br/>top = review"| RT2["ROUTE<br/>保守直路由"]
    T -->|"case D L116<br/>top = reject"| FB["FALLBACK<br/>走 answer 兜底"]
    T -->|"默认 L121"| RT3["ROUTE"]

    style ACC fill:#C8E6C9,stroke:#2E7D32
    style REV fill:#FFF9C4,stroke:#F9A825
    style REJ fill:#FFCDD2,stroke:#C62828
    style T fill:#E1BEE7,stroke:#6A1B9A
    style AMB fill:#FFE0B2,stroke:#E65100
    style FB fill:#FFCDD2,stroke:#C62828`,
  },

  // ── 图3 交互组装 ──
  {
    name: '03-interaction-composer',
    title: '图 3  交互组装：actions 与 followups 竞争关系',
    scale: 2.4,
    code: `flowchart LR
    subgraph FU["followups 优先处理 L312-L322"]
        direction TB
        F1["staticFollowups"] --> FM["合并"]
        F2["modelFollowups"] --> FM
        F3["defaultFollowups<br/>按 followup_policy"] --> FM
        FM --> FA["isFollowupAllowed L314<br/>白名单 支持 xxx.*"]
        FA --> FU2["uniqueFollowup L315<br/>意图键去重"]
        FU2 --> FS["排序 CATEGORY_RANK L317"]
        FS --> FC["filterByScene L318"]
        FC --> FCAP["dedupe + slice<br/>FOLLOWUP_CAP L320"]
    end

    subgraph AC["actions 后置处理 L334-L342"]
        direction TB
        A1["modelActions"] --> AM["合并"]
        A2["defaultActions"] --> AM
        AM --> AA["isActionAllowed L336"]
        AA --> AU["uniqueAction L337"]
        AU --> AF1["排除 followupKeys<br/>L338"]
        AF1 --> AF2["排除 followupIntents<br/>L339"]
        AF2 --> AF3["排除 compactPrompts<br/>L340"]
        AF3 --> ACAP["slice 0,4 L341"]
    end

    FCAP ==>|"提供三个排除集"| AF1
    FCAP --> OUT1["followup_suggestions"]
    ACAP --> OUT2["actions"]

    GATE{"L286<br/>decision = accept?"} -->|否| EMPTY["两者均返回空数组"]
    GATE -->|是| FU

    style AF1 fill:#FFCDD2,stroke:#C62828
    style AF2 fill:#FFCDD2,stroke:#C62828
    style AF3 fill:#FFCDD2,stroke:#C62828
    style GATE fill:#FFE0B2,stroke:#E65100
    style OUT1 fill:#C8E6C9,stroke:#2E7D32
    style OUT2 fill:#C8E6C9,stroke:#2E7D32`,
  },

  // ── 图4 模块调用 ──
  {
    name: '04-module-graph',
    title: '图 4  模块与函数调用图（含第三方）',
    scale: 2.2,
    code: `flowchart TB
    subgraph EN["入口层"]
        direction LR
        SV["server.js"] --> APP["app.js<br/>1576 行"]
        APP --> SSE["sse-chat.js"]
        APP --> ADM["admin/index.js"]
        APP --> STATIC["public/"]
    end

    APP --> RT["local-skill-runtime"]
    RT --> ORC["chat-orchestrator<br/>1518 行"]

    subgraph DEC["决策层"]
        direction LR
        IC["intent-classifier"]
        SEM["semantic/understand"]
        SUP["agents/supervisor"]
        subgraph SRG["scene-router"]
            direction TB
            SE["scoring-engine"]
            STM["scene-transition-manager"]
            AMB["ambiguity-resolver"]
            R8["rules/ × 8"]
        end
        LIS["lis/routing-gate"]
    end

    ORC --> DEC

    subgraph DAT["数据层"]
        direction LR
        RAG["rag-service"] --> KD["knowledge-data<br/>vector/chunk/document"]
        TD["table-data"]
        RED[("Redis")]
    end

    subgraph GEN["生成层"]
        direction LR
        MS["model-service.js<br/>4749 行"] --> MR["model-runtime"]
        MR --> OAI["openai-compatible"]
        MR --> VE["volcengine-signer"]
        MR --> PL["prompt-loader"]
    end

    subgraph OUTL["输出层"]
        direction LR
        ITC["interaction-composer"]
        TCR["template-card-renderer"] --> TC["template-card<br/>discover/select/render"]
        TCR --> BI["bridge-injector"]
        TC --> SK["skills/ × 8"]
    end

    ORC --> DAT
    ORC --> GEN
    ORC --> OUTL

    subgraph EXT["外部服务"]
        direction LR
        MAP["腾讯地图"]
        WX["腾讯天气"]
        TAV["Tavily"]
        YZ["云诊365"]
        SZ["舌诊"]
        JTD["金条洞"]
        TAG["tag-system"]
        PG[("PostgreSQL")]
    end

    subgraph SDK["third/ SDK"]
        direction LR
        T1["order-sdk"] --> HM["hmac-signature"]
        T2["workorder-sdk"] --> HM
        T3["shezhen-sdk"] --> HM
        T4["message-sdk"] --> HM
    end

    GEN --> EXT
    ORC --> EXT
    EXT --> SDK
    TAG --> PG
    TD --> PG

    style MS fill:#FFCDD2,stroke:#C62828
    style APP fill:#FFF9C4,stroke:#F9A825
    style ORC fill:#FFF9C4,stroke:#F9A825`,
  },

  // ── 图5 前后端协作 ──
  {
    name: '05-frontend-backend',
    title: '图 5  前后端协作时序图',
    scale: 2.5,
    code: `sequenceDiagram
    autonumber
    actor U as 用户
    participant M as mobile.js
    participant IF as iframe 卡片
    participant CB as card-bridge.js
    participant API as app.js
    participant O as orchestrator

    U->>M: 输入文字
    M->>API: POST /api/chat/message
    API->>O: runLocalSkill
    O-->>API: envelope
    Note over API,O: answer / template_id / skill_key<br/>html / html_fallback / has_html<br/>actions[] / followup_suggestions[]<br/>compact_followups[] / trace
    API-->>M: JSON

    alt cardNeedsIframeIsolation = true
        M->>IF: 创建 iframe 注入 html
        IF->>CB: 执行 bridge-injector 注入脚本
        CB-->>M: postMessage 高度 / 点击事件
    else 内联渲染
        M->>M: 使用 html_fallback 直接内联
    end

    M->>U: 渲染卡片 + 底部追问按钮

    U->>M: 点击 action 按钮
    M->>API: POST /api/chat/action {action_key}
    API->>O: 携带 action_key
    Note over O: action_key 锁定短路<br/>完全跳过 identifyScene
    O-->>M: 新卡片`,
  },
];
