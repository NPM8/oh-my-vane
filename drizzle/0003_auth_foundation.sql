CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`passwordHash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`disabled` integer DEFAULT 0 NOT NULL,
	`mustChangePassword` integer DEFAULT 0 NOT NULL,
	`totpSecret` text,
	`totpEnabled` integer DEFAULT 0 NOT NULL,
	`recoveryCodes` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`tokenHash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`createdBy` text NOT NULL,
	`expiresAt` text NOT NULL,
	`usedAt` text,
	`usedBy` text,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`tokenHash` text NOT NULL,
	`expiresAt` text NOT NULL,
	`revokedAt` text,
	`replacedBy` text,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `chats` ADD `userId` text;
--> statement-breakpoint
ALTER TABLE `chats` ADD `shared` integer DEFAULT 0 NOT NULL;
