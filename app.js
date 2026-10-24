const DB_NAME = "supplement-water-log";
const DB_VERSION = 1;
const TODAY = dateKey(new Date());

const state = {
  activeView: "today",
  selectedDate: TODAY,
  selectedSupplementId: null,
  supplements: [],
  versions: [],
  intakes: [],
  waterEntries: [],
  settings: { waterGoalMl: 2000 },
  deferredInstallPrompt: null,
};

const viewRoot = document.querySelector("#view-root");
const modal = document.querySelector("#supplement-modal");
const toast = document.querySelector("#toast");
let toastTimer;

const db = openDatabase();

document.addEventListener("DOMContentLoaded", async () => {
  await loadState();
  bindGlobalEvents();
  registerServiceWorker();
  render();
});

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("settings")) {
        database.createObjectStore("settings", { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains("supplements")) {
        database.createObjectStore("supplements", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("versions")) {
        const store = database.createObjectStore("versions", { keyPath: "id" });
        store.createIndex("supplementId", "supplementId", { unique: false });
      }
      if (!database.objectStoreNames.contains("intakes")) {
        const store = database.createObjectStore("intakes", { keyPath: "id" });
        store.createIndex("dateKey", "dateKey", { unique: false });
        store.createIndex("supplementId", "supplementId", { unique: false });
      }
      if (!database.objectStoreNames.contains("waterEntries")) {
        const store = database.createObjectStore("waterEntries", { keyPath: "id" });
        store.createIndex("dateKey", "dateKey", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAll(storeName) {
  const database = await db;
  const transaction = database.transaction(storeName, "readonly");
  return requestToPromise(transaction.objectStore(storeName).getAll());
}

async function putRecord(storeName, value) {
  const database = await db;
  const transaction = database.transaction(storeName, "readwrite");
  await requestToPromise(transaction.objectStore(storeName).put(value));
}

async function deleteRecord(storeName, key) {
  const database = await db;
  const transaction = database.transaction(storeName, "readwrite");
  await requestToPromise(transaction.objectStore(storeName).delete(key));
}

async function clearStore(storeName) {
  const database = await db;
  const transaction = database.transaction(storeName, "readwrite");
  await requestToPromise(transaction.objectStore(storeName).clear());
}

async function loadState() {
  const [settings, supplements, versions, intakes, waterEntries] = await Promise.all([
    getAll("settings"),
    getAll("supplements"),
    getAll("versions"),
    getAll("intakes"),
    getAll("waterEntries"),
  ]);
  const storedSettings = settings.find((item) => item.key === "app");
  if (storedSettings?.value) {
    state.settings = { ...state.settings, ...storedSettings.value };
  }
  state.supplements = supplements;
  state.versions = versions;
  state.intakes = intakes;
  state.waterEntries = waterEntries;
}

function bindGlobalEvents() {
  document.addEventListener("click", async (event) => {
    const navButton = event.target.closest("[data-view]");
    if (navButton) {
      state.activeView = navButton.dataset.view;
      state.selectedSupplementId = null;
      render();
      return;
    }

    const waterButton = event.target.closest("[data-add-water]");
    if (waterButton) {
      await addWater(Number(waterButton.dataset.addWater));
      return;
    }

    const recordButton = event.target.closest("[data-record-intake]");
    if (recordButton) {
      const quantity = Number(recordButton.dataset.quantity || 1);
      await recordIntake(recordButton.dataset.recordIntake, quantity);
      return;
    }

    const openButton = event.target.closest("[data-open-supplement]");
    if (openButton) {
      state.selectedSupplementId = openButton.dataset.openSupplement;
      state.activeView = "supplement-detail";
      render();
      return;
    }

    const editButton = event.target.closest("[data-edit-supplement]");
    if (editButton) {
      openSupplementModal(editButton.dataset.editSupplement);
      return;
    }

    const archiveButton = event.target.closest("[data-archive-supplement]");
    if (archiveButton) {
      await archiveSupplement(archiveButton.dataset.archiveSupplement);
      return;
    }

    const exportButton = event.target.closest("[data-export]");
    if (exportButton) {
      await exportData(exportButton.dataset.export);
      return;
    }

    if (event.target.closest("#open-new-supplement")) {
      openSupplementModal();
      return;
    }

    if (event.target.closest("#add-ingredient-button")) {
      addIngredientRow();
      return;
    }

    if (event.target.closest("#parse-ingredient-button")) {
      parseIngredientText();
      return;
    }

    if (event.target.closest("#close-modal-button") || event.target.closest("#cancel-modal-button")) {
      closeSupplementModal();
      return;
    }

    if (event.target === modal) {
      closeSupplementModal();
    }

    if (event.target.closest("#back-to-supplements")) {
      state.activeView = "supplements";
      state.selectedSupplementId = null;
      render();
    }

    if (event.target.closest("#save-water-goal")) {
      await saveWaterGoal();
    }

    if (event.target.closest("#install-button")) {
      await installPwa();
    }
  });

  document.addEventListener("submit", async (event) => {
    if (event.target.id === "custom-water-form") {
      event.preventDefault();
      const amount = Number(new FormData(event.target).get("amount"));
      if (amount > 0) {
        await addWater(amount);
        event.target.reset();
      }
    }
    if (event.target.id === "supplement-form") {
      event.preventDefault();
      await saveSupplement(event.target);
    }
  });

  document.addEventListener("change", async (event) => {
    if (event.target.id === "history-date") {
      state.selectedDate = event.target.value || TODAY;
      render();
    }
    if (event.target.id === "import-file") {
      await importData(event.target.files?.[0]);
      event.target.value = "";
    }
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    const installButton = document.querySelector("#install-button");
    if (installButton) installButton.hidden = false;
  });
}

function render() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.activeView);
  });

  if (state.activeView === "today") renderToday();
  if (state.activeView === "supplements") renderSupplements();
  if (state.activeView === "history") renderHistory();
  if (state.activeView === "settings") renderSettings();
  if (state.activeView === "supplement-detail") renderSupplementDetail();
}

function renderToday() {
  const water = getWaterTotal(state.selectedDate);
  const goal = Number(state.settings.waterGoalMl) || 2000;
  const percentage = Math.min(100, Math.round((water / goal) * 100));
  const remaining = Math.max(0, goal - water);
  const activeSupplements = state.supplements.filter((item) => !item.archived);

  viewRoot.innerHTML = `
    <div class="view-header">
      <div>
        <p class="eyebrow">TODAY</p>
        <h2>${formatDateLabel(state.selectedDate)}</h2>
      </div>
      <p class="date-label">${state.selectedDate}</p>
    </div>

    <section class="surface water-hero">
      <div class="water-main">
        <div>
          <p class="eyebrow">WATER INTAKE</p>
          <p class="water-total">${water}<span> ml</span></p>
          <p class="water-remaining">${remaining > 0 ? `距离目标还差 ${remaining} ml` : "今日饮水目标已完成"}</p>
        </div>
        <div class="water-percent">${percentage}%</div>
      </div>
      <div class="progress-track" aria-label="饮水进度">
        <div class="progress-fill" style="width: ${percentage}%"></div>
      </div>
      <div class="quick-actions">
        <button class="quick-water-button" type="button" data-add-water="250">＋250 ml</button>
        <button class="quick-water-button" type="button" data-add-water="500">＋500 ml</button>
        <button class="quick-water-button" type="button" data-add-water="750">＋750 ml</button>
      </div>
      <form class="custom-water" id="custom-water-form">
        <input name="amount" type="number" min="1" step="1" placeholder="自定义饮水量（ml）" aria-label="自定义饮水量">
        <button class="small-button" type="submit">记录</button>
      </form>
    </section>

    <section class="section">
      <div class="section-heading">
        <div>
          <p class="eyebrow">SUPPLEMENTS</p>
          <h3>今日补剂</h3>
        </div>
        <button class="small-button" type="button" id="open-new-supplement">＋ 新增</button>
      </div>
      ${activeSupplements.length ? activeSupplements.map(renderSupplementCard).join("") : renderEmptySupplements()}
    </section>

    <section class="surface">
      <div class="section-heading">
        <div>
          <p class="eyebrow">WATER LOG</p>
          <h3>今日饮水记录</h3>
        </div>
        <span class="muted">${getWaterEntries(state.selectedDate).length} 次</span>
      </div>
      ${renderWaterLog(state.selectedDate)}
    </section>
  `;
}

function renderSupplements() {
  const activeSupplements = state.supplements.filter((item) => !item.archived);
  viewRoot.innerHTML = `
    <div class="view-header">
      <div>
        <p class="eyebrow">LIBRARY</p>
        <h2>补剂档案</h2>
      </div>
      <button class="primary-button" type="button" id="open-new-supplement">＋ 新增补剂</button>
    </div>
    <p class="muted">每个档案保存产品信息、每单位有效成分和使用说明。你把标签内容发给我后，可以逐项补全。</p>
    <section class="section">
      ${activeSupplements.length ? activeSupplements.map(renderSupplementLibraryCard).join("") : renderEmptySupplements()}
    </section>
  `;
}

function renderSupplementDetail() {
  const supplement = state.supplements.find((item) => item.id === state.selectedSupplementId);
  if (!supplement) {
    state.activeView = "supplements";
    render();
    return;
  }
  const version = getCurrentVersion(supplement);
  const taken = getIntakeTotal(supplement.id, state.selectedDate);
  const target = Number(supplement.dailyTargetUnits) || 0;
  const history = state.intakes
    .filter((item) => item.supplementId === supplement.id)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 12);

  viewRoot.innerHTML = `
    <div class="detail-header">
      <button class="back-button" type="button" id="back-to-supplements" title="返回补剂档案" aria-label="返回补剂档案">←</button>
      <div class="detail-title">
        <p class="eyebrow">SUPPLEMENT PROFILE</p>
        <h2>${escapeHtml(supplement.name)}</h2>
        <p class="muted">${escapeHtml([supplement.brand, supplement.form].filter(Boolean).join(" · ") || "尚未填写品牌或剂型")}</p>
      </div>
      <div class="detail-actions">
        <button class="small-button" type="button" data-edit-supplement="${supplement.id}">编辑</button>
      </div>
    </div>

    <section class="surface detail-grid">
      <div class="stat-block">
        <span class="stat-label">每日计划</span>
        <span class="stat-value">${formatNumber(target)} ${escapeHtml(supplement.unitLabel || "单位")}</span>
      </div>
      <div class="stat-block">
        <span class="stat-label">今日已记录</span>
        <span class="stat-value">${formatNumber(taken)} ${escapeHtml(supplement.unitLabel || "单位")}</span>
      </div>
      <div class="stat-block">
        <span class="stat-label">建议时间</span>
        <span class="stat-value">${escapeHtml(supplement.timing || "未填写")}</span>
      </div>
      <div class="stat-block">
        <span class="stat-label">档案版本</span>
        <span class="stat-value">${version ? formatDateLabel(version.effectiveFrom, false) : "未建立"}</span>
      </div>
    </section>

    <section class="surface">
      <div class="section-heading">
        <div>
          <p class="eyebrow">ACTIVE INGREDIENTS</p>
          <h3>每${escapeHtml(supplement.unitLabel || "单位")}含量</h3>
        </div>
      </div>
      ${version?.ingredients?.length ? `
        <table class="ingredient-table">
          <tbody>
            ${version.ingredients.map((ingredient) => `
              <tr>
                <td><strong>${escapeHtml(ingredient.name)}</strong>${ingredient.form ? `<br><span class="muted">${escapeHtml(ingredient.form)}</span>` : ""}</td>
                <td>${formatNumber(ingredient.amount)} ${escapeHtml(ingredient.unit)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : renderEmptyState("还没有填写有效成分", "编辑档案并录入标签上的每单位含量。")}
    </section>

    <section class="surface">
      <div class="section-heading">
        <div>
          <p class="eyebrow">QUICK LOG</p>
          <h3>记录服用</h3>
        </div>
        <span class="muted">${formatDateLabel(state.selectedDate)}</span>
      </div>
      <div class="quick-actions light-actions">
        <button class="secondary-button" type="button" data-record-intake="${supplement.id}" data-quantity="0.5">＋0.5 ${escapeHtml(supplement.unitLabel || "单位")}</button>
        <button class="secondary-button" type="button" data-record-intake="${supplement.id}" data-quantity="1">＋1 ${escapeHtml(supplement.unitLabel || "单位")}</button>
        <button class="secondary-button" type="button" data-record-intake="${supplement.id}" data-quantity="2">＋2 ${escapeHtml(supplement.unitLabel || "单位")}</button>
      </div>
    </section>

    <section class="surface">
      <div class="section-heading">
        <div>
          <p class="eyebrow">USAGE NOTES</p>
          <h3>标签备注</h3>
        </div>
      </div>
      <p class="${supplement.notes ? "" : "muted"}">${escapeHtml(supplement.notes || "还没有备注。")}</p>
    </section>

    <section class="surface">
      <div class="section-heading">
        <div>
          <p class="eyebrow">RECENT INTAKE</p>
          <h3>最近记录</h3>
        </div>
      </div>
      ${history.length ? `
        <div class="log-list">
          ${history.map((entry) => `
            <div class="log-row">
              <div>
                <strong>${formatDateLabel(entry.dateKey, false)}</strong>
                <div class="log-time">${formatTime(entry.timestamp)}</div>
              </div>
              <span class="log-value">${formatNumber(entry.quantity)} ${escapeHtml(supplement.unitLabel || "单位")}</span>
            </div>
          `).join("")}
        </div>
      ` : renderEmptyState("还没有服用记录", "记录后会在这里保留历史。")}
    </section>
  `;
}

function renderHistory() {
  const selectedDate = state.selectedDate || TODAY;
  const weekDates = getLastSevenDates(selectedDate);
  const waterTotal = getWaterTotal(selectedDate);
  const dailyRows = weekDates.map((date) => {
    const water = getWaterTotal(date);
    const supplementCount = state.supplements.filter((item) => !item.archived).reduce((sum, supplement) => {
      const target = Number(supplement.dailyTargetUnits) || 0;
      return sum + (target > 0 && getIntakeTotal(supplement.id, date) >= target ? 1 : 0);
    }, 0);
    const activeCount = state.supplements.filter((item) => !item.archived).length;
    return { date, water, supplementCount, activeCount };
  });

  viewRoot.innerHTML = `
    <div class="view-header">
      <div>
        <p class="eyebrow">HISTORY</p>
        <h2>历史与周报</h2>
      </div>
      <button class="small-button" type="button" data-export="week">导出本周</button>
    </div>
    <section class="surface">
      <div class="history-controls">
        <label>
          统计截止日期
          <input id="history-date" type="date" value="${selectedDate}">
        </label>
        <div class="stat-block">
          <span class="stat-label">当天饮水</span>
          <span class="stat-value">${waterTotal} ml</span>
        </div>
      </div>
    </section>
    <section class="surface">
      <div class="section-heading">
        <div>
          <p class="eyebrow">LAST 7 DAYS</p>
          <h3>${formatDateLabel(weekDates[0], false)} 至 ${formatDateLabel(weekDates[weekDates.length - 1], false)}</h3>
        </div>
      </div>
      <div class="table-wrap">
        <table class="summary-table">
          <thead>
            <tr><th>日期</th><th>饮水</th><th>补剂达标</th></tr>
          </thead>
          <tbody>
            ${dailyRows.map((row) => `
              <tr>
                <td>${formatDateLabel(row.date, false)}</td>
                <td>${row.water} / ${Number(state.settings.waterGoalMl) || 2000} ml</td>
                <td>${row.activeCount ? `${row.supplementCount} / ${row.activeCount}` : "暂无补剂"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
    <section class="surface">
      <div class="section-heading">
        <div>
          <p class="eyebrow">EXPORT</p>
          <h3>与每周总结配合</h3>
        </div>
      </div>
      <p class="muted">导出文件包含这 7 天的饮水记录、服用记录、补剂档案和成分版本。上传给我后，可以计算实际摄入量和完成率。</p>
      <div class="card-actions">
        <button class="secondary-button" type="button" data-export="week">导出本周 JSON</button>
        <button class="secondary-button" type="button" data-export="all">导出全部备份</button>
      </div>
    </section>
  `;
}

function renderSettings() {
  const installVisible = state.deferredInstallPrompt ? "" : "hidden";
  viewRoot.innerHTML = `
    <div class="view-header">
      <div>
        <p class="eyebrow">SETTINGS</p>
        <h2>设置与备份</h2>
      </div>
    </div>
    <section class="surface settings-grid">
      <div class="settings-row">
        <div>
          <strong>每日饮水目标</strong>
          <p class="muted">当天进度会按照这个数值计算。</p>
        </div>
        <div class="custom-water">
          <input id="water-goal-input" type="number" min="100" step="50" value="${Number(state.settings.waterGoalMl) || 2000}" aria-label="每日饮水目标">
          <span class="muted">ml</span>
        </div>
      </div>
      <div class="card-actions">
        <button class="primary-button" type="button" id="save-water-goal">保存目标</button>
      </div>
    </section>
    <section class="surface settings-grid">
      <div>
        <p class="eyebrow">BACKUP</p>
        <h3>本地数据备份</h3>
        <p class="muted">数据保存在当前浏览器的本地数据库中。定期导出备份，换设备时可以恢复。</p>
      </div>
      <div class="card-actions">
        <button class="secondary-button" type="button" data-export="all">导出备份</button>
        <label class="secondary-button">
          导入备份
          <input id="import-file" type="file" accept="application/json" hidden>
        </label>
      </div>
    </section>
    <section class="surface settings-grid">
      <div>
        <p class="eyebrow">INSTALL</p>
        <h3>添加到手机主屏幕</h3>
        <p class="muted">Android Chrome 出现安装提示后，可以把它作为独立应用打开。</p>
      </div>
      <div class="card-actions">
        <button class="secondary-button" id="install-from-settings" type="button" ${installVisible}>安装到主屏幕</button>
      </div>
    </section>
  `;
  const installFromSettings = document.querySelector("#install-from-settings");
  installFromSettings?.addEventListener("click", installPwa);
}

function renderSupplementCard(supplement) {
  const taken = getIntakeTotal(supplement.id, state.selectedDate);
  const target = Number(supplement.dailyTargetUnits) || 0;
  const percentage = target ? Math.min(100, Math.round((taken / target) * 100)) : 0;
  const version = getCurrentVersion(supplement);
  const ingredientPreview = version?.ingredients?.length
    ? version.ingredients.slice(0, 2).map((item) => `${escapeHtml(item.name)} ${formatNumber(item.amount)}${escapeHtml(item.unit)}`).join(" · ")
    : "尚未录入有效成分";
  return `
    <article class="supplement-card">
      <div class="supplement-card-header">
        <div>
          <h3>${escapeHtml(supplement.name)}</h3>
          <p class="supplement-meta">${escapeHtml([supplement.brand, supplement.form].filter(Boolean).join(" · ") || "补剂档案")}</p>
          <p class="ingredient-preview">${ingredientPreview}</p>
        </div>
        <button class="small-button" type="button" data-open-supplement="${supplement.id}">详情</button>
      </div>
      <div class="supplement-progress">
        <div class="progress-track" aria-label="${escapeHtml(supplement.name)}服用进度">
          <div class="progress-fill" style="width: ${percentage}%"></div>
        </div>
        <span class="count-label">${formatNumber(taken)} / ${formatNumber(target)} ${escapeHtml(supplement.unitLabel || "单位")}</span>
      </div>
      <div class="card-actions">
        <button class="secondary-button" type="button" data-record-intake="${supplement.id}" data-quantity="1">记录 1 ${escapeHtml(supplement.unitLabel || "单位")}</button>
      </div>
    </article>
  `;
}

function renderSupplementLibraryCard(supplement) {
  const version = getCurrentVersion(supplement);
  return `
    <article class="supplement-card">
      <div class="supplement-card-header">
        <div>
          <h3>${escapeHtml(supplement.name)}</h3>
          <p class="supplement-meta">${escapeHtml([supplement.brand, supplement.form].filter(Boolean).join(" · ") || "尚未填写品牌和剂型")}</p>
          <p class="ingredient-preview">${version?.ingredients?.length ? `${version.ingredients.length} 项有效成分 · 每${escapeHtml(supplement.unitLabel || "单位")}含量已保存` : "等待录入标签成分"}</p>
        </div>
        <button class="small-button" type="button" data-open-supplement="${supplement.id}">打开</button>
      </div>
      <div class="card-actions">
        <button class="text-button" type="button" data-edit-supplement="${supplement.id}">编辑档案</button>
        <button class="text-button danger" type="button" data-archive-supplement="${supplement.id}">停用</button>
      </div>
    </article>
  `;
}

function renderWaterLog(date) {
  const entries = getWaterEntries(date).sort((a, b) => b.timestamp - a.timestamp);
  if (!entries.length) return renderEmptyState("还没有饮水记录", "点击上方快捷按钮或输入自定义毫升数。");
  return `
    <div class="log-list">
      ${entries.map((entry) => `
        <div class="log-row">
          <span class="log-time">${formatTime(entry.timestamp)}</span>
          <span class="log-value">＋${entry.amountMl} ml</span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderEmptySupplements() {
  return renderEmptyState("还没有补剂档案", "先建立一个补剂档案，再记录每天吃了多少。", "open-new-supplement");
}

function renderEmptyState(title, description, buttonId = "") {
  return `
    <div class="empty-state">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(description)}</span>
      ${buttonId ? `<br><button class="small-button" type="button" id="${buttonId}">＋ 新增补剂</button>` : ""}
    </div>
  `;
}

function getCurrentVersion(supplement) {
  if (!supplement?.currentVersionId) return null;
  return state.versions.find((version) => version.id === supplement.currentVersionId) || null;
}

function getWaterEntries(date) {
  return state.waterEntries.filter((entry) => entry.dateKey === date);
}

function getWaterTotal(date) {
  return getWaterEntries(date).reduce((sum, entry) => sum + Number(entry.amountMl || 0), 0);
}

function getIntakeTotal(supplementId, date) {
  return state.intakes
    .filter((entry) => entry.supplementId === supplementId && entry.dateKey === date)
    .reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);
}

function getLastSevenDates(endDate) {
  const dates = [];
  const end = parseDateKey(endDate);
  for (let index = 6; index >= 0; index -= 1) {
    const date = new Date(end);
    date.setDate(end.getDate() - index);
    dates.push(dateKey(date));
  }
  return dates;
}

async function addWater(amountMl) {
  if (!Number.isFinite(amountMl) || amountMl <= 0) return;
  const entry = {
    id: makeId(),
    dateKey: dateKey(new Date()),
    timestamp: Date.now(),
    amountMl: Math.round(amountMl),
  };
  state.waterEntries.push(entry);
  await putRecord("waterEntries", entry);
  state.selectedDate = entry.dateKey;
  showToast(`已记录 ${entry.amountMl} ml`);
  render();
}

async function recordIntake(supplementId, quantity) {
  const supplement = state.supplements.find((item) => item.id === supplementId);
  if (!supplement || !Number.isFinite(quantity) || quantity <= 0) return;
  const entry = {
    id: makeId(),
    supplementId,
    versionId: supplement.currentVersionId || null,
    dateKey: dateKey(new Date()),
    timestamp: Date.now(),
    quantity,
  };
  state.intakes.push(entry);
  await putRecord("intakes", entry);
  state.selectedDate = entry.dateKey;
  showToast(`已记录 ${formatNumber(quantity)} ${supplement.unitLabel || "单位"}`);
  render();
}

async function saveWaterGoal() {
  const input = document.querySelector("#water-goal-input");
  const value = Number(input?.value);
  if (!Number.isFinite(value) || value < 100) {
    showToast("饮水目标需要至少 100 ml");
    return;
  }
  state.settings.waterGoalMl = Math.round(value);
  await putRecord("settings", { key: "app", value: state.settings });
  showToast("饮水目标已保存");
  render();
}

function openSupplementModal(supplementId = "") {
  const supplement = state.supplements.find((item) => item.id === supplementId);
  const version = getCurrentVersion(supplement);
  document.querySelector("#modal-title").textContent = supplement ? "编辑补剂档案" : "新增补剂";
  document.querySelector("#supplement-id").value = supplement?.id || "";
  document.querySelector("#supplement-name").value = supplement?.name || "";
  document.querySelector("#supplement-brand").value = supplement?.brand || "";
  document.querySelector("#supplement-type").value = supplement?.form || "";
  document.querySelector("#supplement-unit-label").value = supplement?.unitLabel || "片";
  document.querySelector("#supplement-daily-target").value = supplement?.dailyTargetUnits ?? 1;
  document.querySelector("#supplement-timing").value = supplement?.timing || "";
  document.querySelector("#supplement-notes").value = supplement?.notes || "";
  document.querySelector("#ingredient-raw-text").value = version?.sourceText || "";
  const ingredientList = document.querySelector("#ingredient-list");
  ingredientList.innerHTML = "";
  const ingredients = version?.ingredients?.length ? version.ingredients : [{ name: "", amount: "", unit: "mg", form: "" }];
  ingredients.forEach((ingredient) => addIngredientRow(ingredient));
  modal.classList.remove("is-hidden");
  document.querySelector("#supplement-name").focus();
}

function closeSupplementModal() {
  modal.classList.add("is-hidden");
}

function addIngredientRow(ingredient = { name: "", amount: "", unit: "mg", form: "" }) {
  const row = document.createElement("div");
  row.className = "ingredient-row";
  row.innerHTML = `
    <input data-field="name" type="text" placeholder="成分名称" value="${escapeAttribute(ingredient.name || "")}" aria-label="成分名称">
    <input data-field="amount" type="number" min="0" step="any" placeholder="含量" value="${escapeAttribute(ingredient.amount ?? "")}" aria-label="每单位含量">
    <input data-field="unit" type="text" placeholder="单位" value="${escapeAttribute(ingredient.unit || "mg")}" aria-label="含量单位">
    <button class="remove-ingredient" type="button" title="删除成分" aria-label="删除成分">×</button>
  `;
  row.querySelector(".remove-ingredient").addEventListener("click", () => {
    row.remove();
  });
  document.querySelector("#ingredient-list").appendChild(row);
}

async function saveSupplement(form) {
  const formData = new FormData(form);
  const name = String(formData.get("name") || "").trim();
  if (!name) {
    showToast("请先填写补剂名称");
    return;
  }
  const existingId = String(formData.get("id") || "").trim();
  const existing = state.supplements.find((item) => item.id === existingId);
  const supplementId = existing?.id || makeId();
  const ingredients = [...document.querySelectorAll("#ingredient-list .ingredient-row")]
    .map((row) => ({
      name: row.querySelector('[data-field="name"]').value.trim(),
      amount: Number(row.querySelector('[data-field="amount"]').value),
      unit: row.querySelector('[data-field="unit"]').value.trim(),
      form: "",
    }))
    .filter((item) => item.name && Number.isFinite(item.amount) && item.amount >= 0 && item.unit);
  const version = {
    id: makeId(),
    supplementId,
    effectiveFrom: dateKey(new Date()),
    ingredients,
    sourceText: String(document.querySelector("#ingredient-raw-text").value || "").trim(),
    labelNote: String(formData.get("notes") || "").trim(),
    createdAt: Date.now(),
  };
  const supplement = {
    id: supplementId,
    name,
    brand: String(formData.get("brand") || "").trim(),
    form: String(formData.get("form") || "").trim(),
    unitLabel: String(formData.get("unitLabel") || "单位").trim() || "单位",
    dailyTargetUnits: Number(formData.get("dailyTargetUnits")) || 0,
    timing: String(formData.get("timing") || "").trim(),
    notes: String(formData.get("notes") || "").trim(),
    currentVersionId: version.id,
    archived: false,
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };

  if (existing) {
    Object.assign(existing, supplement);
    const versionIndex = state.versions.findIndex((item) => item.id === version.id);
    if (versionIndex >= 0) state.versions[versionIndex] = version;
    else state.versions.push(version);
  } else {
    state.supplements.push(supplement);
    state.versions.push(version);
  }
  await Promise.all([putRecord("supplements", supplement), putRecord("versions", version)]);
  closeSupplementModal();
  state.activeView = existing ? "supplement-detail" : "supplements";
  state.selectedSupplementId = supplementId;
  showToast(existing ? "补剂档案已更新" : "补剂档案已建立");
  render();
}

function parseIngredientText() {
  const rawText = String(document.querySelector("#ingredient-raw-text")?.value || "").trim();
  if (!rawText) {
    showToast("请先粘贴每单位含量文本");
    return;
  }
  const rows = parseIngredientRows(rawText);
  if (!rows.length) {
    showToast("没有识别到“名称 + 数值 + 单位”，请检查文本格式");
    return;
  }
  const hasExistingContent = [...document.querySelectorAll("#ingredient-list input")]
    .some((input) => input.value.trim());
  if (hasExistingContent && !window.confirm("自动识别会替换当前成分行，是否继续？")) {
    return;
  }
  const ingredientList = document.querySelector("#ingredient-list");
  ingredientList.innerHTML = "";
  rows.forEach((row) => addIngredientRow(row));
  showToast(`已识别 ${rows.length} 项成分`);
}

function parseIngredientRows(rawText) {
  const unitPattern = "mg|g|μg|ug|mcg|iu|kcal|kj|毫克|克|微克|国际单位|千卡";
  const pattern = new RegExp(
    `([^\\d\\n,;；|]+?)\\s*(?:[:：=\\-–—]\\s*)?([0-9]+(?:[.,][0-9]+)?)\\s*(${unitPattern})(?![a-z])`,
    "giu",
  );
  const rows = [];
  const seen = new Set();
  let match;
  while ((match = pattern.exec(rawText)) !== null) {
    const name = cleanIngredientName(match[1]);
    const amount = Number(match[2].replace(",", "."));
    const unit = normalizeUnit(match[3]);
    if (!name || !Number.isFinite(amount) || !unit) continue;
    const key = `${name.toLowerCase()}|${amount}|${unit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ name, amount, unit, form: "" });
  }

  const reversePattern = new RegExp(
    `([0-9]+(?:[.,][0-9]+)?)\\s*(${unitPattern})\\s+([^\\d\\n,;；|]+)`,
    "giu",
  );
  while ((match = reversePattern.exec(rawText)) !== null) {
    const name = cleanIngredientName(match[3]);
    const amount = Number(match[1].replace(",", "."));
    const unit = normalizeUnit(match[2]);
    if (!name || !Number.isFinite(amount) || !unit) continue;
    const key = `${name.toLowerCase()}|${amount}|${unit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ name, amount, unit, form: "" });
  }
  return rows;
}

function cleanIngredientName(value) {
  return String(value || "")
    .replace(/^[\s•·*、,;；|]+/u, "")
    .replace(/^(?:每(?:片|粒|份|单位)?(?:含量|含有|包含)?|成分|配料)\s*[:：]?\s*/iu, "")
    .replace(/\s*(?:每片|每粒|每份|每单位)\s*$/iu, "")
    .trim();
}

function normalizeUnit(value) {
  const normalized = String(value || "").toLowerCase();
  const map = {
    毫克: "mg",
    克: "g",
    微克: "μg",
    ug: "μg",
    mcg: "μg",
    国际单位: "IU",
    iu: "IU",
    千卡: "kcal",
    kj: "kJ",
  };
  return map[normalized] || normalized;
}

async function archiveSupplement(supplementId) {
  const supplement = state.supplements.find((item) => item.id === supplementId);
  if (!supplement) return;
  supplement.archived = true;
  supplement.updatedAt = Date.now();
  await putRecord("supplements", supplement);
  state.activeView = "supplements";
  showToast("补剂已停用，历史记录仍会保留");
  render();
}

async function exportData(period) {
  const endDate = state.selectedDate || TODAY;
  const dates = period === "week" ? getLastSevenDates(endDate) : null;
  const dateSet = dates ? new Set(dates) : null;
  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    period: dates ? { start: dates[0], end: dates[dates.length - 1] } : "all",
    settings: state.settings,
    supplements: state.supplements,
    versions: state.versions,
    waterEntries: dateSet ? state.waterEntries.filter((item) => dateSet.has(item.dateKey)) : state.waterEntries,
    intakes: dateSet ? state.intakes.filter((item) => dateSet.has(item.dateKey)) : state.intakes,
  };
  const suffix = dates ? `${dates[0]}_to_${dates[dates.length - 1]}` : new Date().toISOString().slice(0, 10);
  downloadFile(`supplement-water-${suffix}.json`, JSON.stringify(payload, null, 2), "application/json");
  showToast("备份文件已生成");
}

async function importData(file) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (!payload || payload.schemaVersion !== 1 || !Array.isArray(payload.supplements) || !Array.isArray(payload.waterEntries) || !Array.isArray(payload.intakes)) {
      throw new Error("invalid backup");
    }
    if (payload.period !== "all") {
      throw new Error("partial backup");
    }
    state.settings = { ...state.settings, ...(payload.settings || {}) };
    state.supplements = payload.supplements;
    state.versions = Array.isArray(payload.versions) ? payload.versions : [];
    state.waterEntries = payload.waterEntries;
    state.intakes = payload.intakes;
    await Promise.all([
      clearStore("settings"),
      clearStore("supplements"),
      clearStore("versions"),
      clearStore("waterEntries"),
      clearStore("intakes"),
    ]);
    await Promise.all([
      putRecord("settings", { key: "app", value: state.settings }),
      ...state.supplements.map((item) => putRecord("supplements", item)),
      ...state.versions.map((item) => putRecord("versions", item)),
      ...state.waterEntries.map((item) => putRecord("waterEntries", item)),
      ...state.intakes.map((item) => putRecord("intakes", item)),
    ]);
    showToast("备份已导入");
    render();
  } catch (error) {
    console.error(error);
    showToast("备份文件格式无法识别");
  }
}

async function installPwa() {
  if (!state.deferredInstallPrompt) {
    showToast("请在 Android Chrome 菜单中选择“添加到主屏幕”");
    return;
  }
  state.deferredInstallPrompt.prompt();
  await state.deferredInstallPrompt.userChoice;
  state.deferredInstallPrompt = null;
  const installButton = document.querySelector("#install-button");
  if (installButton) installButton.hidden = true;
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("Service worker registration failed", error));
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("is-hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("is-hidden"), 2200);
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateLabel(value, includeWeekday = true) {
  const date = parseDateKey(value);
  return new Intl.DateTimeFormat("zh-CN", includeWeekday
    ? { month: "long", day: "numeric", weekday: "short" }
    : { month: "long", day: "numeric" }).format(date);
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}

function formatNumber(value) {
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function makeId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
