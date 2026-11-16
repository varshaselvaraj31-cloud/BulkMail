require("dotenv").config();

const cors = require("cors");
const express = require("express");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const { timingSafeEqual } = require("node:crypto");
const EmailRecord = require("./models/EmailRecord");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
// Render sets RENDER=true, Vercel sets NODE_ENV=production. In production we
// never fall back to localhost defaults: a missing value must be visible.
const isProduction = process.env.NODE_ENV === "production" || Boolean(process.env.RENDER);
const port = Number(process.env.PORT) || 5001;
const mongoUri = process.env.MONGODB_URI || (isProduction ? "" : "mongodb://127.0.0.1:27017/bulkmail");
const localOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];
const allowedOrigins = parseOrigins(process.env.CLIENT_ORIGIN, isProduction ? [] : localOrigins);
const originMatchers = allowedOrigins.map(createOriginMatcher);

// "https://a.vercel.app, https://bulk-mail-*.vercel.app/" ->
// ["https://a.vercel.app", "https://bulk-mail-*.vercel.app"]
function parseOrigins(value, fallback) {
  const origins = String(value || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  for (const origin of fallback) {
    if (!origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Exact match by default. A "*" matches one DNS label, so
// "https://bulk-mail-*.vercel.app" also covers Vercel preview deployments.
function createOriginMatcher(entry) {
  const normalized = entry.toLowerCase();
  if (!normalized.includes("*")) {
    return (origin) => origin === normalized;
  }
  const pattern = normalized.split("*").map(escapeRegExp).join("[a-z0-9-]+");
  const expression = new RegExp(`^${pattern}$`);
  return (origin) => expression.test(origin);
}

function isAllowedOrigin(origin) {
  const normalized = String(origin).toLowerCase().replace(/\/+$/, "");
  return originMatchers.some((matches) => matches(normalized));
}

const corsOptions = {
  origin(origin, callback) {
    // No Origin header: same-origin, curl, health checks. Nothing to allow.
    if (!origin || isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    console.warn(
      `CORS: blocked origin ${origin}. Allowed origins: ${allowedOrigins.join(", ") || "(none, set CLIENT_ORIGIN)"}.`,
    );
    return callback(null, false);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 600,
};

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

const readyStates = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };

// Last failed connection attempt, shown in /api/health so a misconfigured
// deployment can be diagnosed from the browser. Credentials are stripped.
let lastDatabaseError = null;

function sanitizeErrorMessage(message) {
  return String(message || "").replace(/\/\/[^@\s/]+@/g, "//<credentials>@");
}

function databaseStatus() {
  if (!mongoUri) return "not configured";
  return readyStates[mongoose.connection.readyState] || "unknown";
}

function requireDatabase(_req, res, next) {
  if (mongoose.connection.readyState === 1) {
    return next();
  }
  const message =
    databaseStatus() === "not configured"
      ? "Database is not configured. Set MONGODB_URI on the backend."
      : "Database is not available yet. Try again in a moment.";
  return res.status(503).json({ message });
}

function matchesCredential(candidate, expected) {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return candidateBuffer.length === expectedBuffer.length && timingSafeEqual(candidateBuffer, expectedBuffer);
}

function requireAdmin(req, res, next) {
  const adminUser = process.env.ADMIN_USER;
  const adminPass = process.env.ADMIN_PASS;
  if (!adminUser || !adminPass) {
    return res.status(503).json({ message: "Admin sign-in is not configured. Set ADMIN_USER and ADMIN_PASS on the backend." });
  }

  const authorization = req.get("authorization") || "";
  if (!authorization.startsWith("Basic ")) {
    return res.status(401).json({ message: "Sign in to access email campaigns." });
  }

  const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 0) {
    return res.status(401).json({ message: "Invalid admin credentials." });
  }

  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  if (!matchesCredential(username, adminUser) || !matchesCredential(password, adminPass)) {
    return res.status(401).json({ message: "Invalid admin credentials." });
  }

  return next();
}

function getRecipients(value) {
  if (typeof value !== "string") {
    return [];
  }

  return [...new Set(value.split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))];
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

let transporter;
function getTransporter() {
  transporter ??= nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
  return transporter;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get("/", (_req, res) => {
  res.json({ service: "bulkmail-api", status: "ok", health: "/api/health" });
});

// Liveness: always 200 while the process runs, with enough detail to debug a
// deployment from the browser without reading logs.
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
    database: databaseStatus(),
    databaseError: req.databaseConnectionError || lastDatabaseError,
    mailConfigured: Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS),
    adminConfigured: Boolean(process.env.ADMIN_USER && process.env.ADMIN_PASS),
    allowedOrigins,
  });
});

// Readiness: 200 only when requests that need the database can succeed.
app.get("/api/ready", (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({ ready, database: databaseStatus() });
});

app.get("/api/emails", requireAdmin, requireDatabase, async (_req, res) => {
  try {
    const records = await EmailRecord.aggregate([
      { $sort: { createdAt: -1 } },
      { $limit: 50 },
      {
        $project: {
          subject: 1,
          status: 1,
          error: 1,
          createdAt: 1,
          recipientCount: { $size: "$recipients" },
        },
      },
    ]);
    return res.json({ emails: records });
  } catch (error) {
    console.error("Could not load email history:", error);
    return res.status(500).json({ message: "Could not load email history." });
  }
});

