import { Buffer } from "node:buffer";
import { google } from "googleapis";
import { config } from "./config.js";
import { getUserTokens, saveUserTokens } from "./userStore.js";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "openid",
];

export async function generateAuthUrl(state) {
  const oauthClient = await createOAuthClient();
  return oauthClient.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    include_granted_scopes: true,
    state,
  });
}

export async function exchangeCodeForTokens(code) {
  const oauthClient = await createOAuthClient();
  const { tokens } = await oauthClient.getToken(code);
  oauthClient.setCredentials(tokens);

  const oauth2 = google.oauth2({
    version: "v2",
    auth: oauthClient,
  });

  const { data } = await oauth2.userinfo.get();

  if (!data?.id) {
    throw new Error("Unable to retrieve Google user information.");
  }

  return {
    tokens,
    profile: {
      id: data.id,
      email: data.email || "",
      name: data.name || data.email || "",
      picture: data.picture || "",
    },
  };
}

export async function listInboxEmails({
  userId,
  maxResults = config.maxEmails,
  query = "",
  labelIds = [],
  after,
  before,
  excludeIds = [],
  uniqueTarget,
} = {}) {
  const authClient = await getAuthorizedClient(userId);
  const gmail = google.gmail({ version: "v1", auth: authClient });

  const listQuery = buildGmailQuery(query, after, before);

  const targetCount =
    Number.isFinite(uniqueTarget) && uniqueTarget > 0
      ? uniqueTarget
      : Number.isFinite(maxResults) && maxResults > 0
      ? maxResults
      : config.maxEmails;

  const pageSize = Math.min(
    Math.max(
      Number.isFinite(maxResults) && maxResults > 0 ? maxResults : config.maxEmails,
      1
    ),
    500
  );

  const exclusionSet = new Set(
    Array.isArray(excludeIds)
      ? excludeIds
      : excludeIds instanceof Set
      ? Array.from(excludeIds)
      : []
  );

  const processedIds = new Set();
  const messageSummaries = [];
  let pageToken;

  while (messageSummaries.length < targetCount) {
    const response = await gmail.users.messages.list({
      userId: "me",
      maxResults: pageSize,
      q: listQuery || undefined,
      labelIds:
        Array.isArray(labelIds) && labelIds.length > 0 ? labelIds : undefined,
      pageToken,
    });

    const messages = response.data.messages || [];
    if (!messages.length) break;

    for (const message of messages) {
      if (processedIds.has(message.id)) continue;
      processedIds.add(message.id);

      if (exclusionSet.has(message.id)) continue;

      messageSummaries.push(message);
      if (messageSummaries.length >= targetCount) break;
    }

    if (!response.data.nextPageToken) break;
    pageToken = response.data.nextPageToken;
  }

  if (!messageSummaries.length) return [];

  const detailedMessages = await Promise.all(
    messageSummaries.map(async (message) => {
      const messageData = await gmail.users.messages.get({
        userId: "me",
        id: message.id,
        format: "full",
      });

      const headers = messageData.data.payload?.headers || [];
      return {
        id: message.id,
        threadId: messageData.data.threadId,
        labelIds: messageData.data.labelIds || [],
        subject: extractHeader(headers, "Subject") || "(no subject)",
        from: extractHeader(headers, "From") || "Unknown sender",
        date: extractHeader(headers, "Date") || null,
        snippet: messageData.data.snippet || "",
        body: extractEmailBody(messageData.data.payload),
      };
    })
  );

  return detailedMessages;
}

