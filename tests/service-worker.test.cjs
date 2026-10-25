const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
const scope = "https://example.test/supplement-water-pwa/";

function worker(overrides = {}) {
  const handlers = {};
  const deleted = [];
  const opened = [];
  let skipped = false;
  let claimed = false;
  const cache = {
    addAll: async () => {},
    match: async () => undefined,
    ...overrides.cache,
  };
  const context = {
    URL,
    Request,
    self: {
      location: { origin: "https://example.test" },
      registration: { scope },
      addEventListener: (name, fn) => { handlers[name] = fn; },
      skipWaiting: async () => { skipped = true; },
      clients: { claim: async () => { claimed = true; } },
    },
    caches: {
      open: async (name) => { opened.push(name); return cache; },
      keys: async () => ["supplement-water-pwa-v1", "supplement-water-pwa-v2-save-fix", "other-app-cache"],
      delete: async (name) => { deleted.push(name); },
    },
    fetch: overrides.fetch || (async () => new Response("network")),
  };
  vm.runInNewContext(source, context);
  return {
    handlers, deleted, opened,
    get skipped() { return skipped; },
    get claimed() { return claimed; },
  };
}

function runLifecycle(fn) {
  let task;
  fn({ waitUntil: (promise) => { task = promise; } });
  return task;
}

function request(worker, url, options = {}) {
  let result;
  worker.handlers.fetch({
    request: { url, method: "GET", mode: "cors", ...options },
    respondWith: (promise) => { result = promise; },
  });
  return result;
}

test("new cache primes fresh shell before activating", async () => {
  let complete;
  let assets;
  const subject = worker({ cache: {
    addAll: (items) => {
      assets = items;
      return new Promise((resolve) => { complete = resolve; });
    },
  } });
  const task = runLifecycle(subject.handlers.install);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(subject.skipped, false);
  assert.equal(assets.length, 6);
  assert.ok(assets.every((item) => item.cache === "reload" && item.url.startsWith(scope)));
  complete();
  await task;
  assert.equal(subject.skipped, true);
});

test("failed precache does not replace the working service worker", async () => {
  const subject = worker({ cache: { addAll: async () => { throw new Error("offline"); } } });
  await assert.rejects(runLifecycle(subject.handlers.install), /offline/);
  assert.equal(subject.skipped, false);
});

test("activation removes old app shell and preserves unrelated caches", async () => {
  const subject = worker();
  await runLifecycle(subject.handlers.activate);
  assert.deepEqual(subject.deleted, ["supplement-water-pwa-v1"]);
  assert.equal(subject.claimed, true);
});

test("offline app assets come from the current version only", async () => {
  const subject = worker({ cache: { match: async () => new Response("fixed app") } });
  const response = await request(subject, `${scope}app.js`);
  assert.equal(await response.text(), "fixed app");
  assert.deepEqual(subject.opened, ["supplement-water-pwa-v2-save-fix"]);
});

test("offline navigation with a query string uses cached index", async () => {
  const subject = worker({
    cache: { match: async (item) => typeof item === "string" && item === `${scope}index.html` ? new Response("offline shell") : undefined },
    fetch: async () => { throw new Error("offline"); },
  });
  const response = await request(subject, `${scope}?test=1`, { mode: "navigate" });
  assert.equal(await response.text(), "offline shell");
});

test("worker leaves POST, other origins, and other applications alone", () => {
  const subject = worker();
  assert.equal(request(subject, `${scope}index.html`, { method: "POST" }), undefined);
  assert.equal(request(subject, "https://other.test/app.js"), undefined);
  assert.equal(request(subject, "https://example.test/other-app/app.js"), undefined);
});
