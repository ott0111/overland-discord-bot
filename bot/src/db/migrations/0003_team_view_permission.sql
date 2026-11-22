INSERT IGNORE INTO permissions (id, group_id, permission_key, description) VALUES
  ('perm_owner_team_view', 'pg_owner', 'team.view', 'View internal team records'),
  ('perm_executive_team_view', 'pg_executive', 'team.view', 'View internal team records'),
  ('perm_admin_team_view', 'pg_administration', 'team.view', 'View internal team records');
