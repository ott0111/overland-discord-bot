ALTER TABLE discord_members
  ADD COLUMN left_at DATETIME(3) NULL,
  ADD KEY ix_members_guild_left_joined (guild_id, left_at, joined_at);
