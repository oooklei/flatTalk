-- gxy_meal_plan_feedback：用户反馈表（归属 meal_plan 智能体，Redis DB7）
-- 用途：存储用户对膳食推荐的反馈(喜欢/不喜欢/收藏/取消收藏/评分/评价)，用于反哺标签与优化推荐
-- 反馈动作枚举：like / dislike / favorite / unfavorite / rate / comment
-- 字段来源：docs/superpowers/specs/2026-07-24-meal-plan-design.md §3.1 BFF 端点(/api/meal/feedback)
--         + §4.3 反馈按钮 + §9 标签反哺(feedback 触发点)

CREATE TABLE IF NOT EXISTS gxy_meal_plan_feedback (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键 ID',
  feedback_id VARCHAR(64) UNIQUE NOT NULL COMMENT '反馈唯一 ID',
  user_id VARCHAR(64) NOT NULL COMMENT '用户 ID',
  elder_id VARCHAR(64) COMMENT '老人 ID',
  plan_id VARCHAR(64) NOT NULL COMMENT '关联膳食方案 ID',
  meal_id VARCHAR(64) NOT NULL COMMENT '膳食 ID',
  meal_name VARCHAR(128) COMMENT '膳食名称',
  action VARCHAR(32) NOT NULL COMMENT '反馈动作(like/dislike/favorite/unfavorite/rate/comment)',
  rating DECIMAL(3,1) COMMENT '评分(1-5)',
  comment TEXT COMMENT '文字评价',
  allergies_extracted JSON COMMENT '从评价中提取的过敏食材数组(用于反哺 allergy_tags)',
  sentiment VARCHAR(16) COMMENT '情感倾向(positive/neutral/negative)',
  sentiment_score DECIMAL(4,2) COMMENT '情感分数(-1.00 ~ 1.00)',
  keywords JSON COMMENT '关键词数组(AI 提取)',
  tag_feedback_triggered TINYINT(1) DEFAULT 0 COMMENT '是否已触发标签反哺',
  tag_feedback_records JSON COMMENT '标签反哺结果数组({tag_code, status})',
  agent_id VARCHAR(32) DEFAULT 'meal_plan' COMMENT '智能体标识',
  source_status VARCHAR(32) DEFAULT 'real_data' COMMENT '数据来源状态',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  INDEX idx_user (user_id, created_at),
  INDEX idx_elder (elder_id, created_at),
  INDEX idx_plan (plan_id),
  INDEX idx_meal (meal_id),
  INDEX idx_action (action),
  INDEX idx_rating (rating),
  INDEX idx_agent (agent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户反馈表（归属 meal_plan 智能体，Redis DB7）';
