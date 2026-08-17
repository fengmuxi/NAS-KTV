ALTER TABLE `rooms` ADD COLUMN `current_join_code` TEXT;--> statement-breakpoint
ALTER TABLE `rooms` ADD COLUMN `join_code_expires_at` INTEGER;
