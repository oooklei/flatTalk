-- gxy_intent_record：意图识别记录表（归属 guixiaoyang_dispatch 智能体，Redis DB1）
-- 用途：记录 L1 总调度意图识别的完整过程，含候选意图、置信度、最终选择与触发规则
-- 意图来源枚举：rule / semantic / llm / fallback
-- 端侧枚举：C(老人/家属端) / G(管理端) / B(护理员/机构端) / Admin
-- 字段来源：skill-packages/guixiaoyang_dispatch/SKILL.md + templates/intent_prompt.md
--         + workflows/intent_route.md + workflows/skill_dispatch.md

CREATE TABLE IF NOT EXISTS gxy_intent_record (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键 ID',
  record_id VARCHAR(64) UNIQUE NOT NULL COMMENT '意图识别记录唯一编号',
  uid VARCHAR(64) NOT NULL COMMENT '本机种子记录唯一编号',
  record_no INT COMMENT '模拟记录序号',
  session_id VARCHAR(64) NOT NULL COMMENT '调度会话 ID',
  elder_id VARCHAR(64) NOT NULL COMMENT '老人编号',
  elder_name VARCHAR(64) COMMENT '老人姓名',
  terminal ENUM('C','G','B','Admin') NOT NULL COMMENT 'C/G/B/Admin 端侧',
  role VARCHAR(64) NOT NULL COMMENT '登录角色',
  community_name VARCHAR(128) COMMENT '所属社区',
  service_type VARCHAR(64) COMMENT '业务类型',
  status VARCHAR(32) NOT NULL COMMENT '业务状态',
  input_text TEXT NOT NULL COMMENT '用户原始输入',
  input_normalized TEXT COMMENT '归一化后的输入(分词/去停用词/纠错)',
  intent_source VARCHAR(16) NOT NULL DEFAULT 'rule' COMMENT '意图来源(rule/semantic/llm/fallback)',
  candidate_intents JSON COMMENT '候选意图数组([{intent, score, reason}])',
  final_intent VARCHAR(64) NOT NULL COMMENT '最终选择意图',
  final_confidence DECIMAL(5,2) NOT NULL COMMENT '最终置信度(0-100)',
  threshold DECIMAL(5,2) DEFAULT 60.00 COMMENT '置信度阈值(低于则进入兜底)',
  matched_rules JSON COMMENT '命中规则数组(规则 ID + 规则名)',
  matched_keywords JSON COMMENT '命中关键词数组',
  entities JSON COMMENT '抽取的实体 JSON({elder_name/service_type/time/location 等})',
  target_skill_key VARCHAR(64) NOT NULL COMMENT '目标技能 key',
  target_skill_name VARCHAR(128) COMMENT '目标技能中文名',
  auth_level VARCHAR(32) NOT NULL COMMENT '鉴权级别',
  is_fallback TINYINT(1) DEFAULT 0 COMMENT '是否兜底路由',
  fallback_reason VARCHAR(255) COMMENT '兜底原因(置信度不足/技能不可用/无匹配规则)',
  llm_tokens_used INT COMMENT 'LLM 调用 token 数(如使用 LLM 识别)',
  latency_ms INT COMMENT '意图识别耗时(ms)',
  error_code VARCHAR(32) COMMENT '错误码',
  error_msg TEXT COMMENT '错误信息',
  agent_id VARCHAR(32) DEFAULT 'guixiaoyang_dispatch' COMMENT '智能体标识',
  source_status VARCHAR(32) DEFAULT 'real_data' COMMENT '数据来源状态',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  INDEX idx_session (session_id, created_at),
  INDEX idx_elder (elder_id, created_at),
  INDEX idx_intent (final_intent, created_at),
  INDEX idx_skill (target_skill_key),
  INDEX idx_confidence (final_confidence),
  INDEX idx_fallback (is_fallback),
  INDEX idx_source (intent_source),
  INDEX idx_terminal (terminal),
  INDEX idx_agent (agent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='意图识别记录表（归属 guixiaoyang_dispatch 智能体，Redis DB1）';
