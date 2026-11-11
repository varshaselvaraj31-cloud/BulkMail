const mongoose = require("mongoose");
const app = require("../backend");

let connectionPromise;

module.exports = async function handler(req, res) {
  if (mongoose.connection.readyState !== 1) {
    if (!process.env.MONGODB_URI) {
      return res.status(503).json({ message: "Database is not configured." });
    }

    connectionPromise ??= mongoose.connect(process.env.MONGODB_URI).catch((error) => {
      connectionPromise = undefined;
      throw error;
    });

    try {
      await connectionPromise;
    } catch (error) {
      console.error("Could not connect to MongoDB:", error.message);
      return res.status(503).json({ message: "Database is unavailable." });
    }
  }

  return app(req, res);
};
