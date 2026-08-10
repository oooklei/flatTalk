INSERT INTO flattalk_table_rows (table_name, row_id, data)
VALUES
  ('elder_profile', 'demo_elder_1', '{"elder_id":"demo_elder_1","age":72,"conditions":["diabetes"],"preferences":["light","soft"]}'::jsonb),
  ('meal_rules', 'diabetes', '{"key":"diabetes","text":"Control refined carbohydrates and sweet drinks for diabetic elders."}'::jsonb),
  ('meal_rules', 'hypertension', '{"key":"hypertension","text":"Reduce sodium intake and avoid preserved high-salt foods."}'::jsonb),
  ('diet_contraindications', 'high_sugar', '{"key":"high_sugar","text":"Avoid sweet soy milk, syrup desserts, pastries, and high-sugar fruit."}'::jsonb),
  ('diet_contraindications', 'high_salt', '{"key":"high_salt","text":"Avoid pickles, cured meat, concentrated soup, and high-salt seasoning."}'::jsonb),
  ('gxy_travel_route_plan', 'travel_route_demo_1', '{"uid":"travel_route_demo_1","route_id":"route_bama_winter_3d","destination":"广西巴马","season":"秋冬适宜","budget_level":"舒适型","health_tags":"慢病友好,低强度,医疗可达","booking_status":"可咨询余量"}'::jsonb),
  ('gxy_travel_route_plan', 'travel_route_demo_2', '{"uid":"travel_route_demo_2","route_id":"route_beihai_warm_4d","destination":"广西北海","season":"冬季温暖","budget_level":"经济型","health_tags":"海滨慢行,家属陪同,交通便利","booking_status":"需人工确认"}'::jsonb),
  ('model_configs', 'mock_default', '{"config_id":"mock_default","provider":"mock","model_id":"mock","is_active":true,"is_default":true}'::jsonb),
  ('skill_configs', 'meal_plan', '{"skill_key":"meal_plan","enabled":true,"default_template":"diet_card","scene_thresholds":{"accept":0.62,"review":0.45}}'::jsonb),
  ('skill_configs', 'travel_route', '{"skill_key":"travel_route","enabled":true,"default_template":"sojourn_route","scene_thresholds":{"accept":0.62,"review":0.45}}'::jsonb),
  ('interface_configs', 'remote_knowledge', '{"interface_key":"remote_knowledge","type":"knowledge_base","base_url":"","enabled":false}'::jsonb)
ON CONFLICT (table_name, row_id) DO NOTHING;
