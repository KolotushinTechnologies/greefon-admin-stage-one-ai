import type { Db } from "mongodb";

const VECTOR_INDEX = "knowledge_vector";

export async function ensureMongoIndexes(db: Db): Promise<void> {
  await db.collection("users").createIndexes([
    { key: { telegramUserId: 1 }, unique: true },
    { key: { username: 1 } },
  ]);
  await db.collection("branches").createIndexes([
    { key: { crmId: 1 }, unique: true },
    { key: { name: 1 } },
    { key: { status: 1 } },
  ]);
  await db.collection("instructors").createIndexes([{ key: { crmId: 1 }, unique: true }]);
  await db.collection("groups").createIndexes([
    { key: { crmId: 1 }, unique: true },
    { key: { branchId: 1 } },
    { key: { name: 1 } },
  ]);
  await db.collection("chats").createIndexes([
    { key: { telegramChatId: 1 }, unique: true },
    { key: { branchId: 1 } },
    { key: { groupId: 1 } },
  ]);
  await db.collection("knowledge_docs").createIndexes([
    { key: { namespace: 1, kind: 1, status: 1 } },
    { key: { branchId: 1 } },
    { key: { groupId: 1 } },
  ]);
  await db.collection("knowledge_chunks").createIndexes([{ key: { docId: 1 } }]);
  await db.collection("audit_events").createIndexes([{ key: { createdAt: -1 } }, { key: { actorTelegramId: 1 } }]);
  await db.collection("outbound_messages").createIndexes([
    { key: { createdAt: -1 } },
    { key: { actorTelegramId: 1, createdAt: -1 } },
  ]);
  await db.collection("school_events").createIndexes([
    { key: { kind: 1, status: 1, updatedAt: -1 } },
  ]);
  await db.collection("escalations").createIndexes([
    { key: { status: 1, createdAt: -1 } },
    { key: { parentTelegramId: 1 } },
  ]);
  await db.collection("conversations").createIndexes([{ key: { actorTelegramId: 1 }, unique: true }]);
  await db.collection("superadmin_notes").createIndexes([
    { key: { status: 1, updatedAt: -1 } },
    { key: { createdByTelegramId: 1 } },
  ]);

  await db.collection("crm_students").createIndexes([
    { key: { crmId: 1 }, unique: true },
    { key: { accountCrmId: 1 } },
    { key: { groupCrmId: 1 } },
    { key: { status: 1 } },
    { key: { name: 1 } },
  ]);
  await db.collection("crm_guardians").createIndexes([
    { key: { crmId: 1 }, unique: true },
    { key: { phone: 1 } },
  ]);
  await db.collection("crm_payments").createIndexes([
    { key: { crmId: 1 }, unique: true },
    { key: { clientCrmId: 1 } },
    { key: { purpose: 1, month: 1 } },
  ]);
  await db.collection("crm_schedule_sessions").createIndexes([
    { key: { crmId: 1 }, unique: true },
    { key: { groupCrmId: 1 } },
  ]);
  await db.collection("crm_visit_marks").createIndexes([
    { key: { groupCrmId: 1, clientCrmId: 1, scheduleCrmId: 1 }, unique: true },
    { key: { clientCrmId: 1 } },
  ]);
  await db.collection("crm_catalog_events").createIndexes([
    { key: { kind: 1, crmId: 1 }, unique: true },
    { key: { kind: 1, name: 1 } },
  ]);
  await db.collection("crm_import_reports").createIndexes([{ key: { createdAt: -1 } }]);

  await ensureVectorIndex(db);
}

async function ensureVectorIndex(db: Db): Promise<void> {
  const collection = db.collection("knowledge_chunks");
  try {
    const existing = await collection.listSearchIndexes(VECTOR_INDEX).toArray();
    if (existing.length > 0) {
      return;
    }
  } catch {
    return;
  }

  try {
    await collection.createSearchIndex({
      name: VECTOR_INDEX,
      type: "vectorSearch",
      definition: {
        fields: [
          {
            type: "vector",
            path: "embedding",
            numDimensions: 384,
            similarity: "cosine",
          },
          {
            type: "filter",
            path: "namespace",
          },
        ],
      },
    });
  } catch {
    return;
  }
}

export const KNOWLEDGE_VECTOR_INDEX = VECTOR_INDEX;
