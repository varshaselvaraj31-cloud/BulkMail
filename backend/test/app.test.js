const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

// Configure before the app module reads its environment. No database is
// needed: these tests cover startup, CORS, auth and the degraded-DB behaviour.
process.env.NODE_ENV = "production";
process.env.MONGODB_URI = "";
process.env.CLIENT_ORIGIN = "https://frontend.example.com/, https://bulk-mail-*.example.app";
process.env.ADMIN_USER = "admin";
process.env.ADMIN_PASS = "test-password";

const app = require("../index.js");

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

function request(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${baseUrl}${path}`, { method, headers }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let json;
        try {
          json = data ? JSON.parse(data) : undefined;
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode, headers: res.headers, json, text: data });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const basic = (user, pass) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

const preflight = (origin) =>
  request("OPTIONS", "/api/emails", {
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  });

test("root and health respond without a database", async () => {
  const root = await request("GET", "/");
  assert.equal(root.status, 200);
  assert.equal(root.json.service, "bulkmail-api");

  const health = await request("GET", "/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.json.status, "ok");
  assert.equal(health.json.database, "not configured");
  assert.equal(health.json.databaseError, null);
  assert.equal(health.json.adminConfigured, true);
  assert.deepEqual(health.json.allowedOrigins, ["https://frontend.example.com", "https://bulk-mail-*.example.app"]);

  const ready = await request("GET", "/api/ready");
  assert.equal(ready.status, 503);
  assert.equal(ready.json.ready, false);
});

test("preflight succeeds for the configured origin", async () => {
  const res = await preflight("https://frontend.example.com");
  assert.equal(res.status, 204);
  assert.equal(res.headers["access-control-allow-origin"], "https://frontend.example.com");
  assert.match(res.headers["access-control-allow-headers"], /Authorization/);
  assert.match(res.headers["access-control-allow-methods"], /GET/);
});

test("preflight succeeds for a wildcard (preview) origin", async () => {
  const res = await preflight("https://bulk-mail-git-feature-team.example.app");
  assert.equal(res.status, 204);
  assert.equal(res.headers["access-control-allow-origin"], "https://bulk-mail-git-feature-team.example.app");
});

test("origins that are not configured get no CORS headers", async () => {
  for (const origin of ["https://evil.example.net", "http://frontend.example.com", "https://frontend.example.com.evil.net"]) {
    const res = await preflight(origin);
    assert.equal(res.headers["access-control-allow-origin"], undefined, `${origin} must be blocked`);
  }
});

test("email routes require valid admin credentials", async () => {
  const anonymous = await request("GET", "/api/emails");
  assert.equal(anonymous.status, 401);

  const wrong = await request("GET", "/api/emails", { headers: { Authorization: basic("admin", "nope") } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.json.message, "Invalid admin credentials.");
});

test("authenticated requests get a clear 503 while the database is unavailable", async () => {
  const res = await request("GET", "/api/emails", { headers: { Authorization: basic("admin", "test-password") } });
  assert.equal(res.status, 503);
  assert.match(res.json.message, /MONGODB_URI/);
});

test("malformed JSON is a 400, unknown API paths are a 404", async () => {
  const bad = await request("POST", "/api/emails", {
    headers: { Authorization: basic("admin", "test-password"), "Content-Type": "application/json" },
    body: "{not json",
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.message, "Invalid request.");

  const missing = await request("GET", "/api/nope");
  assert.equal(missing.status, 404);
  assert.equal(missing.json.message, "Not found.");
});
