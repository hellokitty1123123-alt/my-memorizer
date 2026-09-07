import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq, lte } from "drizzle-orm";
import * as webpush from "web-push";
import { db } from "@workspace/db";
import {
  cardsTable,
  materialsTable,
  notificationSettingsTable,
  pushConfigTable,
  pushSubscriptionsTable,
} from "@workspace/db/schema";
import {
  AddCardBody,
  AddCardParams,
  CreateMaterialBody,
  DeleteCardParams,
  DeleteMaterialParams,
  GetMaterialParams,
  ReviewMaterialBody,
  ReviewMaterialParams,
  SaveNotificationSubscriptionBody,
  UpdateCardBody,
  UpdateCardParams,
  UpdateMaterialBody,
  UpdateMaterialParams,
  UpdateNotificationSettingsBody,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function badRequest(res: Response, message: string) {
  res.status(400).json({ error: message });
}

function parseId(schema: typeof GetMaterialParams | typeof DeleteMaterialParams | typeof AddCardParams | typeof UpdateCardParams | typeof DeleteCardParams, value: unknown) {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function loadMaterial(id: number) {
  const [material] = await db
    .select()
    .from(materialsTable)
    .where(eq(materialsTable.id, id));
  if (!material) return null;
  const cards = await db
    .select()
    .from(cardsTable)
    .where(eq(cardsTable.materialId, id))
    .orderBy(asc(cardsTable.position), asc(cardsTable.id));
  return { ...material, cards };
}

async function loadMaterials() {
  const materials = await db
    .select()
    .from(materialsTable)
    .orderBy(asc(materialsTable.dueAt), asc(materialsTable.id));
  const cards = await db
    .select()
    .from(cardsTable)
    .orderBy(asc(cardsTable.position), asc(cardsTable.id));
  const cardsByMaterial = new Map<number, typeof cards>();
  for (const card of cards) {
    const existing = cardsByMaterial.get(card.materialId) ?? [];
    existing.push(card);
    cardsByMaterial.set(card.materialId, existing);
  }
  return materials.map((material) => ({
    ...material,
    cards: cardsByMaterial.get(material.id) ?? [],
  }));
}

async function ensureNotificationSettings() {
  const [existing] = await db
    .select()
    .from(notificationSettingsTable)
    .where(eq(notificationSettingsTable.id, 1));
  if (existing) return existing;
  const [created] = await db
    .insert(notificationSettingsTable)
    .values({ id: 1 })
    .returning();
  return created;
}

async function ensurePushConfig() {
  const [existing] = await db
    .select()
    .from(pushConfigTable)
    .where(eq(pushConfigTable.id, 1));
  if (existing) return existing;
  const keys = webpush.generateVAPIDKeys();
  const [created] = await db
    .insert(pushConfigTable)
    .values({
      id: 1,
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
    })
    .returning();
  return created;
}

function isReminderHour(timezone: string, reminderHour: number) {
  try {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        hour12: false,
        timeZone: timezone,
      }).format(new Date()),
    );
    return hour === reminderHour || (hour === 24 && reminderHour === 0);
  } catch {
    return true;
  }
}

async function sendDueNotifications() {
  const settings = await ensureNotificationSettings();
  if (!settings.enabled || !isReminderHour(settings.timezone, settings.reminderHour)) return;
  const subscriptions = await db.select().from(pushSubscriptionsTable);
  if (!subscriptions.length) return;
  const due = await db
    .select()
    .from(materialsTable)
    .where(lte(materialsTable.dueAt, new Date()))
    .then((materials) =>
      materials.filter(
        (material) => !material.lastNotifiedAt || material.lastNotifiedAt < material.dueAt,
      ),
    );
  if (!due.length) return;

  const config = await ensurePushConfig();
  webpush.setVapidDetails("mailto:memorizer@replit.app", config.publicKey, config.privateKey);
  const payload = JSON.stringify({
    title: "My Memorizer",
    body: `${due.length} review${due.length === 1 ? "" : "s"} ready. Keep your memory curve moving.`,
    url: "/",
  });
  const staleSubscriptionIds: number[] = [];
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        payload,
      );
    } catch (error: unknown) {
      const statusCode =
        typeof error === "object" && error !== null && "statusCode" in error
          ? Number((error as { statusCode?: number }).statusCode)
          : 0;
      if (statusCode === 404 || statusCode === 410) staleSubscriptionIds.push(subscription.id);
      else logger.warn({ err: error }, "Unable to send memorizer push notification");
    }
  }
  for (const id of staleSubscriptionIds) {
    await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, id));
  }
  for (const material of due) {
    await db
      .update(materialsTable)
      .set({ lastNotifiedAt: new Date() })
      .where(eq(materialsTable.id, material.id));
  }
}

