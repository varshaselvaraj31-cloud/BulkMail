const mongoose = require("mongoose");
const app = require("../backend");

let connectionPromise;

function isHealthRequest(req) {
  const path = (req.url || "").split("?")[0];
  return req.method === "GET" && path === "/api/health";
}

function sanitizeErrorMessage(message) {
  return String(message || "").replace(/\/\/[^@\s/]+@/g, "//<credentials>@");
}

module.exports = async function handler(req, res) {
  const healthRequest = isHealthRequest(req);

  if (mongoose.connection.readyState !== 1) {
    if (!process.env.MONGODB_URI) {
      if (healthRequest) {
        return app(req, res);
      }
      return res.status(503).json({ message: "Database is not configured." });
    }

    connectionPromise ??= mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 }).catch((error) => {
      connectionPromise = undefined;
      throw error;
    });

    try {
      await connectionPromise;
      if (app.mongoose && app.mongoose !== mongoose && app.mongoose.connection.readyState !== 1) {
        await app.mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
      }
    } catch (error) {
      const message = sanitizeErrorMessage(error.message);
      console.error("Could not connect to MongoDB:", message);
      if (healthRequest) {
        req.databaseConnectionError = {
          message,
          at: new Date().toISOString(),
        };
        return app(req, res);
      }
      return res.status(503).json({ message: "Database is unavailable." });
    }
  }

  return app(req, res);
};
