import fs from "fs/promises";
import path from "path";
import { config } from "./config.js";

const EMPTY_STORE = { items: [] };

export async function upsertClassification(entry) {
  const store = await loadStore();
  const normalizedLabel = entry.label?.toLowerCase();
  const normalizedUser =
    typeof entry.user === "string" ? entry.user.trim() : "";

  if (!normalizedUser) {
    throw new Error("Classification requires a user identifier.");
  }

  if (!["good", "bad"].includes(normalizedLabel)) {
    throw new Error('Classification label must be either "good" or "bad".');
  }

  const timestamp = new Date().toISOString();
  const existingIndex = store.items.findIndex(
    (item) => item.id === entry.id && item.user === normalizedUser
  );

  const payload = {
    id: entry.id,
    label: normalizedLabel,
    subject: entry.subject || "(no subject)",
    from: entry.from || "Unknown sender",
    snippet: entry.snippet || "",
    date: entry.date || null,
    body: entry.body || "",
    labelIds: Array.isArray(entry.labelIds) ? entry.labelIds : [],
    updatedAt: timestamp,
    user: normalizedUser,
  };

  if (existingIndex >= 0) {
    store.items[existingIndex] = { ...store.items[existingIndex], ...payload };
  } else {
    store.items.push({ ...payload, createdAt: timestamp });
  }

  await persistStore(store);
  return payload;
}

export async function getClassifications({ label, user } = {}) {
  const store = await loadStore();
  const normalizedLabel =
    typeof label === "string" && label.trim()
      ? label.trim().toLowerCase()
      : null;
  const normalizedUser =
    typeof user === "string" && user.trim() ? user.trim() : null;

  return store.items.filter((item) => {
    if (normalizedUser && item.user !== normalizedUser) return false;
    if (normalizedLabel && item.label !== normalizedLabel) return false;
    return true;
  });
}

async function loadStore() {
  try {
    const raw = await fs.readFile(config.classificationStorePath, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      await ensureStore();
      return EMPTY_STORE;
    }
    throw error;
  }
}

async function persistStore(store) {
  await ensureStore();
  const serialized = JSON.stringify(store, null, 2);
  await fs.writeFile(config.classificationStorePath, serialized);
}

async function ensureStore() {
  const dir = path.dirname(config.classificationStorePath);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(config.classificationStorePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.writeFile(
        config.classificationStorePath,
        JSON.stringify(EMPTY_STORE, null, 2)
      );
    } else {
      throw error;
    }
  }
}
