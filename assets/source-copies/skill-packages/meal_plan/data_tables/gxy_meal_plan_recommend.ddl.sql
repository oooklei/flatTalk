-- gxy_meal_plan_recommend：膳食推荐记录表（归属 meal_plan 智能体，Redis DB7）
-- 用途：存储 meal_plan BFF 4 维个性化推荐引擎每次输出的推荐记录与候选评分明细
-- 推荐上下文类型枚举：travel / health_intervention / profile / daily / seasonal
-- 推荐状态枚举：recommending / recommended / liked / disliked / expired / fallback
-- 4 维权重：健康匹配度 0.35 / 口味匹配度 0.25 / 地域季节匹配度 0.25 / 营养匹配度 0.15
-- 字段来源：docs/superpowers/specs/2026-07-24-meal-plan-design.md §2.2 4维推荐算法 + §3.2 推荐响应 + §2.8 状态机

CREATE TABLE IF NOT EXISTS gxy_meal_plan_recommend (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键 ID',
  plan_id VARCHAR(64) UNIQUE NOT NULL COMMENT '膳食方案 ID(plan_001)',
  session_id VARCHAR(64) COMMENT '会话 ID(关联对话)',
  user_id VARCHAR(64) NOT NULL COMMENT '用户 ID',
  elder_id VARCHAR(64) COMMENT '老人 ID',
  context_type VARCHAR(32) NOT NULL COMMENT '推荐上下文类型(travel/health_intervention/profile/daily/seasonal)',
  context JSON COMMENT '上下文 JSON(destination/season/risk_type/meal_time 等)',
  meal_time VARCHAR(16) COMMENT '餐次(breakfast/lunch/dinner)',
  top_n INT DEFAULT 3 COMMENT '推荐数量',
  recommendations JSON NOT NULL COMMENT 'TopN 推荐结果数组(含 meal_id/name/score/scores/reason/ingredients/nutrition 等)',
  top1_meal_id VARCHAR(64) COMMENT 'Top1 膳食 ID',
  top1_meal_name VARCHAR(128) COMMENT 'Top1 膳食名称',
  top1_total_score DECIMAL(5,2) COMMENT 'Top1 总分(0-100)',
  top1_score_health DECIMAL(5,2) COMMENT 'Top1 健康匹配度(权重 0.35)',
  top1_score_taste DECIMAL(5,2) COMMENT 'Top1 口味匹配度(权重 0.25)',
  top1_score_region DECIMAL(5,2) COMMENT 'Top1 地域季节匹配度(权重 0.25)',
  top1_score_nutrition DECIMAL(5,2) COMMENT 'Top1 营养匹配度(权重 0.15)',
  profile_snapshot JSON COMMENT '4 维画像快照(health/taste/region/nutrition)',
  contraindication_issues JSON COMMENT '禁忌检查结果数组(过敏/慢病/药物)',
  kb_retrieve_count INT COMMENT '知识库召回候选数',
  tavily_enriched TINYINT(1) DEFAULT 0 COMMENT '是否完成 Tavily 配图增强',
  media_cache JSON COMMENT 'Tavily 媒体缓存引用(食材图/菜品图/视频/营养科普)',
  trigger_source VARCHAR(32) COMMENT '触发来源(travel_route/health_risk_warning/elder_health_profile/cron/manual)',
  trigger_warning_id VARCHAR(64) COMMENT '关联预警 ID(健康干预推荐)',
  status VARCHAR(32) NOT NULL DEFAULT 'recommending' COMMENT '推荐状态(recommending/recommended/liked/disliked/expired/fallback)',
  agent_id VARCHAR(32) DEFAULT 'meal_plan' COMMENT '智能体标识',
  source_status VARCHAR(32) DEFAULT 'real_data' COMMENT '数据来源状态',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  INDEX idx_user (user_id, created_at),
  INDEX idx_elder (elder_id, created_at),
  INDEX idx_context (context_type, created_at),
  INDEX idx_status (status),
  INDEX idx_trigger (trigger_source),
  INDEX idx_warning (trigger_warning_id),
  INDEX idx_meal_time (meal_time, created_at),
  INDEX idx_agent (agent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='膳食推荐记录表（归属 meal_plan 智能体，Redis DB7）';
