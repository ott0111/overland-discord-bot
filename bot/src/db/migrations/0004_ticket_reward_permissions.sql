INSERT IGNORE INTO permissions (id,group_id,permission_key,description) VALUES
 ('perm_owner_tickets_view','pg_owner','tickets.view','View support tickets'),
 ('perm_owner_tickets_manage','pg_owner','tickets.manage','Manage support tickets'),
 ('perm_admin_tickets_view','pg_administration','tickets.view','View support tickets'),
 ('perm_admin_tickets_manage','pg_administration','tickets.manage','Manage support tickets'),
 ('perm_support_tickets_view','pg_support','tickets.view','View support tickets'),
 ('perm_support_tickets_manage','pg_support','tickets.manage','Manage support tickets'),
 ('perm_owner_rewards_view','pg_owner','rewards.view','View rewards and claims'),
 ('perm_admin_rewards_view','pg_administration','rewards.view','View rewards and claims'),
 ('perm_rewards_rewards_view','pg_rewards_management','rewards.view','View rewards and claims');
