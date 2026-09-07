import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const materialsTable = pgTable("memorizer_materials", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  subject: text("subject").notNull().default("General"),
  content: text("content"),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull().defaultNow(),
  intervalDays: integer("interval_days").notNull().default(1),
  reviewCount: integer("review_count").notNull().default(0),
  streak: integer("streak").notNull().default(0),
  lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
  lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const cardsTable = pgTable("memorizer_cards", {
  id: serial("id").primaryKey(),
  materialId: integer("material_id")
    .notNull()
    .references(() => materialsTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
  front: text("front").notNull(),
  back: text("back").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const notificationSettingsTable = pgTable("memorizer_notification_settings", {
  id: serial("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  reminderHour: integer("reminder_hour").notNull().default(19),
  timezone: text("timezone").notNull().default("Asia/Rangoon"),
  permissionState: text("permission_state").notNull().default("default"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const pushSubscriptionsTable = pgTable("memorizer_push_subscriptions", {
  id: serial("id").primaryKey(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pushConfigTable = pgTable("memorizer_push_config", {
  id: integer("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
});

export const insertMaterialSchema = createInsertSchema(materialsTable).omit({
  id: true,
  dueAt: true,
  intervalDays: true,
  reviewCount: true,
  streak: true,
  lastReviewedAt: true,
  createdAt: true,
  updatedAt: true,
});
export const insertCardSchema = createInsertSchema(cardsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertNotificationSettingsSchema = createInsertSchema(notificationSettingsTable).omit({
  id: true,
  updatedAt: true,
});

export type InsertMaterial = z.infer<typeof insertMaterialSchema>;
export type Material = typeof materialsTable.$inferSelect;
export type Card = typeof cardsTable.$inferSelect;
export type NotificationSettings = typeof notificationSettingsTable.$inferSelect;