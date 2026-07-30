-- gxy_dispatch_log：调度日志表（归属 guixiaoyang_dispatch 智能体，Redis DB1）
-- 用途：记录 L1 总调度智能体每次调度决策与技能路由的过程，用于审计与统计分析
-- 调度状态枚举：pending / routing / dispatched / fallback / failed
-- 端侧枚举：C(老人/家属端) / G(管理端) / B(护理员/机构端) / Admin
-- 字段来源：skill-packages/guixiaoyang_dispatch/references/database_schema.md(gxy_dispatch_session 业务字段扩展)
--         + SKILL.md L1 总调度职责 + workflow skill_dispatch.md

CREATE TABLE IF NOT EXISTS gxy_dispatch_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键 ID',
  log_id VARCHAR(64) UNIQUE NOT NULL COMMENT '调度日志唯一编号',
  uid VARCHAR(64) NOT NULL COMMENT '本机种子记录唯一编号',
  record_no INT COMMENT '模拟记录序号',
  session_id VARCHAR(64) NOT NULL COMMENT '调度会话 ID',
  elder_id VARCHAR(64) NOT NULL COMMENT '老人编号',
  elder_name VARCHAR(64) COMMENT '老人姓名',
  terminal ENUM('C','G','B','Admin') NOT NULL COMMENT 'C/G/B/Admin 端侧',
  role VARCHAR(64) NOT NULL COMMENT '登录角色',
  community_name VARCHAR(128) COMMENT '所属社区',
  service_type VARCHAR(64) COMMENT '业务类型',
  status VARCHAR(32) NOT NULL DEFAULT 'pending' COMMENT '业务状态',
  intent VARCHAR(64) NOT NULL COMMENT '识别到的用户意图(SERVICE_SEARCH/DISPATCH_TRIGGER/RISK_QUERY 等)',
  skill_key VARCHAR(64) NOT NULL COMMENT '被调度的技能 key(find_service/dispatch_manage/health_risk_warning 等)',
  skill_name VARCHAR(128) COMMENT '被调度的技能中文名',
  auth_level VARCHAR(32) NOT NULL COMMENT '鉴权级别(L1/L2/L3 或角色权限等级)',
  dispatch_status VARCHAR(32) NOT NULL DEFAULT 'pending' COMMENT '调度状态(pending/routing/dispatched/fallback/failed)',
  route_reason VARCHAR(255) COMMENT '路由理由(规则匹配/语义匹配/兜底)',
  route_score DECIMAL(5,2) COMMENT '路由置信度(0-100)',
  fallback_skill_key VARCHAR(64) COMMENT '兜底技能 key(主技能不可用时)',
  input_text TEXT COMMENT '用户原始输入',
  input_normalized TEXT COMMENT '归一化后的输入',
  entities JSON COMMENT '抽取的实体 JSON',
  context JSON COMMENT '调度上下文 JSON(画像/历史/会话状态)',
  response_text TEXT COMMENT '调度回复摘要',
  latency_ms INT COMMENT '调度总耗时(ms)',
  error_code VARCHAR(32) COMMENT '错误码',
  error_msg TEXT COMMENT '错误信息',
  agent_id VARCHAR(32) DEFAULT 'guixiaoyang_dispatch' COMMENT '智能体标识',
  source_status VARCHAR(32) DEFAULT 'real_data' COMMENT '数据来源状态',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  INDEX idx_session (session_id, created_at),
  INDEX idx_elder (elder_id, created_at),
  INDEX idx_skill (skill_key, dispatch_status),
  INDEX idx_intent (intent, created_at),
  INDEX idx_status (dispatch_status),
  INDEX idx_terminal (terminal),
  INDEX idx_agent (agent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='调度日志表（归属 guixiaoyang_dispatch 智能体，Redis DB1）';
