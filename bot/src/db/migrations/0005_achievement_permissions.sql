-- Permission seeds for normalized achievement management.
INSERT IGNORE INTO permissions (id, group_id, permission_key, description) VALUES
  ('perm_owner_achievements_manage', 'pg_owner', 'achievements.manage', 'Manage achievement definitions'),
  ('perm_admin_achievements_manage', 'pg_administration', 'achievements.manage', 'Manage achievement definitions');
