CREATE TABLE IF NOT EXISTS flattalk_table_rows (
  table_name text NOT NULL,
  row_id text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (table_name, row_id)
);

CREATE INDEX IF NOT EXISTS idx_flattalk_table_rows_table_name
  ON flattalk_table_rows (table_name);

CREATE VIEW IF NOT EXISTS flattalk_elder_profile AS
  SELECT row_id AS elder_id, data, created_at, updated_at
  FROM flattalk_table_rows
  WHERE table_name = 'elder_profile';

CREATE VIEW IF NOT EXISTS flattalk_meal_rules AS
  SELECT row_id AS key, data, created_at, updated_at
  FROM flattalk_table_rows
  WHERE table_name = 'meal_rules';

CREATE VIEW IF NOT EXISTS flattalk_diet_contraindications AS
  SELECT row_id AS key, data, created_at, updated_at
  FROM flattalk_table_rows
  WHERE table_name = 'diet_contraindications';

CREATE VIEW IF NOT EXISTS flattalk_gxy_travel_route_plan AS
  SELECT row_id AS uid, data, created_at, updated_at
  FROM flattalk_table_rows
  WHERE table_name = 'gxy_travel_route_plan';

CREATE VIEW IF NOT EXISTS flattalk_model_configs AS
  SELECT row_id AS config_id, data, created_at, updated_at
  FROM flattalk_table_rows
  WHERE table_name = 'model_configs';

CREATE VIEW IF NOT EXISTS flattalk_skill_configs AS
  SELECT row_id AS skill_key, data, created_at, updated_at
  FROM flattalk_table_rows
  WHERE table_name = 'skill_configs';

CREATE VIEW IF NOT EXISTS flattalk_interface_configs AS
  SELECT row_id AS interface_key, data, created_at, updated_at
  FROM flattalk_table_rows
  WHERE table_name = 'interface_configs';

CREATE VIEW IF NOT EXISTS flattalk_conversation_turns AS
  SELECT row_id AS turn_id, data, created_at, updated_at
  FROM flattalk_table_rows
  WHERE table_name = 'conversation_turns';
