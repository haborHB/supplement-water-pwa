const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");
const { IDBFactory, IDBObjectStore } = require("fake-indexeddb");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8");

async function until(predicate, message = "Timed out", timeout = 1500) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function openApp(factory = new IDBFactory()) {
  const console = new VirtualConsole();
  const errors = [];
  console.on("jsdomError", (error) => errors.push(error));
  const dom = new JSDOM(html, { url: "http://localhost:4181/", runScripts: "outside-only", virtualConsole: console });
  const win = dom.window;
  win.indexedDB = factory;
  win.eval(source);
  await until(() => win.document.querySelector("[data-add-water]"), "App did not initialize");
  const database = await new Promise((resolve, reject) => {
    const request = factory.open("supplement-water-log");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return { win, doc: win.document, factory, database, errors, close: () => { database.close(); win.close(); } };
}

function records(app, store) {
  return new Promise((resolve, reject) => {
    const request = app.database.transaction(store).objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// jsdom does not implement HTMLFormElement's browser named-property override.
function emulateNamedId(form) {
  if (form.elements.namedItem("id")) {
    Object.defineProperty(form, "id", { configurable: true, get: () => form.elements.namedItem("id") });
  }
}

function openForm(app) {
  app.doc.querySelector("#open-new-supplement").click();
  const form = app.doc.querySelector("#supplement-form");
  emulateNamedId(form);
  form.addEventListener("submit", (event) => event.preventDefault());
  app.doc.querySelector("#supplement-name").value = "Regression supplement";
  app.doc.querySelector("#supplement-brand").value = "Test brand";
  app.doc.querySelector("#supplement-type").value = "Tablet";
  app.doc.querySelector('[data-field="name"]').value = "Vitamin C";
  app.doc.querySelector('[data-field="amount"]').value = "500";
  app.doc.querySelector('[data-field="unit"]').value = "mg";
  return form;
}

function isClosed(app) {
  return app.doc.querySelector("#supplement-modal").classList.contains("is-hidden");
}

async function save(app, form) {
  form.querySelector('[type="submit"]').click();
  await until(() => isClosed(app), "Save did not run or finish");
}

test("create from Today saves both profile and ingredients and survives reopening", async () => {
  const app = await openApp();
  let reopened;
  try {
    await save(app, openForm(app));
    const profiles = await records(app, "supplements");
    const versions = await records(app, "versions");
    assert.equal(profiles.length, 1);
    assert.equal(versions.length, 1);
    assert.equal(profiles[0].currentVersionId, versions[0].id);
    assert.equal(versions[0].ingredients[0].amount, 500);
    reopened = await openApp(app.factory);
    assert.match(reopened.doc.body.textContent, /Regression supplement/);
    reopened.doc.querySelector("[data-open-supplement]").click();
    assert.match(reopened.doc.querySelector(".ingredient-table").textContent, /500 mg/);
    assert.equal(app.errors.length, 0);
  } finally { app.close(); reopened?.close(); }
});

test("edit retains profile identity and previous ingredient version", async () => {
  const app = await openApp();
  let reopened;
  try {
    await save(app, openForm(app));
    const [before] = await records(app, "supplements");
    app.doc.querySelector("[data-edit-supplement]").click();
    app.doc.querySelector("#supplement-name").value = "Edited supplement";
    app.doc.querySelector('[data-field="amount"]').value = "600";
    await save(app, app.doc.querySelector("#supplement-form"));
    const profiles = await records(app, "supplements");
    const versions = await records(app, "versions");
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].id, before.id);
    assert.equal(versions.length, 2);
    assert.equal(versions.find((v) => v.id === before.currentVersionId).ingredients[0].amount, 500);
    reopened = await openApp(app.factory);
    assert.match(reopened.doc.body.textContent, /Edited supplement/);
  } finally { app.close(); reopened?.close(); }
});

test("submit routing tolerates legacy id-named input", async () => {
  const app = await openApp();
  try {
    const form = openForm(app);
    const legacy = app.doc.createElement("input");
    legacy.type = "hidden";
    legacy.name = "id";
    form.appendChild(legacy);
    emulateNamedId(form);
    assert.notEqual(typeof form.id, "string");
    await save(app, form);
    assert.equal((await records(app, "supplements")).length, 1);
  } finally { app.close(); }
});

test("rapid double submit creates only one profile", async () => {
  const app = await openApp();
  try {
    const form = openForm(app);
    const button = form.querySelector('[type="submit"]');
    button.click();
    button.click();
    await until(() => isClosed(app));
    assert.equal((await records(app, "supplements")).length, 1);
    assert.equal((await records(app, "versions")).length, 1);
  } finally { app.close(); }
});

test("required fields prevent saving incomplete form", async () => {
  const app = await openApp();
  try {
    const form = openForm(app);
    app.doc.querySelector("#supplement-name").value = "";
    form.querySelector('[type="submit"]').click();
    assert.equal(form.checkValidity(), false);
    assert.equal(isClosed(app), false);
    assert.equal((await records(app, "supplements")).length, 0);
  } finally { app.close(); }
});

test("aborted transaction leaves no partial record, keeps draft, and permits retry", async () => {
  const app = await openApp();
  const originalPut = IDBObjectStore.prototype.put;
  try {
    IDBObjectStore.prototype.put = function (...args) {
      const request = originalPut.apply(this, args);
      if (this.name === "versions") this.transaction.abort();
      return request;
    };
    const form = openForm(app);
    form.querySelector('[type="submit"]').click();
    await until(() => app.doc.querySelector("#supplement-save-error")?.textContent, "No failure feedback");
    assert.equal((await records(app, "supplements")).length, 0);
    assert.equal((await records(app, "versions")).length, 0);
    assert.equal(isClosed(app), false);
    assert.equal(app.doc.querySelector("#supplement-name").value, "Regression supplement");
    assert.doesNotMatch(app.doc.querySelector("#view-root").textContent, /Regression supplement/);
    IDBObjectStore.prototype.put = originalPut;
    await save(app, form);
    assert.equal((await records(app, "supplements")).length, 1);
  } finally { IDBObjectStore.prototype.put = originalPut; app.close(); }
});

test("water form still works through the shared submit handler", async () => {
  const app = await openApp();
  try {
    const form = app.doc.querySelector("#custom-water-form");
    form.querySelector("input").value = "123";
    form.querySelector('[type="submit"]').click();
    await until(() => app.doc.querySelector(".water-total").textContent.includes("123"));
    assert.equal((await records(app, "waterEntries"))[0].amountMl, 123);
  } finally { app.close(); }
});
