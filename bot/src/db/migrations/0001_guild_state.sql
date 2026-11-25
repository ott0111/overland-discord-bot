-- Transitional durable store. Existing JSON records are preserved and imported
-- explicitly with scripts/import-json-to-mysql.js after a dry-run review.
CREATE TABLE IF NOT EXISTS guild_state (
  guild_id VARCHAR(20) NOT NULL,
  data JSON NOT NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
