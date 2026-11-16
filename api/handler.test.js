const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const mongoose = require("mongoose");

process.env.NODE_ENV = "production";
process.env.MONGODB_URI = "mongodb://db-user:test-secret@localhost:27017/bulkmail";
process.env.ADMIN_USER = "admin";
process.env.ADMIN_PASS = "test-password";

const handler = require("./[...path].js");
const originalConnect = mongoose.connect;
let server;
let baseUrl;

test.before(async () => {
  mongoose.connect = async () => {
    throw new Error("Authentication failed for mongodb://db-user:test-secret@localhost:27017/bulkmail");
  };
  server = http.createServer((req, res) => {
    res.status = (status) => {
      res.statusCode = status;
      return res;
    };
    res.json = (body) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(body));
    };
    handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  mongoose.connect = originalConnect;
  await new Promise((resolve) => server.close(resolve));
});

function request(path) {
  return new Promise((resolve, reject) => {
    http.get(`${baseUrl}${path}`, { agent: false }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(data) }));
    }).on("error", reject);
  });
}

test("health endpoint reports a sanitized MongoDB connection error", async () => {
  const response = await request("/api/health");

  assert.equal(response.status, 200);
  assert.equal(response.json.database, "disconnected");
  assert.match(response.json.databaseError.message, /Authentication failed/);
  assert.doesNotMatch(response.json.databaseError.message, /test-secret/);
});

test("database-dependent routes keep the generic unavailable response", async () => {
  const response = await request("/api/emails");

  assert.equal(response.status, 503);
  assert.deepEqual(response.json, { message: "Database is unavailable." });
});
