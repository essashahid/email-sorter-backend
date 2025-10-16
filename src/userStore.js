import fs from "fs/promises";
import path from "path";
import { config } from "./config.js";

const EMPTY_STORE = { users: [] };

export async function upsertUserRecord({ id, email, name, picture, tokens }) {
  if (!id) {
    throw new Error("User id is required to upsert a user.");
  }

  const store = await loadStore();
  const existingIndex = store.users.findIndex((user) => user.id === id);
  const timestamp = new Date().toISOString();

  const mergedTokens = mergeTokens(
    existingIndex >= 0 ? store.users[existingIndex].tokens : {},
    tokens || {}
  );

  const payload = {
    id,
    email: email || "",
    name: name || "",
    picture: picture || "",
    tokens: mergedTokens,
    updatedAt: timestamp,
  };

  if (existingIndex >= 0) {
    store.users[existingIndex] = {
      ...store.users[existingIndex],
      ...payload,
    };
  } else {
    store.users.push({
      ...payload,
      createdAt: timestamp,
    });
  }

  await persistStore(store);
  return store.users.find((user) => user.id === id);
}

export async function saveUserTokens(userId, tokens) {
  if (!userId) {
    throw new Error("User id is required to save tokens.");
  }

  const store = await loadStore();
  const existingIndex = store.users.findIndex((user) => user.id === userId);
  if (existingIndex < 0) {
    throw new Error("Cannot save tokens for unknown user.");
  }

  const mergedTokens = mergeTokens(store.users[existingIndex].tokens, tokens);
  store.users[existingIndex] = {
    ...store.users[existingIndex],
    tokens: mergedTokens,
    updatedAt: new Date().toISOString(),
  };
  await persistStore(store);
  return store.users[existingIndex];
}

export async function getUserById(userId) {
  if (!userId) return null;

  const store = await loadStore();
  return store.users.find((user) => user.id === userId) || null;
}

export async function getUserTokens(userId) {
  const user = await getUserById(userId);
  return user?.tokens || null;
}

async function loadStore() {
  try {
    const raw = await fs.readFile(config.userStorePath, "utf-8");
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
  await fs.writeFile(config.userStorePath, serialized);
}

async function ensureStore() {
  const dir = path.dirname(config.userStorePath);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(config.userStorePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.writeFile(
        config.userStorePath,
        JSON.stringify(EMPTY_STORE, null, 2)
      );
    } else {
      throw error;
    }
  }
}

function mergeTokens(existing = {}, next = {}) {
  const merged = { ...existing, ...next };
  if (typeof merged.expiry_date === "string") {
    merged.expiry_date = Number.parseInt(merged.expiry_date, 10);
  }
  return merged;
}