function materialIdFrom(req: Request, schema: typeof GetMaterialParams | typeof DeleteMaterialParams | typeof AddCardParams | typeof UpdateCardParams | typeof DeleteCardParams) {
  return parseId(schema, req.params);
}

router.get("/materials", async (_req, res) => {
  const materials = await loadMaterials();
  res.json({
    materials,
    dueCount: materials.filter((material) => material.dueAt <= new Date()).length,
    textCount: materials.filter((material) => material.type === "text").length,
    flashcardCount: materials.filter((material) => material.type === "flashcard").length,
  });
});

router.post("/materials", async (req, res) => {
  const parsed = CreateMaterialBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, "Please provide a valid title and material type.");
  const input = parsed.data;
  if (input.type === "text" && !input.content?.trim()) {
    return badRequest(res, "Text material content is required.");
  }
  if (input.type === "flashcard" && (!input.cards?.length || input.cards.some((card) => !card.front.trim() || !card.back.trim()))) {
    return badRequest(res, "Add at least one complete flashcard.");
  }

  const material = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(materialsTable)
      .values({
        type: input.type,
        title: input.title.trim(),
        subject: input.subject?.trim() || "General",
        content: input.type === "text" ? input.content?.trim() ?? null : null,
      })
      .returning();
    if (input.type === "flashcard" && input.cards) {
      await tx.insert(cardsTable).values(
        input.cards.map((card, index) => ({
          materialId: created.id,
          position: card.position ?? index,
          front: card.front.trim(),
          back: card.back.trim(),
        })),
      );
    }
    return created;
  });
  const result = await loadMaterial(material.id);
  res.status(201).json(result);
});

router.get("/materials/:id", async (req, res) => {
  const id = materialIdFrom(req, GetMaterialParams);
  if (!id) return badRequest(res, "Invalid material id.");
  const material = await loadMaterial(id.id);
  if (!material) return res.status(404).json({ error: "Material not found." });
  res.json(material);
});

router.patch("/materials/:id", async (req, res) => {
  const params = materialIdFrom(req, UpdateMaterialParams);
  if (!params) return badRequest(res, "Invalid material id.");
  const parsed = UpdateMaterialBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, "Please provide valid material details.");
  const current = await loadMaterial(params.id);
  if (!current) return res.status(404).json({ error: "Material not found." });
  const input = parsed.data;

  await db.transaction(async (tx) => {
    await tx
      .update(materialsTable)
      .set({
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.subject !== undefined ? { subject: input.subject.trim() || "General" } : {}),
        ...(input.content !== undefined ? { content: input.content.trim() || null } : {}),
      })
      .where(eq(materialsTable.id, params.id));
    if (input.cards !== undefined && current.type === "flashcard") {
      await tx.delete(cardsTable).where(eq(cardsTable.materialId, params.id));
      if (input.cards.length) {
        await tx.insert(cardsTable).values(
          input.cards.map((card, index) => ({
            materialId: params.id,
            position: card.position ?? index,
            front: card.front.trim(),
            back: card.back.trim(),
          })),
        );
      }
    }
  });
  res.json(await loadMaterial(params.id));
});

router.delete("/materials/:id", async (req, res) => {
  const id = materialIdFrom(req, DeleteMaterialParams);
  if (!id) return badRequest(res, "Invalid material id.");
  const deleted = await db
    .delete(materialsTable)
    .where(eq(materialsTable.id, id.id))
    .returning({ id: materialsTable.id });
  if (!deleted.length) return res.status(404).json({ error: "Material not found." });
  res.status(204).send();
});

