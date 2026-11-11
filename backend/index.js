require("dotenv").config();

const cors = require("cors");
const express = require("express");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const { timingSafeEqual } = require("node:crypto");
const EmailRecord = require("./models/EmailRecord");

const app = express();
const port = Number(process.env.PORT) || 5001;
const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/bulkmail";
const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "1mb" }));

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

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    mailConfigured: Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS),
  });
});

app.get("/api/emails", requireAdmin, async (_req, res) => {
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

app.post("/api/emails", requireAdmin, async (req, res) => {
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
    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
    const info = await transporter.sendMail({
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

app.use((error, _req, res, _next) => {
  console.error("Request failed:", error);
  return res.status(400).json({ message: "Invalid request." });
});

mongoose
  .connect(mongoUri)
  .then(() => {
    app.listen(port, () => {
      console.log(`Bulk Mail API listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error(`Could not connect to MongoDB at ${mongoUri}:`, error.message);
    process.exitCode = 1;
  });