export async function getThreadMessages({ userId, threadId }) {
  if (!threadId) {
    throw new Error("Thread id is required.");
  }

  const authClient = await getAuthorizedClient(userId);
  const gmail = google.gmail({ version: "v1", auth: authClient });

  const response = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full",
  });

  const messages = response.data?.messages ?? [];

  const normalizedMessages = messages.map((message) => {
    const headers = message.payload?.headers || [];
    const headerDate = extractHeader(headers, "Date");
    const parsedHeaderDate = headerDate ? Date.parse(headerDate) : Number.NaN;
    const internalDate = message.internalDate
      ? Number.parseInt(message.internalDate, 10)
      : Number.NaN;
    const timestamp = Number.isNaN(parsedHeaderDate)
      ? (Number.isFinite(internalDate) ? internalDate : null)
      : parsedHeaderDate;
    const isoDate = Number.isFinite(timestamp)
      ? new Date(timestamp).toISOString()
      : null;

    return {
      id: message.id,
      threadId: message.threadId || response.data?.id || threadId,
      subject: extractHeader(headers, "Subject") || "(no subject)",
      from: extractHeader(headers, "From") || "Unknown sender",
      to: extractHeader(headers, "To") || "",
      cc: extractHeader(headers, "Cc") || "",
      snippet: message.snippet || "",
      body: extractEmailBody(message.payload),
      labelIds: message.labelIds || [],
      date: isoDate,
      headerDate: headerDate || null,
      timestamp,
    };
  });

  normalizedMessages.sort((a, b) => {
    const aTime = Number.isFinite(a.timestamp) ? a.timestamp : 0;
    const bTime = Number.isFinite(b.timestamp) ? b.timestamp : 0;
    return aTime - bTime;
  });

  return normalizedMessages;
}

async function getAuthorizedClient(userId) {
  if (!userId) {
    throw new Error("Missing user identifier.");
  }

  const tokens = await getUserTokens(userId);
  if (!tokens) {
    throw new Error("No stored Gmail credentials for this user. Please sign in.");
  }

  const oauthClient = await createOAuthClient();
  oauthClient.setCredentials(tokens);
  oauthClient.on("tokens", (nextTokens) => {
    if (!nextTokens) return;
    const combined = {
      ...oauthClient.credentials,
      ...nextTokens,
    };
    saveUserTokens(userId, combined).catch((error) => {
      console.warn("Failed to persist refreshed tokens", error);
    });
  });
  return oauthClient;
}

// ✅ Updated version (replaces old readJSON + createOAuthClient)
async function createOAuthClient() {
  const credentials = await loadCredentials();
  const { client_id, client_secret, redirect_uris } =
    credentials.installed || credentials.web || {};

  if (!client_id || !client_secret || !redirect_uris?.length) {
    throw new Error(
      "Invalid OAuth2 credentials. Ensure credentials.json contains client_id, client_secret, and redirect URIs."
    );
  }

  return new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
}

async function loadCredentials() {
  // ✅ Prefer environment variable (for Vercel)
  if (process.env.GOOGLE_CREDENTIALS) {
    return JSON.parse(process.env.GOOGLE_CREDENTIALS);
  }

  // 🧩 Fallback for local dev
  const fs = await import("fs/promises");
  const content = await fs.readFile(config.credentialsPath, "utf-8");
  return JSON.parse(content);
}

function extractHeader(headers, name) {
  return headers.find((header) => header.name === name)?.value || null;
}

function buildGmailQuery(query, after, before) {
  const parts = [];

  if (query && query.trim()) parts.push(query.trim());
  if (after instanceof Date && !Number.isNaN(after.getTime())) {
    const afterSeconds = Math.floor(after.getTime() / 1000);
    parts.push(`after:${afterSeconds}`);
  }
  if (before instanceof Date && !Number.isNaN(before.getTime())) {
    const beforeSeconds = Math.floor(before.getTime() / 1000);
    parts.push(`before:${beforeSeconds}`);
  }

  return parts.join(" ").trim();
}

function extractEmailBody(payload) {
  if (!payload) return "";

  const result = { html: null, text: null };

  const collectBody = (part) => {
    if (!part) return;

    const mime = (part.mimeType || "").toLowerCase();
    const data = part.body?.data ? decodeBase64(part.body.data) : undefined;

    if (mime === "text/html" && data && !result.html) {
      result.html = data.trim();
    } else if (mime === "text/plain" && data && !result.text) {
      result.text = data.trim();
    } else if (mime.startsWith("multipart/") && part.parts?.length) {
      part.parts.forEach(collectBody);
    } else if (!mime && part.parts?.length) {
      part.parts.forEach(collectBody);
    }
  };

  collectBody(payload);

  if (!result.html && !result.text && payload.body?.data) {
    const inline = decodeBase64(payload.body.data).trim();
    if (inline) {
      if (payload.mimeType === "text/html") result.html = inline;
      else result.text = inline;
    }
  }

  return (result.html || result.text || "").trim();
}

function decodeBase64(data) {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf-8");
}
