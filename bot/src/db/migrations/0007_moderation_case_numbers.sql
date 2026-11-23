ALTER TABLE moderation_actions ADD COLUMN case_number BIGINT NOT NULL DEFAULT 0;
CREATE INDEX ix_moderation_case_number ON moderation_actions (guild_id, case_number);
INSERT IGNORE INTO permissions (id, group_id, permission_key, description) VALUES
  ('perm_owner_moderation_view', 'pg_owner', 'moderation.view', 'View moderation history'),
  ('perm_admin_moderation_view', 'pg_administration', 'moderation.view', 'View moderation history'),
  ('perm_mod_moderation_view', 'pg_moderation', 'moderation.view', 'View moderation history');
