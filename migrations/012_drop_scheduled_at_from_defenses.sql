-- Migration 012: Ensure scheduled_at is fully removed from defenses table

-- Backfill start_time from scheduled_at when legacy column still exists
SET @sched_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'defenses' AND COLUMN_NAME = 'scheduled_at');
SET @start_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'defenses' AND COLUMN_NAME = 'start_time');

SET @sql = IF(
  @sched_exists = 1 AND @start_exists = 1,
  'UPDATE defenses SET start_time = scheduled_at WHERE start_time IS NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Force drop legacy scheduled_at column
SET @sql = IF(@sched_exists = 1, 'ALTER TABLE defenses DROP COLUMN scheduled_at', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
