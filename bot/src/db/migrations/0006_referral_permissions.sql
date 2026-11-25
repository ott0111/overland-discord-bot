INSERT IGNORE INTO permissions (id, group_id, permission_key, description) VALUES
  ('perm_owner_referrals_view', 'pg_owner', 'referrals.view', 'View referral records and statistics'),
  ('perm_admin_referrals_view', 'pg_administration', 'referrals.view', 'View referral records and statistics'),
  ('perm_owner_referrals_manage', 'pg_owner', 'referrals.manage', 'Manage referral configuration and review'),
  ('perm_admin_referrals_manage', 'pg_administration', 'referrals.manage', 'Manage referral configuration and review');