router.post("/materials/:id/review", async (req, res) => {
  const params = materialIdFrom(req, ReviewMaterialParams);
  if (!params) return badRequest(res, "Invalid material id.");
  const parsed = ReviewMaterialBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, "Choose Remember or Forgot.");
  const current = await loadMaterial(params.id);
  if (!current) return res.status(404).json({ error: "Material not found." });

  const remembered = parsed.data.outcome === "remembered";
  const nextInterval = remembered
    ? Math.min(120, current.reviewCount === 0 ? 1 : Math.max(2, Math.round(current.intervalDays * 2.1)))
    : 1;
  const nextReviewAt = new Date(Date.now() + nextInterval * 24 * 60 * 60 * 1000);
  await db
    .update(materialsTable)
    .set({
      intervalDays: nextInterval,
      reviewCount: current.reviewCount + 1,
      streak: remembered ? current.streak + 1 : 0,
      lastReviewedAt: new Date(),
      dueAt: nextReviewAt,
    })
    .where(eq(materialsTable.id, params.id));
  const material = await loadMaterial(params.id);
  res.json({
    material,
    nextReviewAt,
    intervalDays: nextInterval,
    message: remembered
      ? `Next review in ${nextInterval} day${nextInterval === 1 ? "" : "s"}.`
      : "Reset for tomorrow. A shorter review will help rebuild recall.",
  });
});

router.post("/materials/:id/cards", async (req, res) => {
  const params = materialIdFrom(req, AddCardParams);
  if (!params) return badRequest(res, "Invalid material id.");
  const parsed = AddCardBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, "Please provide both sides of the card.");
  const material = await loadMaterial(params.id);
  if (!material) return res.status(404).json({ error: "Material not found." });
  if (material.type !== "flashcard") return badRequest(res, "Cards can only be added to a flashcard set.");
  const [card] = await db
    .insert(cardsTable)
    .values({
      materialId: params.id,
      position: parsed.data.position ?? material.cards.length,
      front: parsed.data.front.trim(),
      back: parsed.data.back.trim(),
    })
    .returning();
  res.status(201).json(card);
});

router.patch("/materials/:id/cards/:cardId", async (req, res) => {
  const parsedParams = UpdateCardParams.safeParse(req.params);
  if (!parsedParams.success) return badRequest(res, "Invalid card id.");
  const parsed = UpdateCardBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, "Please provide valid card details.");
  const [card] = await db
    .update(cardsTable)
    .set({
      ...(parsed.data.front !== undefined ? { front: parsed.data.front.trim() } : {}),
      ...(parsed.data.back !== undefined ? { back: parsed.data.back.trim() } : {}),
      ...(parsed.data.position !== undefined ? { position: parsed.data.position } : {}),
    })
    .where(and(eq(cardsTable.id, parsedParams.data.cardId), eq(cardsTable.materialId, parsedParams.data.id)))
    .returning();
  if (!card) return res.status(404).json({ error: "Card not found." });
  res.json(card);
});

router.delete("/materials/:id/cards/:cardId", async (req, res) => {
  const parsedParams = DeleteCardParams.safeParse(req.params);
  if (!parsedParams.success) return badRequest(res, "Invalid card id.");
  const deleted = await db
    .delete(cardsTable)
    .where(and(eq(cardsTable.id, parsedParams.data.cardId), eq(cardsTable.materialId, parsedParams.data.id)))
    .returning({ id: cardsTable.id });
  if (!deleted.length) return res.status(404).json({ error: "Card not found." });
  res.status(204).send();
});

router.get("/notifications/settings", async (_req, res) => {
  res.json(await ensureNotificationSettings());
});

router.get("/notifications/vapid-key", async (_req, res) => {
  const config = await ensurePushConfig();
  res.json({ publicKey: config.publicKey });
});

router.post("/notifications/subscriptions", async (req, res) => {
  const parsed = SaveNotificationSubscriptionBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, "Please provide a valid browser notification subscription.");
  const input = parsed.data;
  const [subscription] = await db
    .insert(pushSubscriptionsTable)
    .values(input)
    .onConflictDoUpdate({
      target: pushSubscriptionsTable.endpoint,
      set: { p256dh: input.p256dh, auth: input.auth },
    })
    .returning({ id: pushSubscriptionsTable.id, endpoint: pushSubscriptionsTable.endpoint });
  res.status(201).json(subscription);
});

router.put("/notifications/settings", async (req, res) => {
  const parsed = UpdateNotificationSettingsBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, "Please provide valid notification settings.");
  const current = await ensureNotificationSettings();
  const [updated] = await db
    .update(notificationSettingsTable)
    .set({
      enabled: parsed.data.enabled,
      reminderHour: parsed.data.reminderHour,
      timezone: parsed.data.timezone,
    })
    .where(eq(notificationSettingsTable.id, current.id))
    .returning();
  res.json(updated);
});

void sendDueNotifications();
setInterval(() => {
  void sendDueNotifications();
}, 60_000);

export default router;