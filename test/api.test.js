// api.test.js — integration tests for the registry API and security guard.
// Run with: npm test (node --test, requires Node 18+)

const { describe, it, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const supertest = require("supertest");
const fsp = require("fs/promises");
const path = require("path");

const APPS_FILE = path.join(__dirname, "..", "apps.json");

// Import app without starting the HTTP server.
const { app } = require("../server");
const request = supertest(app);

const EMPTY = JSON.stringify({ apps: [] }, null, 2);

const SAMPLE_APP = {
  name: "Test App",
  description: "A test app",
  port: 8099,
  privateUrl: "http://localhost:8099",
  category: "Tools",
  icon: "🧪",
};

const SECURITY_APP = {
  name: "Password Manager",
  description: "Secure vault",
  port: 8080,
  privateUrl: "http://localhost:8080",
  category: "Security",
  icon: "🔐",
};

let savedRegistry;

before(async () => {
  savedRegistry = await fsp.readFile(APPS_FILE, "utf8").catch(() => EMPTY);
});

after(async () => {
  await fsp.writeFile(APPS_FILE, savedRegistry);
});

async function resetRegistry(data = { apps: [] }) {
  await fsp.writeFile(APPS_FILE, JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// Hub self-health
// ---------------------------------------------------------------------------

describe("GET /health", () => {
  it("returns 200 ok", async () => {
    const res = await request.get("/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
    assert.equal(res.body.app, "tailscale-hub");
  });
});

// ---------------------------------------------------------------------------
// Apps registry — CRUD
// ---------------------------------------------------------------------------

describe("GET /api/apps", () => {
  beforeEach(resetRegistry);

  it("returns empty list when registry is empty", async () => {
    const res = await request.get("/api/apps");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.apps, []);
  });
});

describe("POST /api/apps", () => {
  beforeEach(resetRegistry);

  it("creates a new app with derived id", async () => {
    const res = await request.post("/api/apps").send(SAMPLE_APP);
    assert.equal(res.status, 201);
    assert.equal(res.body.id, "test-app");
    assert.equal(res.body.name, "Test App");
    assert.equal(res.body.port, 8099);
    assert.equal(res.body.funnelEnabled, false);
    assert.equal(res.body.publicUrl, null);
  });

  it("rejects missing name", async () => {
    const res = await request
      .post("/api/apps")
      .send({ port: 8099, privateUrl: "http://localhost:8099" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /name/);
  });

  it("rejects missing privateUrl", async () => {
    const res = await request
      .post("/api/apps")
      .send({ name: "No URL", port: 8099 });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /privateUrl/);
  });

  it("rejects invalid port", async () => {
    const res = await request
      .post("/api/apps")
      .send({ ...SAMPLE_APP, port: 99999 });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /port/);
  });

  it("rejects duplicate port", async () => {
    await request.post("/api/apps").send(SAMPLE_APP);
    const res = await request
      .post("/api/apps")
      .send({ ...SAMPLE_APP, name: "Another App" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /port/);
  });

  it("rejects duplicate id", async () => {
    await request.post("/api/apps").send(SAMPLE_APP);
    const res = await request
      .post("/api/apps")
      .send({ ...SAMPLE_APP, port: 8100 });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /id/);
  });
});

describe("PUT /api/apps/:id", () => {
  beforeEach(async () => {
    await resetRegistry();
    await request.post("/api/apps").send(SAMPLE_APP);
  });

  it("updates an existing app", async () => {
    const res = await request
      .put("/api/apps/test-app")
      .send({ name: "Renamed App" });
    assert.equal(res.status, 200);
    assert.equal(res.body.name, "Renamed App");
    assert.equal(res.body.id, "test-app");
  });

  it("returns 404 for unknown id", async () => {
    const res = await request
      .put("/api/apps/no-such-app")
      .send({ name: "x" });
    assert.equal(res.status, 404);
  });
});

describe("DELETE /api/apps/:id", () => {
  beforeEach(async () => {
    await resetRegistry();
    await request.post("/api/apps").send(SAMPLE_APP);
  });

  it("removes an app from the registry", async () => {
    const del = await request.delete("/api/apps/test-app");
    assert.equal(del.status, 200);
    assert.equal(del.body.ok, true);

    const list = await request.get("/api/apps");
    assert.deepEqual(list.body.apps, []);
  });

  it("returns 404 for unknown id", async () => {
    const res = await request.delete("/api/apps/no-such-app");
    assert.equal(res.status, 404);
  });
});

// ---------------------------------------------------------------------------
// Security guardrail — server-side enforcement
// ---------------------------------------------------------------------------

describe("POST /api/funnel/enable — Security guard", () => {
  beforeEach(async () => {
    await resetRegistry();
    await request.post("/api/apps").send(SECURITY_APP);
  });

  it("returns 403 for a Security-category app", async () => {
    const res = await request
      .post("/api/funnel/enable")
      .send({ appId: "password-manager", port: 8080 });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /Security/);
  });

  it("returns 404 for unknown appId", async () => {
    const res = await request
      .post("/api/funnel/enable")
      .send({ appId: "nonexistent", port: 9999 });
    assert.equal(res.status, 404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/meta
// ---------------------------------------------------------------------------

describe("GET /api/meta", () => {
  it("returns hostname and port", async () => {
    const res = await request.get("/api/meta");
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.hostname, "string");
    assert.equal(res.body.port, Number(process.env.PORT) || 3000);
  });
});
