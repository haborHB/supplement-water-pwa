/* Run on a local test server only. Every run uses a separate IndexedDB name. */
(async () => {
  if (!["127.0.0.1", "localhost"].includes(location.hostname)) {
    document.querySelector("#results").textContent = "Run this test locally.";
    return;
  }
  const results = [];
  const output = document.querySelector("#results");
  const frame = document.querySelector("iframe");
  const mode = new URLSearchParams(location.search).get("mode");
  const databaseName = `supplement-save-test-${crypto.randomUUID()}`;
  let database;
  let win;
  let doc;
  const [html, source] = await Promise.all([
    fetch("../index.html").then((r) => r.text()),
    fetch("../app.js").then((r) => r.text()),
  ]);
  const appSource = source.replace(
    'const DB_NAME = "supplement-water-log";',
    `const DB_NAME = ${JSON.stringify(databaseName)};`,
  );
  const scriptUrl = URL.createObjectURL(new Blob([
    appSource,
    "\nregisterServiceWorker = () => {};",
  ], { type: "text/javascript" }));
  const fixture = html
    .replace("<head>", `<head><base href="${new URL("../", location.href)}">`)
    .replace('src="./app.js"', `src="${scriptUrl}"`);

  function assert(value, message) {
    if (!value) throw new Error(message);
  }

  async function until(predicate, message, timeout = 2500) {
    const start = performance.now();
    while (!predicate()) {
      if (performance.now() - start > timeout) throw new Error(message);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  function readAll(store) {
    return new Promise((resolve, reject) => {
      const request = database.transaction(store).objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function loadApp() {
    frame.srcdoc = fixture;
    await new Promise((resolve) => { frame.onload = resolve; });
    win = frame.contentWindow;
    doc = frame.contentDocument;
    await until(() => doc.querySelector("[data-add-water]"), "App did not render");
  }

  function openForm() {
    doc.querySelector("#open-new-supplement").click();
    const form = doc.querySelector("#supplement-form");
    // Suppress the browser's default navigation so a broken event route is observable.
    form.addEventListener("submit", (event) => event.preventDefault());
    doc.querySelector("#supplement-name").value = "Regression supplement";
    doc.querySelector("#supplement-brand").value = "Test brand";
    doc.querySelector("#supplement-type").value = "Tablet";
    doc.querySelector('[data-field="name"]').value = "Vitamin C";
    doc.querySelector('[data-field="amount"]').value = "500";
    doc.querySelector('[data-field="unit"]').value = "mg";
    return form;
  }

  async function submitAndWait(form) {
    form.querySelector('[type="submit"]').click();
    await until(
      () => doc.querySelector("#supplement-modal").classList.contains("is-hidden"),
      "Save did not finish; modal stayed open",
    );
  }

  async function check(name, run) {
    await run();
    results.push({ name, status: "PASS" });
    output.textContent = results.map((r) => `${r.status}: ${r.name}`).join("\n");
  }

  try {
    await loadApp();
    database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    if (mode === "repro") {
      const form = openForm();
      const actualId = form.id;
      await check("Original bug: input named id shadows form.id and save is skipped", async () => {
        assert(actualId instanceof win.HTMLInputElement, "form.id is not shadowed");
        assert(form.getAttribute("id") === "supplement-form", "Unexpected form");
        form.querySelector('[type="submit"]').click();
        await new Promise((resolve) => setTimeout(resolve, 200));
        assert((await readAll("supplements")).length === 0, "Unexpected saved profile");
        assert(!doc.querySelector("#supplement-modal").classList.contains("is-hidden"), "Unexpected modal closure");
      });
    } else {
      let supplementId;
      let originalVersionId;
      await check("Create from Today commits profile and ingredients together", async () => {
        const form = openForm();
        await submitAndWait(form);
        const profiles = await readAll("supplements");
        const versions = await readAll("versions");
        assert(profiles.length === 1 && versions.length === 1, "Expected one profile and version");
        supplementId = profiles[0].id;
        originalVersionId = profiles[0].currentVersionId;
        assert(versions[0].id === originalVersionId, "Broken version reference");
        assert(versions[0].ingredients[0].amount === 500, "Ingredient amount lost");
      });
      await check("Reload restores saved profile and ingredients", async () => {
        await loadApp();
        assert(doc.body.textContent.includes("Regression supplement"), "Profile missing after reload");
        doc.querySelector("[data-open-supplement]").click();
        assert(doc.querySelector(".ingredient-table").textContent.includes("500 mg"), "Ingredient missing");
      });
      await check("Edit updates one profile, retains old version, and persists after reload", async () => {
        doc.querySelector("[data-edit-supplement]").click();
        doc.querySelector("#supplement-name").value = "Edited supplement";
        doc.querySelector('[data-field="amount"]').value = "600";
        await submitAndWait(doc.querySelector("#supplement-form"));
        const profiles = await readAll("supplements");
        const versions = await readAll("versions");
        assert(profiles.length === 1 && profiles[0].id === supplementId, "Edit created a duplicate");
        assert(versions.length === 2, "Previous version was not retained");
        assert(versions.find((v) => v.id === originalVersionId).ingredients[0].amount === 500, "Old version changed");
        await loadApp();
        assert(doc.body.textContent.includes("Edited supplement"), "Edit did not persist");
      });
      await check("Save works even if a legacy id-named input is present", async () => {
        doc.querySelector('[data-view="supplements"]').click();
        const form = openForm();
        const legacy = doc.createElement("input");
        legacy.name = "id";
        legacy.type = "hidden";
        form.appendChild(legacy);
        assert(form.id instanceof win.HTMLInputElement, "Test did not shadow the form property");
        await submitAndWait(form);
        assert((await readAll("supplements")).length === 2, "Submit route still depends on form.id");
      });
      await check("Double submit creates only one profile", async () => {
        const form = openForm();
        const submit = form.querySelector('[type="submit"]');
        submit.click();
        submit.click();
        await until(() => doc.querySelector("#supplement-modal").classList.contains("is-hidden"), "Save did not finish");
        assert((await readAll("supplements")).length === 3, "Duplicate submission saved twice");
      });
      await check("Invalid form leaves data untouched and remains editable", async () => {
        const form = openForm();
        doc.querySelector("#supplement-name").value = "";
        form.querySelector('[type="submit"]').click();
        assert(!form.checkValidity(), "Required field accepted empty value");
        assert((await readAll("supplements")).length === 3, "Invalid form was persisted");
        assert(!doc.querySelector("#supplement-modal").classList.contains("is-hidden"), "Invalid form dismissed");
        doc.querySelector("#cancel-modal-button").click();
      });
      await check("Storage abort rolls back both records and retains form for retry", async () => {
        const originalPut = win.IDBObjectStore.prototype.put;
        win.IDBObjectStore.prototype.put = function (...args) {
          const request = originalPut.apply(this, args);
          if (this.name === "versions") this.transaction.abort();
          return request;
        };
        const form = openForm();
        doc.querySelector("#supplement-name").value = "Retry supplement";
        form.querySelector('[type="submit"]').click();
        await until(() => doc.querySelector("#supplement-save-error")?.textContent, "Save failure was not reported");
        assert((await readAll("supplements")).length === 3, "Profile persisted despite aborted version");
        assert((await readAll("versions")).length === 4, "Failed version persisted");
        assert(doc.querySelector("#supplement-name").value === "Retry supplement", "Draft was erased");
        assert(!doc.querySelector("#supplement-modal").classList.contains("is-hidden"), "Failed form dismissed");
        assert(!doc.querySelector("#view-root").textContent.includes("Retry supplement"), "Failed write leaked to UI state");
        win.IDBObjectStore.prototype.put = originalPut;
        await submitAndWait(form);
        assert((await readAll("supplements")).length === 4, "Retry failed");
        await loadApp();
        assert(doc.body.textContent.includes("Retry supplement"), "Retried record lost after reload");
      });
      await check("Water form still saves through the shared submit handler", async () => {
        const form = doc.querySelector("#custom-water-form");
        form.querySelector("input").value = "123";
        form.querySelector('[type="submit"]').click();
        await until(() => doc.querySelector(".water-total").textContent.includes("123"), "Water form failed");
        assert((await readAll("waterEntries"))[0].amountMl === 123, "Water amount not stored");
      });
    }
  } catch (error) {
    results.push({ status: "FAIL", name: error.message });
  } finally {
    output.textContent = results.map((r) => `${r.status}: ${r.name}`).join("\n");
    document.title = `${results.some((r) => r.status === "FAIL") ? "FAIL" : "PASS"}: Supplement save regression`;
    await fetch("/__test_report", {
      method: "POST",
      body: JSON.stringify({ mode: mode || "regression", results, userAgent: navigator.userAgent }),
    });
    database?.close();
    URL.revokeObjectURL(scriptUrl);
  }
})();