app.post("/api/emails", requireAdmin, requireDatabase, async (req, res) => {
  const payload = req.body || {};
  const subject = typeof payload.subject === "string" ? payload.subject.trim() : "";
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  const recipients = getRecipients(payload.recipients);

  if (!subject || subject.length > 200) {
    return res.status(400).json({ message: "Enter a subject between 1 and 200 characters." });
  }
  if (!body || body.length > 20000) {
    return res.status(400).json({ message: "Enter an email body between 1 and 20,000 characters." });
  }
  if (recipients.length === 0 || recipients.length > 100) {
    return res.status(400).json({ message: "Enter between 1 and 100 recipient email addresses." });
  }
  if (recipients.some((email) => !isValidEmail(email))) {
    return res.status(400).json({ message: "One or more recipient email addresses are invalid." });
  }
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return res.status(503).json({ message: "Email delivery is not configured. Set EMAIL_USER and EMAIL_PASS on the backend." });
  }

  let record;
  try {
    record = await EmailRecord.create({ subject, body, recipients, status: "sending" });
  } catch (error) {
    console.error("Could not save email record:", error);
    return res.status(500).json({ message: "Could not save the email before sending." });
  }

  try {
    const info = await getTransporter().sendMail({
      from: { name: "BulkMail", address: process.env.EMAIL_USER },
      to: process.env.EMAIL_USER,
      bcc: recipients,
      subject,
      text: body,
    });

    record.status = "sent";
    record.messageId = info.messageId;
    record.sentAt = new Date();
    await record.save();
    return res.status(201).json({ message: `Email sent to ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}.`, email: record });
  } catch (error) {
    console.error("Email delivery failed:", error);
    record.status = "failed";
    record.error = error.message || "Email delivery failed.";
    await record.save();
    return res.status(502).json({ message: "Email delivery failed. Check the backend mail configuration and try again.", email: record });
  }
});

app.use("/api", (_req, res) => {
  res.status(404).json({ message: "Not found." });
});

app.use((error, _req, res, _next) => {
  const status = Number(error.status || error.statusCode) || 500;
  if (status >= 500) {
    console.error("Request failed:", error);
  }
  return res.status(status).json({ message: status >= 500 ? "Something went wrong on the server." : "Invalid request." });
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
// The HTTP server starts immediately and MongoDB connects in the background
// with retries. A bad MONGODB_URI then shows up in /api/health and in the logs
// instead of as a crash loop where the host never sees an open port.
function describeMongoHost(uri) {
  try {
    return new URL(uri).hostname || "configured host";
  } catch {
    return "configured host";
  }
}

function explainMongoError(error) {
  const message = String((error && error.message) || "");
  if (/ECONNREFUSED/.test(message) && /127\.0\.0\.1|localhost/.test(message)) {
    return "MONGODB_URI points at localhost. On Render or Vercel set it to your MongoDB Atlas connection string.";
  }
  if (/bad auth|Authentication failed/i.test(message)) {
    return "Atlas rejected the database user or password. Check Database Access in Atlas and the credentials inside MONGODB_URI.";
  }
  if (/Could not connect to any servers|whitelist/i.test(message)) {
    return "Atlas is not reachable from this host. In Atlas Network Access allow 0.0.0.0/0 (Render free tier has no fixed IP).";
  }
  if (/ENOTFOUND|querySrv|EAI_AGAIN/i.test(message)) {
    return "The cluster host name inside MONGODB_URI could not be resolved. Check it for typos.";
  }
  return "";
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectDatabase() {
  if (!mongoUri) {
    console.error("MONGODB_URI is not set. The API is running, but email history and sending stay disabled until it is configured.");
    return;
  }

  for (let attempt = 1; ; attempt += 1) {
    try {
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
      lastDatabaseError = null;
      console.log(`MongoDB connected to ${describeMongoHost(mongoUri)}.`);
      return;
    } catch (error) {
      const delaySeconds = Math.min(30, 5 * attempt);
      const message = sanitizeErrorMessage(error.message);
      const hint = explainMongoError(error);
      lastDatabaseError = { attempt, message, hint: hint || undefined, at: new Date().toISOString() };
      console.error(`MongoDB connection attempt ${attempt} failed: ${message}`);
      if (hint) {
        console.error(`Hint: ${hint}`);
      }
      console.error(`Retrying in ${delaySeconds}s.`);
      await sleep(delaySeconds * 1000);
    }
  }
}

function startServer() {
  if (isProduction && allowedOrigins.length === 0) {
    console.warn("CLIENT_ORIGIN is not set. Browsers on other origins will be blocked by CORS. Set it to your frontend URL, for example https://your-app.vercel.app");
  }

  const server = app.listen(port, () => {
    console.log(`Bulk Mail API listening on port ${port}`);
    console.log(`Allowed origins: ${allowedOrigins.join(", ") || "(none)"}`);
  });

  let hasConnected = false;
  mongoose.connection.on("connected", () => {
    hasConnected = true;
  });
  mongoose.connection.on("disconnected", () => {
    if (hasConnected) console.warn("MongoDB disconnected.");
  });
  mongoose.connection.on("reconnected", () => console.log("MongoDB reconnected."));
  connectDatabase();

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down.`);
    server.close(() => {
      mongoose.connection.close(false).finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

if (require.main === module) {
  startServer();
}

module.exports = app;
