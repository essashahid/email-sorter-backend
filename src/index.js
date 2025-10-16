import express from "express";
import cors from "cors";
import morgan from "morgan";
import open from "open";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { config } from "./config.js";
import {
  generateAuthUrl,
  exchangeCodeForTokens,
  listInboxEmails,
  getThreadMessages,
} from "./gmailClient.js";
import {
  getClassifications,
  upsertClassification,
} from "./classificationStore.js";
import {
  getUserById,
  getUserTokens,
  upsertUserRecord,
} from "./userStore.js";

const SESSION_COOKIE = "triage_session";
const STATE_COOKIE = "oauth_state";

const app = express();

app.use(
  cors({
    origin: config.clientOrigin.replace(/\/$/, ""), 
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(morgan("dev"));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/auth", async (req, res, next) => {
  try {
    const state = crypto.randomBytes(16).toString("hex");
    res.cookie(STATE_COOKIE, state, {
      ...stateCookieOptions(),
      maxAge: 10 * 60 * 1000,
    });

    const authUrl = await generateAuthUrl(state);
    if (process.env.AUTO_OPEN_AUTH === "true") {
      await open(authUrl, { wait: false });
    }

    res.redirect(authUrl);
  } catch (error) {
    next(error);
  }
});

app.get("/auth/callback", async (req, res, next) => {
  const state = req.query.state;
  const storedState = req.cookies?.[STATE_COOKIE];
  const code = req.query.code;

  res.clearCookie(STATE_COOKIE, {
    ...stateCookieOptions(),
    maxAge: undefined,
  });

  if (!state || !storedState || state !== storedState) {
    res.status(400).send("Invalid OAuth state.");
    return;
  }

  if (!code) {
    res.status(400).send("Missing authorization code.");
    return;
  }

  try {
    const { tokens, profile } = await exchangeCodeForTokens(code);

    await upsertUserRecord({
      id: profile.id,
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
      tokens,
    });

    setSessionCookie(res, profile.id);
    res.redirect(config.clientOrigin);
  } catch (error) {
    next(error);
  }
});

app.post("/logout", (req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

app.get("/me", async (req, res) => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ user: null });
    return;
  }
  res.json({ user: toPublicUser(user) });
});

app.get("/emails", async (req, res, next) => {
  const user = await requireUser(req, res);
  if (!user) {
    return;
  }

  const maxResults = Number.parseInt(req.query.maxResults, 10);
  const limit = Number.isFinite(maxResults) ? maxResults : undefined;

  const search = typeof req.query.search === "string" ? req.query.search : "";
  const labelIds = parseLabelIds(req.query.labelIds);
  const since = parseDate(req.query.since);
  const until = parseDate(req.query.until);

  try {
    const classificationItems = await getClassifications({
      user: user.id,
    });
    const excludeIds = classificationItems
      .map((item) => item.id)
      .filter(Boolean);

    const targetUnique = Number.isFinite(limit) ? limit : config.maxEmails;

    const emails = await listInboxEmails({
      userId: user.id,
      maxResults: limit,
      query: search,
      labelIds,
      after: since,
      before: until,
      excludeIds,
      uniqueTarget: targetUnique,
    });

    res.json({
      emails,
      requested: targetUnique,
      delivered: emails.length,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/classifications", async (req, res, next) => {
  const user = await requireUser(req, res);
  if (!user) {
    return;
  }

  try {
    const { label } = req.query;
    const items = await getClassifications({
      label,
      user: user.id,
    });
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

app.post("/classifications", async (req, res, next) => {
  const user = await requireUser(req, res);
  if (!user) {
    return;
  }

  try {
    const classification = await upsertClassification({
      ...req.body,
      user: user.id,
    });
    res.status(201).json({ item: classification });
  } catch (error) {
    next(error);
  }
});

app.get("/threads/:threadId", async (req, res, next) => {
  const user = await requireUser(req, res);
  if (!user) {
    return;
  }

  const threadId = req.params.threadId;
  if (!threadId) {
    res.status(400).json({ error: "Thread id is required." });
    return;
  }

  try {
    const messages = await getThreadMessages({
      userId: user.id,
      threadId,
    });
    res.json({ messages });
  } catch (error) {
    next(error);
  }
});

app.use((err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({
    error: err.message || "Unexpected server error",
  });
});

app.listen(config.port, () => {
  console.log(`🚀 Email Sorter backend listening on port ${config.port}`);
});

async function requireUser(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
  }
  return user;
}

async function getAuthenticatedUser(req) {
  const sessionToken = req.cookies?.[SESSION_COOKIE];
  if (!sessionToken) {
    return null;
  }

  try {
    const payload = jwt.verify(sessionToken, config.sessionSecret);
    if (!payload?.userId) {
      return null;
    }

    const user = await getUserById(payload.userId);
    if (!user) {
      return null;
    }

    const tokens = await getUserTokens(user.id);
    if (!tokens) {
      return null;
    }

    return user;
  } catch (error) {
    return null;
  }
}

function setSessionCookie(res, userId) {
  const token = jwt.sign(
    { userId },
    config.sessionSecret,
    { expiresIn: "30d" }
  );

  res.cookie(SESSION_COOKIE, token, {
    ...sessionCookieOptions(),
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, {
    ...sessionCookieOptions(),
    maxAge: undefined,
  });
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: config.isProduction ? "none" : "lax",
    secure: config.isProduction,
    path: "/",
  };
}

function stateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: config.isProduction ? "none" : "lax",
    secure: config.isProduction,
    path: "/",
  };
}

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
  };
}

function parseLabelIds(raw) {
  if (!raw) {
    return [];
  }

  if (Array.isArray(raw)) {
    return raw
      .flatMap((value) => value.split(","))
      .map((label) => label.trim())
      .filter(Boolean);
  }

  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean);
  }

  return [];
}

function parseDate(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    return undefined;
  }

  const timestamp = Date.parse(raw);
  if (Number.isNaN(timestamp)) {
    return undefined;
  }

  return new Date(timestamp);
}
