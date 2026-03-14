-- Migration 011: Add start_time and end_time columns to defenses table

SET @start_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'defenses' AND COLUMN_NAME = 'start_time');
SET @sql = IF(@start_exists = 0, "ALTER TABLE defenses ADD COLUMN start_time DATETIME NULL", 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @end_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'defenses' AND COLUMN_NAME = 'end_time');
SET @sql = IF(@end_exists = 0, "ALTER TABLE defenses ADD COLUMN end_time DATETIME NULL AFTER start_time", 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Backfill start_time from scheduled_at for existing records
SET @sched_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'defenses' AND COLUMN_NAME = 'scheduled_at');
SET @sql = IF(
	@sched_exists = 1,
	'UPDATE defenses SET start_time = scheduled_at WHERE start_time IS NULL',
	'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Drop scheduled_at column
SET @sql = IF(@sched_exists = 1, 'ALTER TABLE defenses DROP COLUMN scheduled_at', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
