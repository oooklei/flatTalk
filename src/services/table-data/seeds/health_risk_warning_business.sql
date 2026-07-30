-- 健康风险预警业务表种子（本地 flatTalk 表数据）
-- 该表记录「健康风险预警师」业务场景在本地的注册信息，作为业务数据接入的占位。
-- 实际风险等级/信号/规则由运行时依据设备信号 + 风险规则确定性研判。

INSERT INTO flattalk_table_rows (table_name, row_id, data) VALUES
  ('health_risk_warning_business', 'hrw_biz_b', '{"id":"hrw_biz_b","package_key":"health_risk_warning","business_scene":"健康风险预警师","terminal":"B","role":"care_worker","status":"enabled","sample_payload":"{\"level\":\"关注\",\"signals\":[\"血压\",\"心率\"],\"rules\":[\"血压持续偏高\"]}"}'),
  ('health_risk_warning_business', 'hrw_biz_g', '{"id":"hrw_biz_g","package_key":"health_risk_warning","business_scene":"健康风险预警师","terminal":"G","role":"village_doctor","status":"enabled","sample_payload":"{\"level\":\"关注\",\"signals\":[\"血压\",\"血糖\"],\"rules\":[\"血压持续偏高\",\"血糖波动\"]}"}'),
  ('health_risk_warning_business', 'hrw_biz_admin', '{"id":"hrw_biz_admin","package_key":"health_risk_warning","business_scene":"健康风险预警师","terminal":"Admin","role":"admin","status":"enabled","sample_payload":"{\"level\":\"紧急\",\"signals\":[\"血压\",\"血糖\",\"跌倒\"],\"rules\":[\"血压持续偏高\",\"跌倒高风险\"]}"}')
ON CONFLICT (table_name, row_id) DO NOTHING;
