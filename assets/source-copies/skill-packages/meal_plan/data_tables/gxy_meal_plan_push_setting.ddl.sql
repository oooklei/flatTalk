-- gxy_meal_plan_push_setting：推送设置表（归属 meal_plan 智能体，Redis DB7）
-- 用途：存储用户的膳食推送开关与时间设置，控制三餐提醒/季节性推荐/健康干预推送的触发
-- 推送类型枚举：breakfast / lunch / dinner / seasonal / health_intervention
-- 字段来源：docs/superpowers/specs/2026-07-24-meal-plan-design.md §2.5 主动推送逻辑 + §2.6 权限控制
--         + §3.1 BFF 端点(/api/meal/push/settings)

CREATE TABLE IF NOT EXISTS gxy_meal_plan_push_setting (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键 ID',
  user_id VARCHAR(64) UNIQUE NOT NULL COMMENT '用户 ID',
  elder_id VARCHAR(64) COMMENT '老人 ID',
  breakfast_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '早餐推送开关',
  breakfast_time TIME DEFAULT '08:00:00' COMMENT '早餐推送时间',
  lunch_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '午餐推送开关',
  lunch_time TIME DEFAULT '11:00:00' COMMENT '午餐推送时间',
  dinner_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '晚餐推送开关',
  dinner_time TIME DEFAULT '17:00:00' COMMENT '晚餐推送时间',
  seasonal_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '季节性推荐推送开关(节气当天 09:00)',
  health_intervention_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '健康干预推送开关(收到风险预警时)',
  push_channel VARCHAR(32) DEFAULT 'chat' COMMENT '推送通道(chat/app_push/sms)',
  timezone VARCHAR(32) DEFAULT 'Asia/Shanghai' COMMENT '时区',
  last_pushed_at TIMESTAMP NULL DEFAULT NULL COMMENT '最近一次推送时间',
  last_push_type VARCHAR(32) COMMENT '最近一次推送类型',
  last_push_plan_id VARCHAR(64) COMMENT '最近一次推送方案 ID',
  total_push_count INT DEFAULT 0 COMMENT '累计推送次数',
  opt_out_reason VARCHAR(255) COMMENT '关闭原因(用户主动关闭时记录)',
  agent_id VARCHAR(32) DEFAULT 'meal_plan' COMMENT '智能体标识',
  source_status VARCHAR(32) DEFAULT 'real_data' COMMENT '数据来源状态',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  INDEX idx_user (user_id),
  INDEX idx_elder (elder_id),
  INDEX idx_breakfast (breakfast_enabled, breakfast_time),
  INDEX idx_lunch (lunch_enabled, lunch_time),
  INDEX idx_dinner (dinner_enabled, dinner_time),
  INDEX idx_seasonal (seasonal_enabled),
  INDEX idx_intervention (health_intervention_enabled),
  INDEX idx_agent (agent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='推送设置表（归属 meal_plan 智能体，Redis DB7）';
