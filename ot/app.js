const SHIFT_MINUTES = 570;
const MAX_ROWS_PER_PAGE = 15;
const APP_VERSION = "v1.3.0";
const TEMPLATE_PDF_URL = new URL("./templates/Blank OT form.pdf", import.meta.url).href;
const SERVICE_WORKER_URL = new URL("./sw.js", import.meta.url).href;
const THEME_STORAGE_KEY = "otFormBuilder.theme";
const DRAFT_STORAGE_KEY = "otFormBuilder.draft";
const LEGACY_THEME_STORAGE_KEY = "otFormBuilderTheme";
const LEGACY_DRAFT_STORAGE_KEY = "otFormBuilderDraft";
const DEBUG_MODE = new URLSearchParams(window.location.search).get("otDebug") === "1";
const DEBUG_LOG_STORAGE_KEY = "otFormBuilder.debugLog";
const DEBUG_COLLAPSED_STORAGE_KEY = "otFormBuilder.debugCollapsed";
const FILES_DB_NAME = "ot-form-builder-files";
const FILES_DB_VERSION = 2;
const FILES_STORE_NAME = "pdfs";
const PROJECTS_STORE_NAME = "projects";
const PROJECT_FILE_VERSION = 1;
const TIME_FIELDS = ["filmingFrom", "filmingTo", "otTo", "transferFrom", "transferTo"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PDF_COLUMNS = [22, 66, 54, 45, 45, 44, 44, 42, 58, 58, 46, 46, 62, 70, 108];
const PDF_TOTAL = PDF_COLUMNS.reduce((sum, width) => sum + width, 0);
const otRoot = document.querySelector("#ot-form-builder");

if (!otRoot) throw new Error("OT Form Builder root element was not found.");

function readLocalStorageWithLegacy(key, legacyKey) {
  const value = localStorage.getItem(key);
  if (value !== null) return value;
  const legacyValue = localStorage.getItem(legacyKey);
  if (legacyValue !== null) localStorage.setItem(key, legacyValue);
  return legacyValue;
}

const state = {
  role: "SOUNDMAN",
  activeView: "editor",
  filesTab: "projects",
  programTitle: "",
  wbsNumber: "",
  crewName: "",
  setupCollapsed: false,
  mobileDetailsCollapsed: false,
  pdfStyle: "template",
  darkMode: readLocalStorageWithLegacy(THEME_STORAGE_KEY, LEGACY_THEME_STORAGE_KEY) === "dark",
  mobileSummaryHidden: false,
  calendarMonth: "",
  collapsedMobileRows: new Set(),
  suppressDraftSave: true,
  signatures: {
    crew: [],
    producer: []
  },
  rows: []
};

const els = {
  root: otRoot,
  workspace: otRoot.querySelector("#workspace"),
  editorView: otRoot.querySelector("#editorView"),
  previewView: otRoot.querySelector("#previewView"),
  filesView: otRoot.querySelector("#filesView"),
  totalOt: otRoot.querySelector("#totalOt"),
  totalDays: otRoot.querySelector("#totalDays"),
  downloadButtons: otRoot.querySelectorAll("[data-download-pdf]"),
  saveProject: otRoot.querySelector("#saveProject"),
  loadProject: otRoot.querySelector("#loadProject"),
  clearDraft: otRoot.querySelector("#clearDraft"),
  projectFile: otRoot.querySelector("#projectFile"),
  projectMessage: otRoot.querySelector("#projectMessage"),
  filesProjectMessage: otRoot.querySelector("#filesProjectMessage"),
  draftPrompt: otRoot.querySelector("#draftPrompt"),
  resumeDraft: otRoot.querySelector("#resumeDraft"),
  startNewDraft: otRoot.querySelector("#startNewDraft"),
  mobileStickyActions: otRoot.querySelector("#mobileStickyActions"),
  mobileBottomNav: otRoot.querySelector("#mobileBottomNav"),
  mobileNavButtons: otRoot.querySelectorAll("[data-mobile-nav]"),
  stickyPreview: otRoot.querySelector("#stickyPreview"),
  stickyBack: otRoot.querySelector("#stickyBack"),
  openPreview: otRoot.querySelector("#openPreview"),
  toggleSetup: otRoot.querySelector("#toggleSetup"),
  toggleMobileDetails: otRoot.querySelector("#toggleMobileDetails"),
  themeToggle: otRoot.querySelector("#themeToggle"),
  pdfStyle: otRoot.querySelector("#pdfStyle"),
  roleButtons: otRoot.querySelectorAll("[data-role]"),
  programTitle: otRoot.querySelector("#programTitle"),
  wbsNumber: otRoot.querySelector("#wbsNumber"),
  crewName: otRoot.querySelector("#crewName"),
  crewSignaturePad: otRoot.querySelector("#crewSignaturePad"),
  producerSignaturePad: otRoot.querySelector("#producerSignaturePad"),
  clearCrewSignature: otRoot.querySelector("#clearCrewSignature"),
  clearProducerSignature: otRoot.querySelector("#clearProducerSignature"),
  firstDate: otRoot.querySelector("#firstDate"),
  endDate: otRoot.querySelector("#endDate"),
  dayCount: otRoot.querySelector("#dayCount"),
  defaultMeal: otRoot.querySelector("#defaultMeal"),
  rows: otRoot.querySelector("#rows"),
  mobileRows: otRoot.querySelector("#mobileRows"),
  mobileAddDay: otRoot.querySelector("#mobileAddDay"),
  toggleAllMobileRows: otRoot.querySelector("#toggleAllMobileRows"),
  preview: otRoot.querySelector("#formPreview"),
  filesList: otRoot.querySelector("#filesList"),
  projectsList: otRoot.querySelector("#projectsList"),
  filesTabs: otRoot.querySelectorAll("[data-files-tab]"),
  filesSections: otRoot.querySelectorAll(".files-section"),
  mobileSaveProject: otRoot.querySelector("#mobileSaveProject"),
  mobileLoadProject: otRoot.querySelector("#mobileLoadProject"),
  mobileClearDraft: otRoot.querySelector("#mobileClearDraft"),
  miniCalendar: otRoot.querySelector("#miniCalendar")
};

const debugState = {
  log: [],
  panel: null,
  summary: null,
  entries: null,
  collapsed: false,
  monitorTimer: null,
  draftStatus: "Not saved yet",
  lastDraftSaveAt: "",
  projectCount: "Checking...",
  pdfCount: "Checking...",
  lastProgramTitle: "",
  lastWbsNumber: "",
  sequence: 0
};

function debugReadDraftValues() {
  if (!DEBUG_MODE) return { programTitle: "", wbsNumber: "", crewName: "" };
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY) || localStorage.getItem(LEGACY_DRAFT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const data = parsed?.data || parsed || {};
    return {
      programTitle: data.programTitle || "",
      wbsNumber: data.wbsNumber || "",
      crewName: data.crewName || ""
    };
  } catch (error) {
    return {
      programTitle: "[draft parse error]",
      wbsNumber: "[draft parse error]",
      crewName: "[draft parse error]"
    };
  }
}

function debugCurrentView() {
  if (state.activeView === "files") return "Files";
  if (state.activeView === "preview") return "Finalise";
  return "Home";
}

function debugSnapshot(eventName) {
  const draft = debugReadDraftValues();
  return {
    id: ++debugState.sequence,
    event: eventName,
    timestamp: new Date().toISOString(),
    view: debugCurrentView(),
    visibility: document.visibilityState,
    appVersion: APP_VERSION,
    draftStatus: debugState.draftStatus,
    lastDraftSaveAt: debugState.lastDraftSaveAt,
    rowCount: state.rows.length,
    projectCount: debugState.projectCount,
    pdfCount: debugState.pdfCount,
    indexedDb: {
      database: FILES_DB_NAME,
      version: FILES_DB_VERSION,
      stores: `${PROJECTS_STORE_NAME}, ${FILES_STORE_NAME}`
    },
    dom: {
      programTitle: els.programTitle?.value || "",
      wbsNumber: els.wbsNumber?.value || "",
      crewName: els.crewName?.value || "",
      programTitleCount: document.querySelectorAll("#programTitle").length,
      wbsNumberCount: document.querySelectorAll("#wbsNumber").length,
      crewNameCount: document.querySelectorAll("#crewName").length,
      scopedProgramTitleCount: els.root.querySelectorAll("#programTitle").length,
      scopedWbsNumberCount: els.root.querySelectorAll("#wbsNumber").length,
      scopedCrewNameCount: els.root.querySelectorAll("#crewName").length
    },
    state: {
      programTitle: state.programTitle || "",
      wbsNumber: state.wbsNumber || "",
      crewName: state.crewName || ""
    },
    draft
  };
}

function debugFormatEntry(entry) {
  const details = entry.details && Object.keys(entry.details).length
    ? `details=${JSON.stringify(entry.details)}`
    : "";
  if (entry.firstBlank) {
    return [
      `!!! FIRST BLANK DETECTED !!! ${entry.timestamp}`,
      `event: ${entry.event}`,
      `field: ${entry.firstBlank.field}`,
      `previous: ${entry.firstBlank.previous}`,
      `current: ${entry.firstBlank.current}`,
      `DOM: ${entry.dom.programTitle} | ${entry.dom.wbsNumber} | ${entry.dom.crewName}`,
      `STATE: ${entry.state.programTitle} | ${entry.state.wbsNumber} | ${entry.state.crewName}`,
      `DRAFT: ${entry.draft.programTitle} | ${entry.draft.wbsNumber} | ${entry.draft.crewName}`,
      details
    ].filter(Boolean).join("\n");
  }
  return [
    `[${entry.id}] ${entry.timestamp} ${entry.event}`,
    `version=${entry.appVersion} view=${entry.view} visibility=${entry.visibility}`,
    `draftStatus="${entry.draftStatus}" lastDraftSave="${entry.lastDraftSaveAt || "-"}" rows=${entry.rowCount} projects=${entry.projectCount} pdfs=${entry.pdfCount}`,
    `DOM program="${entry.dom.programTitle}" wbs="${entry.dom.wbsNumber}" crew="${entry.dom.crewName}"`,
    `COUNTS program=${entry.dom.programTitleCount}/${entry.dom.scopedProgramTitleCount} wbs=${entry.dom.wbsNumberCount}/${entry.dom.scopedWbsNumberCount} crew=${entry.dom.crewNameCount}/${entry.dom.scopedCrewNameCount}`,
    `STATE program="${entry.state.programTitle}" wbs="${entry.state.wbsNumber}" crew="${entry.state.crewName}"`,
    `DRAFT program="${entry.draft.programTitle}" wbs="${entry.draft.wbsNumber}" crew="${entry.draft.crewName}"`,
    details
  ].filter(Boolean).join("\n");
}

function debugPersistLog() {
  if (!DEBUG_MODE) return;
  try {
    sessionStorage.setItem(DEBUG_LOG_STORAGE_KEY, JSON.stringify(debugState.log.slice(-300)));
  } catch (error) {
    console.warn("Debug log could not be saved.", error);
  }
}

function debugRenderPanel() {
  if (!DEBUG_MODE || !debugState.panel) return;
  const latest = debugState.log[debugState.log.length - 1] || debugSnapshot("debug panel ready");
  debugState.summary.innerHTML = `
    <div><b>Version</b> ${escapeHtml(latest.appVersion)}</div>
    <div><b>Time</b> ${escapeHtml(latest.timestamp)}</div>
    <div><b>View</b> ${escapeHtml(latest.view)}</div>
    <div><b>Visibility</b> ${escapeHtml(latest.visibility)}</div>
    <div><b>DOM</b> Program: ${escapeHtml(latest.dom.programTitle)} | WBS: ${escapeHtml(latest.dom.wbsNumber)} | Crew: ${escapeHtml(latest.dom.crewName)}</div>
    <div><b>Counts</b> Program: ${latest.dom.programTitleCount}/${latest.dom.scopedProgramTitleCount} | WBS: ${latest.dom.wbsNumberCount}/${latest.dom.scopedWbsNumberCount} | Crew: ${latest.dom.crewNameCount}/${latest.dom.scopedCrewNameCount}</div>
    <div><b>State</b> Program: ${escapeHtml(latest.state.programTitle)} | WBS: ${escapeHtml(latest.state.wbsNumber)}</div>
    <div><b>Draft</b> Program: ${escapeHtml(latest.draft.programTitle)} | WBS: ${escapeHtml(latest.draft.wbsNumber)}</div>
    <div><b>Draft Status</b> ${escapeHtml(latest.draftStatus)} | Last save: ${escapeHtml(latest.lastDraftSaveAt || "-")}</div>
    <div><b>Rows</b> ${latest.rowCount} | <b>Projects</b> ${escapeHtml(String(latest.projectCount))} | <b>PDFs</b> ${escapeHtml(String(latest.pdfCount))}</div>
    <div><b>IndexedDB</b> ${escapeHtml(latest.indexedDb.database)} v${latest.indexedDb.version} (${escapeHtml(latest.indexedDb.stores)})</div>
  `;
  debugState.entries.textContent = debugState.log.slice(-80).map(debugFormatEntry).join("\n\n");
  debugState.panel.classList.toggle("is-collapsed", debugState.collapsed);
}

function debugLog(eventName, details = {}) {
  if (!DEBUG_MODE) return;
  const entry = { ...debugSnapshot(eventName), details };
  if (debugState.lastProgramTitle && !entry.dom.programTitle) {
    entry.firstBlank = {
      field: "Program Title",
      previous: debugState.lastProgramTitle,
      current: entry.dom.programTitle
    };
  }
  if (!entry.firstBlank && debugState.lastWbsNumber && !entry.dom.wbsNumber) {
    entry.firstBlank = {
      field: "WBS Number",
      previous: debugState.lastWbsNumber,
      current: entry.dom.wbsNumber
    };
  }
  if (entry.dom.programTitle) debugState.lastProgramTitle = entry.dom.programTitle;
  if (entry.dom.wbsNumber) debugState.lastWbsNumber = entry.dom.wbsNumber;
  debugState.log.push(entry);
  if (debugState.log.length > 300) debugState.log.shift();
  debugPersistLog();
  debugRenderPanel();
}

function debugObserveFields(eventName) {
  if (!DEBUG_MODE) return;
  const entry = debugSnapshot(eventName);
  if (debugState.lastProgramTitle && !entry.dom.programTitle) {
    entry.firstBlank = {
      field: "Program Title",
      previous: debugState.lastProgramTitle,
      current: entry.dom.programTitle
    };
    debugState.log.push(entry);
    debugState.lastProgramTitle = "";
    debugPersistLog();
  } else if (debugState.lastWbsNumber && !entry.dom.wbsNumber) {
    entry.firstBlank = {
      field: "WBS Number",
      previous: debugState.lastWbsNumber,
      current: entry.dom.wbsNumber
    };
    debugState.log.push(entry);
    debugState.lastWbsNumber = "";
    debugPersistLog();
  }
  if (entry.dom.programTitle) debugState.lastProgramTitle = entry.dom.programTitle;
  if (entry.dom.wbsNumber) debugState.lastWbsNumber = entry.dom.wbsNumber;
  debugRenderPanel();
}

async function debugRefreshStorageCounts() {
  if (!DEBUG_MODE || !("indexedDB" in window)) return;
  try {
    const db = await openFilesDb();
    const transaction = db.transaction([PROJECTS_STORE_NAME, FILES_STORE_NAME], "readonly");
    const countStore = (storeName) => new Promise((resolve, reject) => {
      const request = transaction.objectStore(storeName).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const [projectCount, pdfCount] = await Promise.all([
      countStore(PROJECTS_STORE_NAME),
      countStore(FILES_STORE_NAME)
    ]);
    db.close();
    debugState.projectCount = projectCount;
    debugState.pdfCount = pdfCount;
    debugRenderPanel();
  } catch (error) {
    debugState.projectCount = "Unavailable";
    debugState.pdfCount = "Unavailable";
    debugLog("debug storage count error", { message: error.message });
  }
}

function debugCopyLog() {
  const text = debugState.log.map(debugFormatEntry).join("\n\n");
  if (!navigator.clipboard?.writeText) {
    window.prompt("Copy debug log", text);
    return;
  }
  navigator.clipboard.writeText(text).catch(() => {
    window.prompt("Copy debug log", text);
  });
}

function initDebugPanel() {
  if (!DEBUG_MODE) return;
  try {
    debugState.log = JSON.parse(sessionStorage.getItem(DEBUG_LOG_STORAGE_KEY) || "[]");
    debugState.collapsed = sessionStorage.getItem(DEBUG_COLLAPSED_STORAGE_KEY) === "1";
    debugState.sequence = debugState.log.reduce((max, entry) => Math.max(max, Number(entry.id) || 0), 0);
    debugState.log.forEach((entry) => {
      if (entry.dom?.programTitle) debugState.lastProgramTitle = entry.dom.programTitle;
      if (entry.dom?.wbsNumber) debugState.lastWbsNumber = entry.dom.wbsNumber;
    });
  } catch {
    debugState.log = [];
  }

  const panel = document.createElement("section");
  panel.className = "ot-debug-panel";
  panel.setAttribute("aria-label", "OT debug panel");
  panel.innerHTML = `
    <header>
      <strong>OT Debug</strong>
      <button type="button" data-debug-action="toggle">Collapse</button>
    </header>
    <div class="ot-debug-summary"></div>
    <div class="ot-debug-actions">
      <button type="button" data-debug-action="copy">Copy Debug Log</button>
      <button type="button" data-debug-action="clear">Clear Log</button>
    </div>
    <pre class="ot-debug-log"></pre>
  `;
  els.root.append(panel);
  debugState.panel = panel;
  debugState.summary = panel.querySelector(".ot-debug-summary");
  debugState.entries = panel.querySelector(".ot-debug-log");
  panel.querySelector("[data-debug-action='toggle']").textContent = debugState.collapsed ? "Expand" : "Collapse";
  panel.addEventListener("click", (event) => {
    const action = event.target.closest("[data-debug-action]")?.dataset.debugAction;
    if (action === "toggle") {
      debugState.collapsed = !debugState.collapsed;
      sessionStorage.setItem(DEBUG_COLLAPSED_STORAGE_KEY, debugState.collapsed ? "1" : "0");
      event.target.textContent = debugState.collapsed ? "Expand" : "Collapse";
      debugRenderPanel();
    }
    if (action === "copy") debugCopyLog();
    if (action === "clear") {
      debugState.log = [];
      debugState.lastProgramTitle = "";
      debugState.lastWbsNumber = "";
      sessionStorage.removeItem(DEBUG_LOG_STORAGE_KEY);
      debugLog("debug log cleared");
    }
  });
  debugLog("debug panel initialized");
  debugRefreshStorageCounts();
  debugState.monitorTimer = window.setInterval(() => debugObserveFields("field monitor"), 1200);
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function todayInputValue() {
  const date = new Date();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseInputDate(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function toInputDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fullDay(value) {
  const date = parseInputDate(value);
  if (!date) return "";
  return WEEKDAYS[date.getDay()];
}

function rowDay(row) {
  return row.day || fullDay(row.date);
}

function displayDate(value) {
  const date = parseInputDate(value);
  if (!date) return "";
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${String(date.getFullYear()).slice(-2)}`;
}

function dateDiffDays(from, to) {
  const start = parseInputDate(from);
  const end = parseInputDate(to);
  if (!start || !end) return 0;
  return Math.round((end - start) / 86400000);
}

function normaliseTime(value) {
  const cleaned = String(value || "").trim().replace(/[^\d:]/g, "");
  if (!cleaned) return "";
  if (/^\d{1,2}:\d{2}$/.test(cleaned)) {
    const [h, m] = cleaned.split(":").map(Number);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return `${pad(h)}${pad(m)}`;
  }
  if (/^\d{3,4}$/.test(cleaned)) {
    const raw = cleaned.padStart(4, "0");
    const h = Number(raw.slice(0, 2));
    const m = Number(raw.slice(2));
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return raw;
  }
  return String(value || "").trim();
}

function timeToMinutes(value) {
  const time = normaliseTime(value);
  if (!/^\d{4}$/.test(time)) return null;
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(2));
}

function minutesToTime(minutes) {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(wrapped / 60))}${pad(wrapped % 60)}`;
}

function durationMinutes(from, to) {
  const start = timeToMinutes(from);
  const end = timeToMinutes(to);
  if (start === null || end === null) return 0;
  return end >= start ? end - start : end + 1440 - start;
}

function formatHours(minutes) {
  const hours = Math.max(0, minutes) / 60;
  if (!hours) return "";
  return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 10) / 10);
}

function parseHours(value) {
  const number = Number(String(value || "").trim());
  return Number.isFinite(number) ? number : 0;
}

function createRow(dateValue) {
  return {
    id: crypto.randomUUID(),
    date: dateValue,
    day: fullDay(dateValue),
    filmingFrom: "",
    filmingTo: "",
    filmingToAuto: true,
    otFrom: "",
    otTo: "",
    mealBreak: els.defaultMeal.value || "",
    transferFrom: "",
    transferTo: "",
    filmingOt: "",
    transferOt: "",
    offRest: "",
    remarks: "",
    locked: false
  };
}

function syncSetupStateFromInputs() {
  state.programTitle = els.programTitle.value;
  state.wbsNumber = els.wbsNumber.value;
  state.crewName = els.crewName.value;
}

function restoreSetupInputsFromState() {
  els.programTitle.value = state.programTitle || "";
  els.wbsNumber.value = state.wbsNumber || "";
  els.crewName.value = state.crewName || "";
}

function applySetupValues(programTitle = "", wbsNumber = "", crewName = "") {
  state.programTitle = programTitle;
  state.wbsNumber = wbsNumber;
  state.crewName = crewName;
  restoreSetupInputsFromState();
}

function validDateValue(value) {
  return Boolean(parseInputDate(value));
}

function selectedDateValues() {
  return [...new Set(state.rows.map((row) => row.date).filter(validDateValue))].sort();
}

function datesBetween(startValue, endValue) {
  const start = parseInputDate(startValue);
  const end = parseInputDate(endValue);
  if (!start || !end) return [];
  const from = start <= end ? start : end;
  const to = start <= end ? end : start;
  const total = Math.max(0, dateDiffDays(toInputDate(from), toInputDate(to))) + 1;
  return Array.from({ length: total }, (_, index) => toInputDate(addDays(from, index)));
}

function setSelectedDates(dates, { preserveDateInputs = false, collapseNewRows = "auto" } = {}) {
  const nextDates = [...new Set(dates.filter(validDateValue))].sort();
  const wasEmpty = state.rows.length === 0;
  const existingRows = new Map(state.rows.map((row) => [row.date, row]));
  let createdCount = 0;
  const nextRows = nextDates.map((date) => {
    const existing = existingRows.get(date);
    const row = existing || createRow(date);
    row.date = date;
    row.day = fullDay(date);
    calculateRow(row);
    if (!existing) {
      const shouldCollapse = collapseNewRows === "all" || !(wasEmpty && createdCount === 0);
      if (shouldCollapse) state.collapsedMobileRows.add(row.id);
      createdCount += 1;
    }
    return row;
  });
  const nextIds = new Set(nextRows.map((row) => row.id));
  state.collapsedMobileRows.forEach((id) => {
    if (!nextIds.has(id)) state.collapsedMobileRows.delete(id);
  });
  state.rows = nextRows;
  syncDateControlsFromRows({ preserveDateInputs });
}

function generateRowsFromDateInputs() {
  if (validDateValue(els.firstDate.value) && validDateValue(els.endDate.value)) {
    setSelectedDates(datesBetween(els.firstDate.value, els.endDate.value), { preserveDateInputs: true });
  } else {
    state.rows = [];
    state.collapsedMobileRows.clear();
    els.dayCount.value = "0";
  }
  render();
}

function syncDateControlsFromRows({ preserveDateInputs = false } = {}) {
  const selectedDates = selectedDateValues();
  if (!preserveDateInputs) {
    els.firstDate.value = selectedDates[0] || "";
    els.endDate.value = selectedDates[selectedDates.length - 1] || "";
  }
  els.dayCount.value = String(selectedDates.length);
  renderMiniCalendar();
}

function dateForWeekday(currentValue, weekdayName) {
  const current = parseInputDate(currentValue);
  const targetIndex = WEEKDAYS.indexOf(weekdayName);
  if (!current || targetIndex < 0) return currentValue;
  const copy = new Date(current);
  let delta = targetIndex - copy.getDay();
  if (delta < 0) delta += 7;
  copy.setDate(copy.getDate() + delta);
  return toInputDate(copy);
}

function calculateRow(row) {
  const mealBreakMinutes = Math.round(parseHours(row.mealBreak) * 60);
  const filmingMinutes = Math.max(0, durationMinutes(row.otFrom, row.otTo) - mealBreakMinutes);
  const transferMinutes = durationMinutes(row.transferFrom, row.transferTo);

  row.filmingOt = formatHours(filmingMinutes);
  row.transferOt = formatHours(transferMinutes);
}

function suggestFilmingTo(row) {
  const start = timeToMinutes(row.filmingFrom);
  if (start === null || (!row.filmingToAuto && row.filmingTo)) return;
  row.filmingTo = minutesToTime(start + SHIFT_MINUTES);
  row.filmingToAuto = true;
}

function renderMiniCalendar() {
  if (!els.miniCalendar) return;
  const selectedDates = selectedDateValues();
  const selectedSet = new Set(selectedDates);

  const fallbackMonth = selectedDates[0]?.slice(0, 7) || els.firstDate.value?.slice(0, 7) || els.endDate.value?.slice(0, 7) || todayInputValue().slice(0, 7);
  const viewMonth = parseInputDate(`${state.calendarMonth || fallbackMonth}-01`) || new Date();
  state.calendarMonth = `${viewMonth.getFullYear()}-${pad(viewMonth.getMonth() + 1)}`;
  const monthStart = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const gridStart = addDays(monthStart, -monthStart.getDay());
  const cells = [];

  for (let index = 0; index < 42; index += 1) {
    const date = addDays(gridStart, index);
    const value = toInputDate(date);
    const isSelected = selectedSet.has(value);
    const isOutsideMonth = date.getMonth() !== viewMonth.getMonth();
    const className = [
      "calendar-day",
      isOutsideMonth ? "is-outside" : "",
      isSelected ? "is-selected" : "",
      value === selectedDates[0] ? "is-start" : "",
      value === selectedDates[selectedDates.length - 1] ? "is-end" : ""
    ].filter(Boolean).join(" ");
    cells.push(`<button class="${className}" type="button" data-calendar-date="${value}" aria-pressed="${isSelected ? "true" : "false"}">${date.getDate()}</button>`);
  }

  const title = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(viewMonth);
  els.miniCalendar.innerHTML = `
    <section class="calendar-month">
      <div class="calendar-title">
        <button class="calendar-nav" type="button" data-calendar-nav="-1" aria-label="Previous month">‹</button>
        <span>${title}</span>
        <button class="calendar-nav" type="button" data-calendar-nav="1" aria-label="Next month">›</button>
      </div>
      <div class="calendar-weekdays">${["S", "M", "T", "W", "T", "F", "S"].map((day) => `<span>${day}</span>`).join("")}</div>
      <div class="calendar-grid">${cells.join("")}</div>
    </section>
  `;
}

function canvasPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
  return { x, y };
}

function drawSignaturePad(canvas, strokes) {
  if (!canvas?.getContext) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#0738c7";
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  strokes.forEach((stroke) => {
    if (!stroke.length) return;
    ctx.beginPath();
    ctx.moveTo(stroke[0].x * width, stroke[0].y * height);
    stroke.slice(1).forEach((point) => ctx.lineTo(point.x * width, point.y * height));
    ctx.stroke();
  });
}

function setupSignaturePad(canvas, strokes, clearButton) {
  if (!canvas?.getContext) return;
  let activeStroke = null;

  const finishStroke = () => {
    activeStroke = null;
    renderPreview();
    scheduleDraftSave();
  };

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    activeStroke = [canvasPoint(canvas, event)];
    strokes.push(activeStroke);
    drawSignaturePad(canvas, strokes);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!activeStroke) return;
    event.preventDefault();
    activeStroke.push(canvasPoint(canvas, event));
    drawSignaturePad(canvas, strokes);
  });

  canvas.addEventListener("pointerup", finishStroke);
  canvas.addEventListener("pointercancel", finishStroke);

  clearButton?.addEventListener("click", () => {
    strokes.length = 0;
    drawSignaturePad(canvas, strokes);
    renderPreview();
    scheduleDraftSave();
  });

  drawSignaturePad(canvas, strokes);
}

function drawPdfSignature(commands, strokes, x, y, width, height, lineWidth = 1.15) {
  if (!strokes.length) return;
  commands.push("q", "0.02 0.22 0.78 RG", `${lineWidth} w`, "1 J", "1 j");
  strokes.forEach((stroke) => {
    if (!stroke.length) return;
    const first = stroke[0];
    commands.push(`${(x + first.x * width).toFixed(2)} ${(y + (1 - first.y) * height).toFixed(2)} m`);
    stroke.slice(1).forEach((point) => {
      commands.push(`${(x + point.x * width).toFixed(2)} ${(y + (1 - point.y) * height).toFixed(2)} l`);
    });
    commands.push("S");
  });
  commands.push("Q");
}

function signatureSvg(strokes, className = "preview-signature") {
  if (!strokes.length) return "";
  const allPoints = strokes.flat().filter(Boolean);
  if (!allPoints.length) return "";
  const minX = Math.max(0, Math.min(...allPoints.map((point) => point.x * 100)) - 6);
  const maxX = Math.min(100, Math.max(...allPoints.map((point) => point.x * 100)) + 6);
  const minY = Math.max(0, Math.min(...allPoints.map((point) => point.y * 100)) - 10);
  const maxY = Math.min(100, Math.max(...allPoints.map((point) => point.y * 100)) + 10);
  const viewBox = `${minX.toFixed(1)} ${minY.toFixed(1)} ${Math.max(1, maxX - minX).toFixed(1)} ${Math.max(1, maxY - minY).toFixed(1)}`;
  const paths = strokes.map((stroke) => {
    if (!stroke.length) return "";
    const [first, ...rest] = stroke;
    const points = [`M ${(first.x * 100).toFixed(1)} ${(first.y * 100).toFixed(1)}`]
      .concat(rest.map((point) => `L ${(point.x * 100).toFixed(1)} ${(point.y * 100).toFixed(1)}`))
      .join(" ");
    return `<path d="${points}" vector-effect="non-scaling-stroke"></path>`;
  }).join("");
  return `<svg class="${className}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${paths}</svg>`;
}

function signatureProjectData() {
  return {
    crewName: els.crewName.value,
    crewSignature: state.signatures.crew.map((stroke) => stroke.map((point) => ({ ...point }))),
    producerSignature: state.signatures.producer.map((stroke) => stroke.map((point) => ({ ...point })))
  };
}

function restoreSignatureProjectData(data = {}) {
  els.crewName.value = data.crewName || "";
  state.signatures.crew.splice(0, state.signatures.crew.length, ...(Array.isArray(data.crewSignature) ? data.crewSignature : []));
  state.signatures.producer.splice(0, state.signatures.producer.length, ...(Array.isArray(data.producerSignature) ? data.producerSignature : []));
  drawSignaturePad(els.crewSignaturePad, state.signatures.crew);
  drawSignaturePad(els.producerSignaturePad, state.signatures.producer);
}

function cloneStrokes(strokes) {
  return Array.isArray(strokes)
    ? strokes.map((stroke) => Array.isArray(stroke) ? stroke.map((point) => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 })) : [])
    : [];
}

function sanitizeFilename(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pdfFallbackName() {
  return `OT Form - ${todayInputValue()}.pdf`;
}

function pdfFileName() {
  const program = sanitizeFilename(els.programTitle.value);
  return program ? `${program}.pdf` : pdfFallbackName();
}

function projectDisplayName() {
  return sanitizeFilename(els.programTitle.value) || "OT Project";
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function openFilesDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is not available."));
      return;
    }
    const request = indexedDB.open(FILES_DB_NAME, FILES_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILES_STORE_NAME)) {
        const store = db.createObjectStore(FILES_STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
      if (!db.objectStoreNames.contains(PROJECTS_STORE_NAME)) {
        const store = db.createObjectStore(PROJECTS_STORE_NAME, { keyPath: "name" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function filesStore(mode = "readonly") {
  return openFilesDb().then((db) => ({
    db,
    store: db.transaction(FILES_STORE_NAME, mode).objectStore(FILES_STORE_NAME)
  }));
}

function projectsStore(mode = "readonly") {
  return openFilesDb().then((db) => ({
    db,
    store: db.transaction(PROJECTS_STORE_NAME, mode).objectStore(PROJECTS_STORE_NAME)
  }));
}

async function savePdfToFiles(blob, filename) {
  debugLog("before PDF IndexedDB save", { filename, size: blob.size });
  const { db, store } = await filesStore("readwrite");
  const record = {
    id: crypto.randomUUID(),
    filename,
    programTitle: els.programTitle.value.trim(),
    createdAt: new Date().toISOString(),
    size: blob.size,
    blob
  };
  await new Promise((resolve, reject) => {
    const request = store.put(record);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  db.close();
  if (state.activeView === "files") renderFilesList();
  debugLog("after PDF IndexedDB save", { filename, size: blob.size });
  debugRefreshStorageCounts();
}

async function getProjectRecord(name) {
  const { db, store } = await projectsStore();
  const record = await new Promise((resolve, reject) => {
    const request = store.get(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return record;
}

async function saveProjectToFiles(project, name) {
  debugLog("before project IndexedDB save", { name });
  const { db, store } = await projectsStore("readwrite");
  const now = new Date().toISOString();
  const record = {
    name,
    filename: `${name}.json`,
    programTitle: els.programTitle.value.trim(),
    dayCount: selectedDateValues().length,
    updatedAt: now,
    project
  };
  await new Promise((resolve, reject) => {
    const request = store.put(record);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  db.close();
  if (state.activeView === "files" && state.filesTab === "projects") renderProjectsList();
  debugLog("after project IndexedDB save", { name });
  debugRefreshStorageCounts();
}

async function getProjectFiles() {
  const { db, store } = await projectsStore();
  const projects = await new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function deleteProjectFile(name) {
  const { db, store } = await projectsStore("readwrite");
  await new Promise((resolve, reject) => {
    const request = store.delete(name);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  db.close();
  renderProjectsList();
  debugRefreshStorageCounts();
}

async function getPdfFiles() {
  const { db, store } = await filesStore();
  const files = await new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return files.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function getPdfFile(id) {
  const { db, store } = await filesStore();
  const file = await new Promise((resolve, reject) => {
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return file;
}

async function deletePdfFile(id) {
  const { db, store } = await filesStore("readwrite");
  await new Promise((resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  db.close();
  renderFilesList();
  debugRefreshStorageCounts();
}

function triggerBlobDownload(blob, filename) {
  debugLog("before triggerBlobDownload", { filename });
  saveDraftNow();
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  els.root.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  debugLog("immediately after triggerBlobDownload", { filename });
}

function openPdfBlob(blob) {
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function projectRows() {
  return state.rows.map((row) => ({
    id: row.id,
    date: row.date,
    day: row.day,
    filmingFrom: row.filmingFrom,
    filmingTo: row.filmingTo,
    filmingToAuto: Boolean(row.filmingToAuto),
    otFrom: row.otFrom,
    otTo: row.otTo,
    mealBreak: row.mealBreak,
    transferFrom: row.transferFrom,
    transferTo: row.transferTo,
    filmingOt: row.filmingOt,
    transferOt: row.transferOt,
    offRest: row.offRest,
    remarks: row.remarks,
    locked: Boolean(row.locked)
  }));
}

function selectedCalendarDates() {
  return selectedDateValues();
}

function activeProjectData() {
  debugLog("before project data collection");
  const project = {
    schema: "ot-form-builder-project",
    version: PROJECT_FILE_VERSION,
    savedAt: new Date().toISOString(),
    data: {
      role: state.role,
      activeView: state.activeView,
      setupCollapsed: state.setupCollapsed,
      mobileDetailsCollapsed: state.mobileDetailsCollapsed,
      pdfStyle: state.pdfStyle,
      darkMode: state.darkMode,
      calendarMonth: state.calendarMonth,
      collapsedMobileRows: Array.from(state.collapsedMobileRows),
      selectedCalendarDates: selectedCalendarDates(),
      firstDate: els.firstDate.value,
      endDate: els.endDate.value,
      dayCount: els.dayCount.value,
      defaultMeal: els.defaultMeal.value,
      programTitle: els.programTitle.value,
      wbsNumber: els.wbsNumber.value,
      crewName: els.crewName.value,
      rows: projectRows(),
      calculations: {
        totalOt: formatTotal(totalOt())
      },
      signatures: {
        crew: cloneStrokes(state.signatures.crew),
        producer: cloneStrokes(state.signatures.producer)
      }
    }
  };
  debugLog("after project data collection", {
    programTitle: project.data.programTitle,
    wbsNumber: project.data.wbsNumber,
    crewName: project.data.crewName
  });
  return project;
}

function showProjectMessage(message, isError = false) {
  [els.projectMessage, els.filesProjectMessage].filter(Boolean).forEach((messageEl) => {
    messageEl.textContent = message;
    messageEl.classList.toggle("is-error", isError);
  });
  clearTimeout(showProjectMessage.timer);
  showProjectMessage.timer = setTimeout(() => {
    [els.projectMessage, els.filesProjectMessage].filter(Boolean).forEach((messageEl) => {
      messageEl.textContent = "";
      messageEl.classList.remove("is-error");
    });
  }, 3600);
}

function confirmDeleteDay(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-sheet";
    overlay.innerHTML = `
      <div class="confirm-card" role="dialog" aria-modal="true" aria-labelledby="confirmDeleteTitle">
        <h2 id="confirmDeleteTitle">${escapeHtml(message)}</h2>
        <div class="confirm-actions">
          <button class="secondary-button" type="button" data-confirm-action="cancel">Cancel</button>
          <button class="primary-button danger-confirm" type="button" data-confirm-action="delete">Delete</button>
        </div>
      </div>
    `;
    els.root.append(overlay);

    const finish = (result) => {
      overlay.remove();
      resolve(result);
    };

    overlay.addEventListener("click", (event) => {
      const action = event.target.closest("[data-confirm-action]")?.dataset.confirmAction;
      if (action === "delete") finish(true);
      if (action === "cancel" || event.target === overlay) finish(false);
    });
  });
}

function confirmReplaceSavedProject(name) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-sheet";
    overlay.innerHTML = `
      <div class="confirm-card" role="dialog" aria-modal="true" aria-labelledby="confirmReplaceTitle">
        <h2 id="confirmReplaceTitle">A saved project with this name already exists. Replace it?</h2>
        <p>${escapeHtml(name)}</p>
        <div class="confirm-actions">
          <button class="secondary-button" type="button" data-confirm-action="cancel">Cancel</button>
          <button class="primary-button" type="button" data-confirm-action="replace">Replace</button>
        </div>
      </div>
    `;
    els.root.append(overlay);

    const finish = (result) => {
      overlay.remove();
      resolve(result);
    };

    overlay.addEventListener("click", (event) => {
      const action = event.target.closest("[data-confirm-action]")?.dataset.confirmAction;
      if (action === "replace") finish(true);
      if (action === "cancel" || event.target === overlay) finish(false);
    });
  });
}

function safeProjectName() {
  return `${projectDisplayName()}.json`;
}

function saveDraftNow() {
  if (state.suppressDraftSave) return;
  debugState.draftStatus = "Saving...";
  debugLog("before saveDraft");
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(activeProjectData()));
    debugState.draftStatus = "Saved";
    debugState.lastDraftSaveAt = new Date().toISOString();
    debugLog("after saveDraft");
  } catch (error) {
    debugState.draftStatus = "Save failed";
    console.warn("Draft could not be saved.", error);
    debugLog("after saveDraft error", { message: error.message });
  }
}

function scheduleDraftSave() {
  if (state.suppressDraftSave) return;
  clearTimeout(scheduleDraftSave.timer);
  scheduleDraftSave.timer = setTimeout(saveDraftNow, 120);
}

function clearDraft() {
  if (!window.confirm("Clear the saved local draft?")) return;
  debugLog("before clear draft");
  clearTimeout(scheduleDraftSave.timer);
  localStorage.removeItem(DRAFT_STORAGE_KEY);
  localStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
  hideDraftPrompt();
  initializeFreshProject();
  localStorage.removeItem(DRAFT_STORAGE_KEY);
  localStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
  debugState.draftStatus = "Cleared";
  debugState.lastDraftSaveAt = "";
  debugLog("after clear draft");
  showProjectMessage("Draft cleared.");
  return true;
}

function saveProject() {
  debugLog("before Save Project");
  saveDraftNow();
  state.rows.forEach(calculateRow);
  const project = activeProjectData();
  debugLog("before project JSON serialization");
  const json = JSON.stringify(project, null, 2);
  debugLog("after project JSON serialization");
  const blob = new Blob([json], { type: "application/json" });
  triggerBlobDownload(blob, safeProjectName());
  showProjectMessage("Project saved.");
  debugLog("after Save Project");
}

async function saveCurrentProjectToFiles() {
  debugLog("before Save Current Project");
  saveDraftNow();
  state.rows.forEach(calculateRow);
  const project = activeProjectData();
  const name = projectDisplayName();
  debugLog("before project JSON serialization");
  const json = JSON.stringify(project, null, 2);
  debugLog("after project JSON serialization");
  const blob = new Blob([json], { type: "application/json" });
  try {
    const existing = await getProjectRecord(name);
    if (existing && !await confirmReplaceSavedProject(name)) return;
    await saveProjectToFiles(project, name);
    showProjectMessage(existing ? "Project replaced." : "Project saved to Files.");
  } catch (error) {
    console.error(error);
    debugLog("Save Current Project error", { message: error.message });
    showProjectMessage("Project backup downloaded, but local save failed.", true);
  }
  triggerBlobDownload(blob, `${name}.json`);
  debugLog("after Save Current Project");
}

function rowFromProject(row = {}) {
  return {
    id: row.id || crypto.randomUUID(),
    date: row.date || "",
    day: row.day || fullDay(row.date),
    filmingFrom: row.filmingFrom || "",
    filmingTo: row.filmingTo || "",
    filmingToAuto: row.filmingToAuto !== false,
    otFrom: row.otFrom || "",
    otTo: row.otTo || "",
    mealBreak: row.mealBreak === "0" ? "" : row.mealBreak || "",
    transferFrom: row.transferFrom || "",
    transferTo: row.transferTo || "",
    filmingOt: row.filmingOt || "",
    transferOt: row.transferOt || "",
    offRest: row.offRest || "",
    remarks: row.remarks || "",
    locked: Boolean(row.locked)
  };
}

function restoreProject(project, options = {}) {
  debugLog("before restoreProject", { silent: Boolean(options.silent) });
  const data = project?.data || project || {};
  const selectedDates = Array.isArray(data.selectedCalendarDates) ? data.selectedCalendarDates : [];
  applySetupValues(data.programTitle || "", data.wbsNumber || "", data.crewName || "");
  els.firstDate.value = data.firstDate || selectedDates[0] || "";
  els.endDate.value = data.endDate || selectedDates[selectedDates.length - 1] || "";
  els.dayCount.value = data.dayCount || String(Array.isArray(data.rows) ? data.rows.length : selectedDates.length);
  els.defaultMeal.value = data.defaultMeal || "";

  state.role = data.role === "CAMERAMAN" ? "CAMERAMAN" : "SOUNDMAN";
  state.activeView = data.activeView === "preview" ? "preview" : "editor";
  state.setupCollapsed = Boolean(data.setupCollapsed);
  state.mobileDetailsCollapsed = Boolean(data.mobileDetailsCollapsed);
  state.pdfStyle = data.pdfStyle === "clean" ? "clean" : "template";
  state.darkMode = Boolean(data.darkMode);
  state.calendarMonth = data.calendarMonth || selectedDates[0]?.slice(0, 7) || "";
  state.collapsedMobileRows = new Set(Array.isArray(data.collapsedMobileRows) ? data.collapsedMobileRows : []);
  localStorage.setItem(THEME_STORAGE_KEY, state.darkMode ? "dark" : "light");

  state.rows = Array.isArray(data.rows) ? data.rows.map(rowFromProject).filter((row) => validDateValue(row.date)) : [];
  if (!state.rows.length && selectedDates.length) {
    state.rows = selectedDates.map((date) => createRow(date));
  }
  setSelectedDates(state.rows.length ? state.rows.map((row) => row.date) : selectedDates);
  const rowDataByDate = new Map((Array.isArray(data.rows) ? data.rows : []).map((row) => [row.date, row]));
  state.rows = state.rows.map((row) => rowDataByDate.has(row.date) ? rowFromProject(rowDataByDate.get(row.date)) : row);
  state.rows.forEach((row) => {
    row.day = fullDay(row.date);
    calculateRow(row);
  });

  state.signatures.crew.splice(0, state.signatures.crew.length, ...cloneStrokes(data.signatures?.crew || data.crewSignature));
  state.signatures.producer.splice(0, state.signatures.producer.length, ...cloneStrokes(data.signatures?.producer || data.producerSignature));
  if (!Array.isArray(data.collapsedMobileRows)) state.collapsedMobileRows.clear();

  syncDateControlsFromRows();
  render();
  if (!options.silent) showProjectMessage("Project loaded.");
  debugLog("after restoreProject", { silent: Boolean(options.silent) });
}

function readDraft() {
  try {
    const raw = readLocalStorageWithLegacy(DRAFT_STORAGE_KEY, LEGACY_DRAFT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function showDraftPrompt() {
  els.draftPrompt.hidden = false;
}

function hideDraftPrompt() {
  els.draftPrompt.hidden = true;
}

function initializeFreshProject() {
  state.suppressDraftSave = true;
  applySetupValues("", "", "");
  state.role = "SOUNDMAN";
  state.activeView = "editor";
  state.setupCollapsed = false;
  state.mobileDetailsCollapsed = false;
  state.pdfStyle = "template";
  state.calendarMonth = "";
  state.collapsedMobileRows.clear();
  state.signatures.crew.length = 0;
  state.signatures.producer.length = 0;
  els.firstDate.value = "";
  els.endDate.value = "";
  els.dayCount.value = "0";
  els.defaultMeal.value = "";
  state.rows = [];
  syncDateControlsFromRows();
  render();
  state.suppressDraftSave = false;
}

function initializeApp() {
  debugLog("initializeApp start");
  const draft = readDraft();
  if (draft) {
    state.suppressDraftSave = true;
    debugLog("draft restore from startup");
    restoreProject(draft, { silent: true });
    showDraftPrompt();
    debugLog("initializeApp draft prompt shown");
    return;
  }
  initializeFreshProject();
  debugLog("initializeApp fresh project");
}

function disableServiceWorkerCaching() {
  window.addEventListener("load", async () => {
    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations
          .filter((registration) => [registration.active, registration.installing, registration.waiting]
            .some((worker) => worker?.scriptURL === SERVICE_WORKER_URL))
          .map((registration) => registration.unregister()));
      }

      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((key) => key.startsWith("ot-form-builder-"))
            .map((key) => caches.delete(key))
        );
      }
    } catch (error) {
      console.warn("Service worker cleanup failed.", error);
    }
  });
}

async function loadProjectFile(file) {
  if (!file) return;
  try {
    debugLog("project load from JSON file", { filename: file.name || "selected file" });
    const text = await file.text();
    const project = JSON.parse(text);
    restoreProject(project);
    state.activeView = "editor";
    render();
  } catch (error) {
    console.error(error);
    debugLog("Project load error", { message: error.message });
    showProjectMessage("Project could not be loaded.", true);
  } finally {
    els.projectFile.value = "";
  }
}

function totalOt() {
  return state.rows.reduce((sum, row) => sum + parseHours(row.filmingOt) + parseHours(row.transferOt), 0);
}

function rowTotalOt(row) {
  return parseHours(row.filmingOt) + parseHours(row.transferOt);
}

function dateRangeText() {
  const dates = state.rows.map((row) => row.date).filter(Boolean);
  if (!dates.length) return { from: "", to: "" };
  return {
    from: displayDate(dates[0]),
    to: displayDate(dates[dates.length - 1])
  };
}

function emptyDash(value) {
  return value || "-";
}

function isPopulatedOtRow(row) {
  return Boolean(row && [
    row.filmingFrom,
    row.filmingTo,
    row.otFrom,
    row.otTo,
    row.transferFrom,
    row.transferTo,
    row.filmingOt,
    row.transferOt,
    row.offRest,
    row.remarks
  ].some(Boolean));
}

function rowHasEditableData(row) {
  return Boolean(row && [
    row.filmingFrom,
    row.filmingTo,
    row.otFrom,
    row.otTo,
    row.mealBreak,
    row.transferFrom,
    row.transferTo,
    row.offRest,
    row.remarks
  ].some((value) => String(value || "").trim()));
}

function renderRows() {
  els.rows.innerHTML = state.rows.map((row, index) => `
    <tr data-id="${row.id}">
      <td>${index + 1}</td>
      <td class="day-cell">
        ${index === 0 ? `
          <select data-field="day">
            ${WEEKDAYS.map((day) => `<option value="${day}"${rowDay(row) === day ? " selected" : ""}>${day}</option>`).join("")}
          </select>
        ` : `<span class="readonly-day">${rowDay(row)}</span>`}
      </td>
      <td><input data-field="date" type="date" value="${row.date}"></td>
      <td><input data-field="filmingFrom" inputmode="numeric" value="${row.filmingFrom}" placeholder="0800"></td>
      <td><input data-field="filmingTo" inputmode="numeric" value="${row.filmingTo}" placeholder="1730"></td>
      <td><input data-field="otFrom" inputmode="numeric" value="${row.otFrom}"></td>
      <td><input data-field="otTo" inputmode="numeric" value="${row.otTo}"></td>
      <td>
        <select data-field="mealBreak">
          <option value=""${row.mealBreak === "" ? " selected" : ""}>None</option>
          <option value="0.5"${row.mealBreak === "0.5" ? " selected" : ""}>0.5</option>
          <option value="1"${row.mealBreak === "1" ? " selected" : ""}>1</option>
        </select>
      </td>
      <td><input data-field="transferFrom" inputmode="numeric" value="${row.transferFrom}" placeholder="Optional"></td>
      <td><input data-field="transferTo" inputmode="numeric" value="${row.transferTo}" placeholder="Optional"></td>
      <td class="calc-cell"><input data-field="filmingOt" value="${row.filmingOt}" readonly></td>
      <td class="calc-cell"><input data-field="transferOt" value="${row.transferOt}" readonly></td>
      <td>
        <select data-field="offRest">
          <option value=""${row.offRest === "" ? " selected" : ""}>-</option>
          <option value="OFF"${row.offRest === "OFF" ? " selected" : ""}>OFF</option>
          <option value="REST"${row.offRest === "REST" ? " selected" : ""}>REST</option>
        </select>
      </td>
      <td><input data-field="remarks" value="${escapeHtml(row.remarks)}" placeholder="Optional"></td>
      <td><button class="delete-row" type="button" aria-label="Remove row">x</button></td>
    </tr>
  `).join("");

  els.mobileRows.innerHTML = state.rows.map((row, index) => {
    const collapsed = state.collapsedMobileRows.has(row.id);
    const hasEditableData = rowHasEditableData(row);
    if (row.locked && !hasEditableData) row.locked = false;
    const locked = Boolean(row.locked);
    const lockDisabled = !locked && !hasEditableData;
    const lockedAttr = locked ? " disabled" : "";
    return `
    <article class="mobile-entry-card${collapsed ? " is-collapsed" : ""}${locked ? " is-locked" : ""}" data-id="${row.id}">
      <header class="mobile-entry-card-header">
        <button class="mobile-card-toggle" type="button" aria-expanded="${collapsed ? "false" : "true"}" aria-label="${collapsed ? "Expand" : "Collapse"} day ${index + 1}">
          <span class="mobile-card-title">
            <span>Day ${index + 1}</span>
            <strong>${escapeHtml(rowDay(row))} · ${displayDate(row.date) || "-"}</strong>
          </span>
          <b aria-hidden="true">${collapsed ? "⌄" : "⌃"}</b>
        </button>
        <button class="mobile-lock-row${locked ? " is-active" : ""}" type="button" aria-pressed="${locked ? "true" : "false"}" aria-label="${locked ? "Unlock" : "Lock"} day ${index + 1}"${lockDisabled ? " disabled" : ""}>
          <span aria-hidden="true">${locked ? "🔒" : "🔓"}</span>
        </button>
        ${locked ? "" : `<button class="delete-row mobile-delete-row" type="button" aria-label="Remove day ${index + 1}">×</button>`}
      </header>
      ${locked ? `<div class="locked-badge" aria-label="This day is locked">LOCKED</div>` : ""}
      <div class="mobile-entry-grid">
        <label>
          Filming From
          <input data-field="filmingFrom" inputmode="numeric" value="${row.filmingFrom}" placeholder="0800"${lockedAttr}>
        </label>
        <label>
          Filming To
          <input data-field="filmingTo" inputmode="numeric" value="${row.filmingTo}" placeholder="1730"${lockedAttr}>
        </label>
        <label>
          OT From
          <input data-field="otFrom" inputmode="numeric" value="${row.otFrom}"${lockedAttr}>
        </label>
        <label>
          OT To
          <input data-field="otTo" inputmode="numeric" value="${row.otTo}"${lockedAttr}>
        </label>
        <label class="mobile-meal-field">
          Meal Break
          <select data-field="mealBreak"${lockedAttr}>
            <option value=""${row.mealBreak === "" ? " selected" : ""}>None</option>
            <option value="0.5"${row.mealBreak === "0.5" ? " selected" : ""}>0.5</option>
            <option value="1"${row.mealBreak === "1" ? " selected" : ""}>1</option>
          </select>
        </label>
        <label class="mobile-offrest-field">
          Off/Rest
          <select data-field="offRest"${lockedAttr}>
            <option value=""${row.offRest === "" ? " selected" : ""}>-</option>
            <option value="OFF"${row.offRest === "OFF" ? " selected" : ""}>OFF</option>
            <option value="REST"${row.offRest === "REST" ? " selected" : ""}>REST</option>
          </select>
        </label>
        <label>
          Transfer From
          <input data-field="transferFrom" inputmode="numeric" value="${row.transferFrom}" placeholder="Optional"${lockedAttr}>
        </label>
        <label>
          Transfer To
          <input data-field="transferTo" inputmode="numeric" value="${row.transferTo}" placeholder="Optional"${lockedAttr}>
        </label>
        <label class="mobile-entry-full">
          Remarks
          <input data-field="remarks" value="${escapeHtml(row.remarks)}" placeholder="Optional"${lockedAttr}>
        </label>
      </div>
      <footer class="mobile-entry-totals">
        <span>Filming OT <strong>${emptyDash(row.filmingOt)}</strong></span>
        <span>Transfer OT <strong>${emptyDash(row.transferOt)}</strong></span>
        <span class="mobile-entry-total">Total <strong>${formatTotal(rowTotalOt(row))} hrs</strong></span>
      </footer>
    </article>
  `}).join("");
  if (els.mobileAddDay) {
    els.mobileAddDay.hidden = state.rows.length === 0;
  }
}

function renderPreview() {
  const range = dateRangeText();
  const previewRows = Array.from({ length: MAX_ROWS_PER_PAGE }, (_, index) => state.rows[index] || null);
  const producerSignature = signatureSvg(state.signatures.producer);
  const crewSignature = signatureSvg(state.signatures.crew, "preview-signature bottom-signature");
  els.preview.innerHTML = `
    <div class="paper">
      <div class="paper-title">
        <div>NEWS/CA PRODUCTION SERVICES (Camera Unit) - ${state.role}</div>
        <div>Working Hours during Overseas Assignment</div>
      </div>
      <div class="paper-top">
        <div>
          <div class="paper-line"><b>PROGRAM TITLE:</b><span>${escapeHtml(els.programTitle.value)}</span></div>
          <div class="paper-line"><b>DATE: FROM</b><span>${range.from}</span></div>
        </div>
        <div>
          <div class="paper-line"><b>WBS NUMBER:</b><span>${escapeHtml(els.wbsNumber.value)}</span></div>
          <div class="paper-line"><b>TO:</b><span>${range.to}</span></div>
        </div>
      </div>
      <table class="pdf-table">
        <colgroup>
          ${PDF_COLUMNS.map((width) => `<col style="width:${(width / PDF_TOTAL * 100).toFixed(3)}%">`).join("")}
        </colgroup>
        <thead>
          <tr>
            <th rowspan="2">No.</th>
            <th colspan="4">DATE and TIME of FILMING</th>
            <th colspan="2">OT from FILMING</th>
            <th rowspan="2">MEAL<br>BREAK</th>
            <th colspan="2">TRANSFER to HDD or FTP</th>
            <th colspan="2">OT HOURS</th>
            <th rowspan="2">OFF /<br>REST</th>
            <th rowspan="2">REMARKS</th>
            <th class="signature-header" rowspan="2">PRODUCER'S /<br>REPORTER'S<br>SIGNATURE</th>
          </tr>
          <tr class="subhead">
            <th>Day</th><th>Date</th><th>From</th><th>To</th>
            <th>From</th><th>To</th>
            <th>From</th><th>To</th>
            <th>Filming</th><th>Transfer</th>
          </tr>
        </thead>
        <tbody>
          ${previewRows.map((row, index) => `
            <tr>
              <td>${index + 1}</td>
              <td>${row ? rowDay(row) : ""}</td>
              <td>${row ? displayDate(row.date).slice(0, 5) : ""}</td>
              <td>${row ? emptyDash(row.filmingFrom) : ""}</td>
              <td>${row ? emptyDash(row.filmingTo) : ""}</td>
              <td>${row ? emptyDash(row.otFrom) : ""}</td>
              <td>${row ? emptyDash(row.otTo) : ""}</td>
              <td>${row ? (parseHours(row.mealBreak) ? row.mealBreak : "-") : ""}</td>
              <td>${row ? emptyDash(row.transferFrom) : ""}</td>
              <td>${row ? emptyDash(row.transferTo) : ""}</td>
              <td>${row ? emptyDash(row.filmingOt) : ""}</td>
              <td>${row ? emptyDash(row.transferOt) : ""}</td>
              <td>${row ? emptyDash(row.offRest) : ""}</td>
              <td class="remarks-cell">${row ? escapeHtml(row.remarks) : ""}</td>
              <td>${row && isPopulatedOtRow(row) ? producerSignature : ""}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <div class="total-row">
        <div></div><div>TOTAL OT</div><div class="total-box">${formatTotal(totalOt())}</div><div class="total-box"></div><div></div>
      </div>
      <div class="signatures">
        <div>
          <div class="sig-line"><b>${titleCase(state.role)}:</b><span>${escapeHtml(els.crewName.value)}</span></div>
          <div class="sig-line"><b>Certified by:</b><span></span></div>
        </div>
        <div>
          <div class="sig-line"><b>Signature:</b><span>${crewSignature}</span></div>
          <div class="sig-line"><b>Signature:</b><span></span></div>
        </div>
      </div>
    </div>
  `;
}

async function renderFilesList() {
  if (!els.filesList) return;
  els.filesList.innerHTML = `<div class="files-empty">Loading files...</div>`;
  try {
    const files = await getPdfFiles();
    if (!files.length) {
      els.filesList.innerHTML = `
        <div class="files-empty">
          <strong>No PDFs saved yet.</strong>
          <span>Downloaded PDFs will appear here on this device.</span>
        </div>
      `;
      return;
    }
    els.filesList.innerHTML = files.map((file) => {
      const created = file.createdAt ? new Date(file.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
      return `
        <article class="file-card" data-file-id="${file.id}">
          <div>
            <h3>${escapeHtml(file.filename)}</h3>
            <p>${escapeHtml(file.programTitle || "Untitled program")}</p>
            <span>${escapeHtml(created)}${file.size ? ` · ${formatFileSize(file.size)}` : ""}</span>
          </div>
          <div class="file-actions">
            <button class="secondary-button" type="button" data-file-action="open">Open</button>
            <button class="secondary-button" type="button" data-file-action="download">Download Again</button>
            <button class="secondary-button danger-button" type="button" data-file-action="delete">Delete</button>
          </div>
        </article>
      `;
    }).join("");
  } catch (error) {
    console.error(error);
    els.filesList.innerHTML = `<div class="files-empty">Files could not be loaded on this device.</div>`;
  }
}

async function renderProjectsList() {
  if (!els.projectsList) return;
  els.projectsList.innerHTML = `<div class="files-empty">Loading projects...</div>`;
  try {
    const projects = await getProjectFiles();
    if (!projects.length) {
      els.projectsList.innerHTML = `
        <div class="files-empty">
          <strong>No projects saved yet.</strong>
          <span>Use Save Current Project to keep an editable copy on this device.</span>
        </div>
      `;
      return;
    }
    els.projectsList.innerHTML = projects.map((project) => {
      const updated = project.updatedAt ? new Date(project.updatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
      const days = Number(project.dayCount) || 0;
      return `
        <article class="file-card" data-project-name="${escapeHtml(project.name)}">
          <div>
            <h3>${escapeHtml(project.programTitle || project.name || "OT Project")}</h3>
            <p>${escapeHtml(project.filename || `${project.name}.json`)}</p>
            <span>${escapeHtml(updated)}${days ? ` · ${days} day${days === 1 ? "" : "s"}` : ""}</span>
          </div>
          <div class="file-actions">
            <button class="secondary-button" type="button" data-project-action="open">Open</button>
            <button class="secondary-button" type="button" data-project-action="download">Download</button>
            <button class="secondary-button danger-button" type="button" data-project-action="delete">Delete</button>
          </div>
        </article>
      `;
    }).join("");
  } catch (error) {
    console.error(error);
    els.projectsList.innerHTML = `<div class="files-empty">Projects could not be loaded on this device.</div>`;
  }
}

function formatTotal(value) {
  if (!value) return "0";
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

function render() {
  state.rows.forEach(calculateRow);
  els.totalOt.textContent = formatTotal(totalOt());
  els.totalDays.textContent = String(selectedDateValues().length);
  els.root.dataset.theme = state.darkMode ? "dark" : "light";
  els.root.classList.toggle("is-files-view", state.activeView === "files");
  els.root.classList.toggle("is-finalise-view", state.activeView === "preview");
  els.root.classList.toggle("is-summary-hidden", state.mobileSummaryHidden);
  els.workspace.classList.toggle("is-collapsed", state.setupCollapsed);
  els.root.querySelector(".setup-panel")?.classList.toggle("is-mobile-collapsed", state.mobileDetailsCollapsed);
  els.toggleSetup.textContent = state.setupCollapsed ? "›" : "‹";
  els.toggleSetup.setAttribute("aria-label", state.setupCollapsed ? "Open details panel" : "Collapse details panel");
  els.toggleSetup.setAttribute("aria-expanded", String(!state.setupCollapsed));
  els.toggleMobileDetails.textContent = state.mobileDetailsCollapsed ? "⌄" : "⌃";
  els.toggleMobileDetails.setAttribute("aria-label", state.mobileDetailsCollapsed ? "Expand details" : "Collapse details");
  els.toggleMobileDetails.setAttribute("aria-expanded", String(!state.mobileDetailsCollapsed));
  els.roleButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.role === state.role));
  els.themeToggle.textContent = state.darkMode ? "☀" : "☾";
  els.themeToggle.setAttribute("aria-label", state.darkMode ? "Switch to light mode" : "Switch to dark mode");
  els.themeToggle.setAttribute("title", "Switch theme");
  els.themeToggle.setAttribute("aria-pressed", String(state.darkMode));
  els.openPreview.textContent = state.activeView === "preview" ? "← Back to Edit" : "Preview PDF →";
  els.openPreview.setAttribute("aria-label", state.activeView === "preview" ? "Back to edit" : "Preview PDF");
  els.openPreview.classList.toggle("is-back-action", state.activeView === "preview");
  const allMobileRowsCollapsed = state.rows.length > 0 && state.rows.every((row) => state.collapsedMobileRows.has(row.id));
  els.toggleAllMobileRows.textContent = allMobileRowsCollapsed ? "⌄" : "⌃";
  els.toggleAllMobileRows.setAttribute("aria-label", allMobileRowsCollapsed ? "Expand all daily cards" : "Collapse all daily cards");
  els.toggleAllMobileRows.setAttribute("aria-expanded", String(!allMobileRowsCollapsed));
  els.toggleAllMobileRows.disabled = state.rows.length === 0;
  els.pdfStyle.value = state.pdfStyle;
  els.editorView.classList.toggle("is-active", state.activeView === "editor");
  els.previewView.classList.toggle("is-active", state.activeView === "preview");
  els.filesView.classList.toggle("is-active", state.activeView === "files");
  els.filesTabs.forEach((button) => {
    const isActive = button.dataset.filesTab === state.filesTab;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  els.filesSections.forEach((section) => {
    const isActive = section.id === `${state.filesTab}Section`;
    section.classList.toggle("is-active", isActive);
  });
  els.mobileStickyActions.classList.toggle("is-preview", state.activeView === "preview");
  els.mobileStickyActions.classList.toggle("is-hidden", state.activeView === "files");
  els.mobileNavButtons.forEach((button) => {
    const isActive = button.dataset.mobileNav === "files" ? state.activeView === "files" : state.activeView !== "files";
    button.classList.toggle("is-active", isActive);
    if (isActive) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });
  renderRows();
  renderPreview();
  renderMiniCalendar();
  if (state.activeView === "files" && state.filesTab === "pdfs") renderFilesList();
  if (state.activeView === "files" && state.filesTab === "projects") renderProjectsList();
  drawSignaturePad(els.crewSignaturePad, state.signatures.crew);
  drawSignaturePad(els.producerSignaturePad, state.signatures.producer);
  scheduleDraftSave();
}

function setMobileSummaryHidden(hidden) {
  if (state.mobileSummaryHidden === hidden) return;
  state.mobileSummaryHidden = hidden;
  els.root.classList.toggle("is-summary-hidden", hidden);
}

function initMobileSummaryAutoHide() {
  const mobileQuery = window.matchMedia("(max-width: 620px)");
  let lastY = window.scrollY;
  let direction = 0;
  let accumulated = 0;
  let ticking = false;
  const noiseThreshold = 10;
  const hideThreshold = 42;
  const showThreshold = 68;

  const processScroll = () => {
    ticking = false;
    if (!mobileQuery.matches) {
      setMobileSummaryHidden(false);
      lastY = window.scrollY;
      direction = 0;
      accumulated = 0;
      return;
    }

    const currentY = Math.max(0, window.scrollY);
    const delta = currentY - lastY;
    lastY = currentY;

    if (currentY < 24) {
      direction = 0;
      accumulated = 0;
      setMobileSummaryHidden(false);
      return;
    }

    if (Math.abs(delta) < noiseThreshold) return;

    const nextDirection = delta > 0 ? 1 : -1;
    if (nextDirection !== direction) {
      direction = nextDirection;
      accumulated = 0;
    }

    accumulated += Math.abs(delta);

    if (direction > 0 && !state.mobileSummaryHidden && accumulated >= hideThreshold) {
      setMobileSummaryHidden(true);
      accumulated = 0;
    }

    if (direction < 0 && state.mobileSummaryHidden && accumulated >= showThreshold) {
      setMobileSummaryHidden(false);
      accumulated = 0;
    }
  };

  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(processScroll);
  }, { passive: true });
}

function refreshCalculatedFields(rowEl, row) {
  calculateRow(row);
  if (row.locked && !rowHasEditableData(row)) row.locked = false;
  const filming = rowEl.querySelector('[data-field="filmingOt"]');
  const transfer = rowEl.querySelector('[data-field="transferOt"]');
  if (filming && document.activeElement !== filming) filming.value = row.filmingOt;
  if (transfer && document.activeElement !== transfer) transfer.value = row.transferOt;
  const lockButton = rowEl.querySelector(".mobile-lock-row");
  if (lockButton) {
    const hasEditableData = rowHasEditableData(row);
    const locked = Boolean(row.locked);
    lockButton.disabled = !locked && !hasEditableData;
    lockButton.classList.toggle("is-active", locked);
    lockButton.setAttribute("aria-pressed", String(locked));
    lockButton.setAttribute("aria-label", `${locked ? "Unlock" : "Lock"} day`);
    const icon = lockButton.querySelector("span");
    if (icon) icon.textContent = locked ? "🔒" : "🔓";
    rowEl.classList.toggle("is-locked", locked);
  }
  const mobileTotals = rowEl.querySelectorAll(".mobile-entry-totals strong");
  if (mobileTotals.length >= 3) {
    mobileTotals[0].textContent = emptyDash(row.filmingOt);
    mobileTotals[1].textContent = emptyDash(row.transferOt);
    mobileTotals[2].textContent = `${formatTotal(rowTotalOt(row))} hrs`;
  }
  els.totalOt.textContent = formatTotal(totalOt());
  renderPreview();
  scheduleDraftSave();
}

function titleCase(value) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updateRow(row, field, value) {
  if (TIME_FIELDS.includes(field)) {
    row[field] = normaliseTime(value);
  } else if (field === "otFrom") {
    row.otFrom = value;
  } else if (field === "day") {
    row.day = WEEKDAYS.includes(value) ? value : fullDay(row.date);
  } else {
    row[field] = value;
  }

  if (field === "filmingFrom") suggestFilmingTo(row);
  if (field === "filmingTo") row.filmingToAuto = !row.filmingTo;
}

function handleRowInput(event) {
  const input = event.target.closest("[data-field]");
  if (!input) return;
  const rowEl = input.closest("[data-id]");
  const rowIndex = state.rows.findIndex((item) => item.id === rowEl.dataset.id);
  const row = state.rows[rowIndex];
  if (!row) return;
  const field = input.dataset.field;
  const rawValue = input.value;

  if (field === "date") {
    row.date = rawValue;
    setSelectedDates(state.rows.map((item) => item.date));
    render();
    return;
  }

  row[field] = rawValue;

  const hasFullTime = /^\D*(\d\D*){4}$/.test(rawValue);
  if (TIME_FIELDS.includes(field) && hasFullTime) {
    row[field] = normaliseTime(rawValue);
    input.value = row[field];
    if (field === "filmingTo") row.filmingToAuto = false;
    if (field === "filmingFrom") suggestFilmingTo(row);
    const filmingTo = rowEl.querySelector('[data-field="filmingTo"]');
    const otTo = rowEl.querySelector('[data-field="otTo"]');
    if (filmingTo && document.activeElement !== filmingTo) filmingTo.value = row.filmingTo;
    if (otTo && document.activeElement !== otTo) otTo.value = row.otTo;
  }

  refreshCalculatedFields(rowEl, row);
}

function handleRowChange(event) {
  const input = event.target.closest("[data-field]");
  if (!input) return;
  const rowEl = input.closest("[data-id]");
  const rowIndex = state.rows.findIndex((item) => item.id === rowEl.dataset.id);
  const row = state.rows[rowIndex];
  if (!row) return;

  if (input.dataset.field === "date") {
    row.date = input.value;
    setSelectedDates(state.rows.map((item) => item.date));
    render();
    return;
  }

  if (input.dataset.field === "day") {
    row.date = dateForWeekday(row.date, input.value);
    row.day = input.value;
    setSelectedDates(state.rows.map((item) => item.date));
    render();
    return;
  }

  updateRow(row, input.dataset.field, input.value);
  render();
}

async function handleRowClick(event) {
  const lockButton = event.target.closest(".mobile-lock-row");
  if (lockButton) {
    const rowEl = lockButton.closest("[data-id]");
    const row = state.rows.find((item) => item.id === rowEl?.dataset.id);
    if (!row) return;
    if (!row.locked && !rowHasEditableData(row)) return;
    row.locked = !row.locked;
    render();
    return;
  }

  const toggle = event.target.closest(".mobile-card-toggle");
  if (toggle) {
    const rowEl = toggle.closest("[data-id]");
    if (!rowEl) return;
    if (state.collapsedMobileRows.has(rowEl.dataset.id)) {
      state.collapsedMobileRows.delete(rowEl.dataset.id);
    } else {
      state.collapsedMobileRows.add(rowEl.dataset.id);
    }
    renderRows();
    return;
  }

  const button = event.target.closest(".delete-row");
  if (!button) return;
  const rowEl = button.closest("[data-id]");
  const row = state.rows.find((item) => item.id === rowEl?.dataset.id);
  const dateLabel = row?.date ? ` (${displayDate(row.date)})` : "";
  if (!await confirmDeleteDay(`Delete this day${dateLabel}?`)) return;
  const dates = state.rows.filter((item) => item.id !== rowEl.dataset.id).map((item) => item.date);
  setSelectedDates(dates);
  state.collapsedMobileRows.delete(rowEl.dataset.id);
  render();
}

[els.rows, els.mobileRows].forEach((container) => {
  container.addEventListener("input", handleRowInput);
  container.addEventListener("change", handleRowChange);
  container.addEventListener("click", handleRowClick);
});

els.miniCalendar.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-calendar-nav]");
  if (nav) {
    const current = parseInputDate(`${state.calendarMonth}-01`) || parseInputDate(state.rows[0]?.date) || new Date();
    current.setMonth(current.getMonth() + Number(nav.dataset.calendarNav));
    state.calendarMonth = `${current.getFullYear()}-${pad(current.getMonth() + 1)}`;
    renderMiniCalendar();
    return;
  }

  const button = event.target.closest("[data-calendar-date]");
  if (!button) return;
  const dateValue = button.dataset.calendarDate;
  if (!dateValue) return;
  state.calendarMonth = dateValue.slice(0, 7);
  const selected = new Set(selectedDateValues());
  if (selected.has(dateValue)) {
    selected.delete(dateValue);
  } else {
    selected.add(dateValue);
  }
  setSelectedDates([...selected]);
  render();
});

els.roleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.role = button.dataset.role;
    els.roleButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    renderPreview();
    scheduleDraftSave();
  });
});

[els.programTitle, els.wbsNumber, els.crewName].forEach((input) => {
  const debugName = {
    programTitle: "Program Title",
    wbsNumber: "WBS Number",
    crewName: "Crew Name"
  }[input.id] || input.id;
  input.addEventListener("input", () => {
    syncSetupStateFromInputs();
    debugObserveFields(`${debugName} input`);
    renderPreview();
    scheduleDraftSave();
  });
});

els.pdfStyle.addEventListener("change", () => {
  state.pdfStyle = els.pdfStyle.value;
  scheduleDraftSave();
});

els.themeToggle.addEventListener("click", () => {
  state.darkMode = !state.darkMode;
  localStorage.setItem(THEME_STORAGE_KEY, state.darkMode ? "dark" : "light");
  render();
});

els.openPreview.addEventListener("click", () => {
  state.activeView = state.activeView === "preview" ? "editor" : "preview";
  debugLog(state.activeView === "preview" ? "when entering Finalise" : "when returning Back to Edit");
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
els.stickyPreview.addEventListener("click", () => {
  state.activeView = "preview";
  debugLog("when entering Finalise");
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
els.stickyBack.addEventListener("click", () => {
  state.activeView = "editor";
  debugLog("when returning Back to Edit");
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
els.mobileNavButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.activeView = button.dataset.mobileNav === "files" ? "files" : "editor";
    debugLog(`when switching ${debugCurrentView()}`);
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
});

els.filesTabs.forEach((button) => {
  button.addEventListener("click", () => {
    state.filesTab = button.dataset.filesTab === "pdfs" ? "pdfs" : "projects";
    render();
  });
});

els.mobileSaveProject.addEventListener("click", () => saveCurrentProjectToFiles());
els.mobileLoadProject.addEventListener("click", () => els.projectFile.click());
els.mobileClearDraft.addEventListener("click", () => {
  if (!clearDraft()) return;
  state.activeView = "editor";
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

els.mobileAddDay.addEventListener("click", () => {
  const dates = selectedDateValues();
  if (!dates.length) return;
  const lastDate = parseInputDate(dates[dates.length - 1]);
  if (!lastDate) return;
  setSelectedDates([...dates, toInputDate(addDays(lastDate, 1))], { collapseNewRows: "all" });
  render();
});

els.projectsList.addEventListener("click", async (event) => {
  const actionButton = event.target.closest("[data-project-action]");
  if (!actionButton) return;
  const card = actionButton.closest("[data-project-name]");
  const projectName = card?.dataset.projectName;
  if (!projectName) return;

  try {
    if (actionButton.dataset.projectAction === "delete") {
      if (!window.confirm("Delete this saved project from this device?")) return;
      await deleteProjectFile(projectName);
      showProjectMessage("Project deleted.");
      return;
    }

    const record = await getProjectRecord(projectName);
    if (!record?.project) throw new Error("Project could not be found.");

    if (actionButton.dataset.projectAction === "open") {
      debugLog("project load from Files", { projectName });
      restoreProject(record.project);
      state.activeView = "editor";
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
      showProjectMessage("Project opened.");
      return;
    }

    const filename = record.filename || `${record.name || "OT Project"}.json`;
    debugLog("before project JSON serialization", { source: "Files project download", filename });
    const projectJson = JSON.stringify(record.project, null, 2);
    debugLog("after project JSON serialization", { source: "Files project download", filename });
    const blob = new Blob([projectJson], { type: "application/json" });
    triggerBlobDownload(blob, filename);
  } catch (error) {
    console.error(error);
    debugLog("Project action error", { message: error.message });
    showProjectMessage("Project action failed.", true);
  }
});

els.filesList.addEventListener("click", async (event) => {
  const actionButton = event.target.closest("[data-file-action]");
  if (!actionButton) return;
  const card = actionButton.closest("[data-file-id]");
  const fileId = card?.dataset.fileId;
  if (!fileId) return;

  try {
    if (actionButton.dataset.fileAction === "delete") {
      if (!window.confirm("Delete this saved PDF from this device?")) return;
      await deletePdfFile(fileId);
      showProjectMessage("PDF deleted.");
      return;
    }

    const viewer = actionButton.dataset.fileAction === "open" ? window.open("about:blank", "_blank") : null;
    const file = await getPdfFile(fileId);
    if (!file?.blob) throw new Error("File could not be found.");
    if (actionButton.dataset.fileAction === "open") {
      const url = URL.createObjectURL(file.blob);
      if (viewer) {
        viewer.location = url;
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        openPdfBlob(file.blob);
      }
    } else {
      triggerBlobDownload(file.blob, file.filename || pdfFallbackName());
    }
  } catch (error) {
    console.error(error);
    debugLog("File action error", { message: error.message });
    showProjectMessage("File action failed.", true);
  }
});

els.firstDate.addEventListener("input", generateRowsFromDateInputs);
els.endDate.addEventListener("input", generateRowsFromDateInputs);
els.toggleAllMobileRows.addEventListener("click", () => {
  const shouldCollapse = state.rows.some((row) => !state.collapsedMobileRows.has(row.id));
  state.collapsedMobileRows = shouldCollapse ? new Set(state.rows.map((row) => row.id)) : new Set();
  render();
});
els.toggleSetup.addEventListener("click", () => {
  state.setupCollapsed = !state.setupCollapsed;
  render();
});
els.toggleMobileDetails.addEventListener("click", () => {
  state.mobileDetailsCollapsed = !state.mobileDetailsCollapsed;
  render();
});
els.defaultMeal.addEventListener("change", () => {
  state.rows.forEach((row) => {
    if (!row.mealBreak || row.mealBreak === "0" || row.mealBreak === "0.5" || row.mealBreak === "1") row.mealBreak = els.defaultMeal.value || "";
  });
  render();
});

els.downloadButtons.forEach((button) => button.addEventListener("click", () => downloadPdf(button)));
els.saveProject.addEventListener("click", saveProject);
els.loadProject.addEventListener("click", () => els.projectFile.click());
els.clearDraft.addEventListener("click", () => clearDraft());
els.projectFile.addEventListener("change", () => loadProjectFile(els.projectFile.files?.[0]));
els.resumeDraft.addEventListener("click", () => {
  const draft = readDraft();
  hideDraftPrompt();
  if (draft) {
    state.suppressDraftSave = true;
    debugLog("draft restore from prompt");
    restoreProject(draft);
    state.suppressDraftSave = false;
    saveDraftNow();
    showProjectMessage("Draft resumed.");
  } else {
    initializeFreshProject();
  }
});
els.startNewDraft.addEventListener("click", () => {
  hideDraftPrompt();
  localStorage.removeItem(DRAFT_STORAGE_KEY);
  localStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
  initializeFreshProject();
  showProjectMessage("New draft started.");
});
setupSignaturePad(els.crewSignaturePad, state.signatures.crew, els.clearCrewSignature);
setupSignaturePad(els.producerSignaturePad, state.signatures.producer, els.clearProducerSignature);

function pdfEscape(value) {
  return String(value ?? "").replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function pdfSafeText(value) {
  return String(value ?? "").normalize("NFKD").replace(/[^\x20-\x7e]/g, "").trim();
}

function pdfTextWidth(value, size) {
  return String(value ?? "").length * size * 0.48;
}

function fitFontSize(value, width, preferred, minimum = 5.8) {
  const textWidth = pdfTextWidth(value, preferred);
  if (!textWidth || textWidth <= width) return preferred;
  return Math.max(minimum, preferred * (width / textWidth));
}

function overlayText(commands, value, x, y, width, options = {}) {
  const text = pdfSafeText(value);
  if (!text) return;
  const preferredSize = options.size || 9;
  const size = fitFontSize(text, width - 4, preferredSize, options.minimumSize || 5.8);
  const shown = text.length > (options.maxChars || 80) ? text.slice(0, options.maxChars || 80) : text;
  const tx = options.align === "left" ? x + 3 : x + Math.max(2, (width - pdfTextWidth(shown, size)) / 2);
  commands.push(
    "BT",
    "0 Tr",
    "0.02 0.22 0.78 rg",
    `/OTF1 ${size.toFixed(2)} Tf`,
    `${tx.toFixed(2)} ${y.toFixed(2)} Td`,
    `(${pdfEscape(shown)}) Tj`,
    "ET"
  );
}

function overlayWhite(commands, x, y, width, height) {
  commands.push("q", "1 1 1 rg", `${x} ${y} ${width} ${height} re`, "f", "Q");
}

function pdfText(commands, value, x, y, size = 8, options = {}) {
  const text = pdfSafeText(value);
  if (!text) return;
  commands.push(
    "BT",
    options.blue ? "0.02 0.22 0.78 rg" : "0 0 0 rg",
    `${options.bold ? "/F2" : "/F1"} ${size.toFixed(2)} Tf`,
    `${x.toFixed(2)} ${y.toFixed(2)} Td`,
    `(${pdfEscape(text)}) Tj`,
    "ET"
  );
}

function pdfCenter(commands, value, x, y, width, size = 8, options = {}) {
  const text = pdfSafeText(value);
  if (!text) return;
  const fitSize = fitFontSize(text, width - 4, size, options.minimumSize || 5.5);
  const tx = x + Math.max(2, (width - pdfTextWidth(text, fitSize)) / 2);
  pdfText(commands, text, tx, y, fitSize, options);
}

function pdfTextBox(commands, lines, x, y, width, height, size = 8, options = {}) {
  const values = (Array.isArray(lines) ? lines : [lines])
    .map((line) => pdfSafeText(line))
    .filter(Boolean);
  if (!values.length) return;
  const lineHeight = size + 2;
  const totalHeight = lineHeight * values.length;
  const firstY = y + ((height + totalHeight) / 2) - lineHeight + 0.5;
  values.forEach((line, index) => {
    const fitSize = fitFontSize(line, width - 4, size, options.minimumSize || 5);
    const tx = x + Math.max(2, (width - pdfTextWidth(line, fitSize)) / 2);
    pdfText(commands, line, tx, firstY - (index * lineHeight), fitSize, options);
  });
}

function pdfRect(commands, x, y, width, height, options = {}) {
  if (options.fill) {
    commands.push(options.fill, `${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re`, "f");
  }
  commands.push("0 0 0 RG", `${(options.lineWidth || 0.8).toFixed(2)} w`, `${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re`, "S");
}

function pdfLine(commands, x1, y1, x2, y2, width = 0.8) {
  commands.push("0 0 0 RG", `${width.toFixed(2)} w`, `${x1.toFixed(2)} ${y1.toFixed(2)} m`, `${x2.toFixed(2)} ${y2.toFixed(2)} l`, "S");
}

function makeCleanPdfStream() {
  const commands = ["q"];
  const range = dateRangeText();
  const col = [17, 36, 94, 152, 202.5, 253, 303.5, 353.5, 403, 464, 525.5, 576, 626.5, 677.5, 744, 818.5];
  const headerTop = 493.5;
  const headerOneBottom = 462.5;
  const rowTop = 437.5;
  const rowHeight = 22.75;
  const totalBottom = 70;
  const totalHeight = 25;
  const grey = "0.86 0.86 0.86 rg";

  pdfText(commands, `NEWS/CA PRODUCTION SERVICES (Camera Unit) - ${state.role}`, 18, 552, 12, { bold: true });
  pdfText(commands, "Working Hours during Overseas Assignment", 414, 552, 12, { bold: true });
  pdfText(commands, "PROGRAM TITLE:", 18, 517, 10, { bold: true });
  pdfLine(commands, 153, 510, 404, 510, 0.7);
  pdfCenter(commands, els.programTitle.value, 153, 528, 251, 10, { blue: true, minimumSize: 6.5 });
  pdfText(commands, "WBS NUMBER:", 468, 517, 10, { bold: true });
  pdfLine(commands, 577, 510, 819, 510, 0.7);
  pdfCenter(commands, els.wbsNumber.value, 577, 528, 242, 10, { blue: true, minimumSize: 6.5 });
  pdfText(commands, "DATE:", 18, 496, 10, { bold: true });
  pdfText(commands, "FROM:", 124, 496, 10, { bold: true });
  pdfLine(commands, 153, 489, 404, 489, 0.7);
  pdfCenter(commands, range.from, 153, 508, 251, 10, { blue: true });
  pdfText(commands, "TO:", 510, 496, 10, { bold: true });
  pdfLine(commands, 526, 489, 744, 489, 0.7);
  pdfCenter(commands, range.to, 526, 508, 218, 10, { blue: true });

  pdfRect(commands, col[0], headerOneBottom, col[col.length - 1] - col[0], headerTop - headerOneBottom, { fill: grey, lineWidth: 1.1 });
  pdfRect(commands, col[0], rowTop, col[col.length - 1] - col[0], headerOneBottom - rowTop, { fill: grey, lineWidth: 1.1 });
  col.forEach((x) => pdfLine(commands, x, totalBottom, x, headerTop, 1));
  [headerTop, rowTop].forEach((y) => pdfLine(commands, col[0], y, col[col.length - 1], y, 1));
  pdfLine(commands, col[1], headerOneBottom, col[7], headerOneBottom, 1);
  pdfLine(commands, col[8], headerOneBottom, col[12], headerOneBottom, 1);

  pdfTextBox(commands, "No.", col[0], rowTop, col[1] - col[0], headerTop - rowTop, 7.2, { bold: true, minimumSize: 4.8 });
  pdfTextBox(commands, ["DATE and TIME", "of FILMING"], col[1], headerOneBottom, col[5] - col[1], headerTop - headerOneBottom, 6.7, { bold: true, minimumSize: 5.2 });
  pdfTextBox(commands, ["OT from", "FILMING"], col[5], headerOneBottom, col[7] - col[5], headerTop - headerOneBottom, 6.7, { bold: true, minimumSize: 5.2 });
  pdfTextBox(commands, ["MEAL", "BREAK"], col[7], rowTop, col[8] - col[7], headerTop - rowTop, 7, { bold: true, minimumSize: 5 });
  pdfTextBox(commands, ["TRANSFER to", "HDD or FTP"], col[8], headerOneBottom, col[10] - col[8], headerTop - headerOneBottom, 6.6, { bold: true, minimumSize: 5 });
  pdfTextBox(commands, "OT HOURS", col[10], headerOneBottom, col[12] - col[10], headerTop - headerOneBottom, 7, { bold: true, minimumSize: 5.4 });
  pdfTextBox(commands, ["OFF /", "REST"], col[12], rowTop, col[13] - col[12], headerTop - rowTop, 7, { bold: true, minimumSize: 5 });
  pdfTextBox(commands, "REMARKS", col[13], rowTop, col[14] - col[13], headerTop - rowTop, 7, { bold: true, minimumSize: 5.2 });
  pdfTextBox(commands, ["PRODUCER'S /", "REPORTER'S", "SIGNATURE"], col[14], rowTop, col[15] - col[14], headerTop - rowTop, 5.6, { bold: true, minimumSize: 4.4 });

  ["Day", "Date", "From", "To", "From", "To", "", "From", "To", "Filming", "Transfer"].forEach((label, index) => {
    if (label) pdfTextBox(commands, label, col[index + 1], rowTop, col[index + 2] - col[index + 1], headerOneBottom - rowTop, 6.8, { bold: true, minimumSize: 4.8 });
  });

  const rows = Array.from({ length: MAX_ROWS_PER_PAGE }, (_, index) => state.rows[index] || null);
  rows.forEach((row, index) => {
    const top = rowTop - index * rowHeight;
    const bottom = top - rowHeight;
    pdfLine(commands, col[0], bottom, col[col.length - 1], bottom, 1);
    pdfCenter(commands, String(index + 1), col[0], bottom + 7.8, col[1] - col[0], 8.2, { bold: true });
    if (!row) return;
    const values = [
      rowDay(row),
      displayDate(row.date).slice(0, 5),
      emptyDash(row.filmingFrom),
      emptyDash(row.filmingTo),
      emptyDash(row.otFrom),
      emptyDash(row.otTo),
      parseHours(row.mealBreak) ? row.mealBreak : "-",
      emptyDash(row.transferFrom),
      emptyDash(row.transferTo),
      emptyDash(row.filmingOt),
      emptyDash(row.transferOt),
      emptyDash(row.offRest),
      row.remarks
    ];
    values.forEach((value, valueIndex) => {
      const colIndex = valueIndex + 1;
      pdfCenter(commands, value, col[colIndex], bottom + 7.8, col[colIndex + 1] - col[colIndex], valueIndex === 12 ? 6.8 : 8.1, { blue: true, minimumSize: 5.3 });
    });
    if (isPopulatedOtRow(row)) drawPdfSignature(commands, state.signatures.producer, 748, bottom + 3.8, 66, 14, 0.95);
  });

  pdfRect(commands, col[9], totalBottom, col[10] - col[9], totalHeight, { lineWidth: 1 });
  pdfTextBox(commands, "TOTAL OT", col[9], totalBottom, col[10] - col[9], totalHeight, 8.5, { bold: true, minimumSize: 6 });
  pdfRect(commands, col[10], totalBottom, col[11] - col[10], totalHeight, { lineWidth: 1 });
  pdfRect(commands, col[11], totalBottom, col[12] - col[11], totalHeight, { lineWidth: 1 });
  pdfCenter(commands, formatTotal(totalOt()), col[10], totalBottom + 9.5, col[11] - col[10], 10, { blue: true, bold: true });

  pdfText(commands, `${titleCase(state.role)}:`, 18, 42, 9, { bold: true });
  pdfLine(commands, 94, 37, 304, 37, 1);
  pdfCenter(commands, els.crewName.value, 94, 47, 210, 9, { blue: true, minimumSize: 6.5 });
  pdfText(commands, "Certified by:", 18, 20, 9, { bold: true });
  pdfLine(commands, 94, 15, 304, 15, 1);
  pdfText(commands, "Signature:", 365, 42, 9, { bold: true });
  pdfLine(commands, 405, 37, 525, 37, 1);
  drawPdfSignature(commands, state.signatures.crew, 405, 44, 120, 16, 1.05);
  pdfText(commands, "Signature:", 365, 20, 9, { bold: true });
  pdfLine(commands, 405, 15, 525, 15, 1);

  commands.push("Q");
  return commands.join("\n");
}

function makeOverlayStream() {
  const commands = ["q"];
  const range = dateRangeText();
  const col = [17, 36, 94, 152, 202.5, 253, 303.5, 353.5, 403, 464, 525.5, 576, 626.5, 677.5, 744, 818.5];
  const rowTop = 462.5;
  const rowHeight = 24.55;

  if (state.role !== "SOUNDMAN") {
    overlayWhite(commands, 284, 544, 118, 16);
    commands.push("BT", "0 Tr", "0 0 0 rg", "/OTF1 12 Tf", "284 551 Td", `(${pdfEscape(pdfSafeText(state.role))}) Tj`, "ET");
    overlayWhite(commands, 17, 37, 55, 12);
    commands.push("BT", "0 Tr", "0 0 0 rg", "/OTF1 9 Tf", "18 41 Td", `(${pdfEscape(pdfSafeText(titleCase(state.role) + ":"))}) Tj`, "ET");
  }

  overlayText(commands, els.programTitle.value, 153, 528, 251, { size: 10, minimumSize: 6.5, maxChars: 60 });
  overlayText(commands, els.wbsNumber.value, 577, 528, 242, { size: 10, minimumSize: 6.5, maxChars: 45 });
  overlayText(commands, range.from, 153, 508, 251, { size: 10 });
  overlayText(commands, range.to, 526, 508, 218, { size: 10 });

  const rows = Array.from({ length: MAX_ROWS_PER_PAGE }, (_, index) => state.rows[index] || null);
  rows.forEach((row, index) => {
    if (!row) return;
    const y = rowTop - (index * rowHeight) - 16;
    const cells = [
      null,
      rowDay(row),
      displayDate(row.date).slice(0, 5),
      emptyDash(row.filmingFrom),
      emptyDash(row.filmingTo),
      emptyDash(row.otFrom),
      emptyDash(row.otTo),
      parseHours(row.mealBreak) ? row.mealBreak : "-",
      emptyDash(row.transferFrom),
      emptyDash(row.transferTo),
      emptyDash(row.filmingOt),
      emptyDash(row.transferOt),
      emptyDash(row.offRest),
      row.remarks,
      ""
    ];

    cells.forEach((value, colIndex) => {
      if (value === null || value === "") return;
      overlayText(commands, value, col[colIndex], y, col[colIndex + 1] - col[colIndex], {
        align: colIndex === 13 ? "left" : "center",
        size: colIndex === 13 ? 7.2 : 8.6,
        minimumSize: colIndex === 13 ? 5.4 : 6,
        maxChars: colIndex === 1 ? 10 : colIndex === 13 ? 22 : 12
      });
    });

    if (isPopulatedOtRow(row)) {
      const signatureY = rowTop - ((index + 1) * rowHeight) + 3.6;
      drawPdfSignature(commands, state.signatures.producer, 748, signatureY, 66, 16, 0.95);
    }
  });

  overlayText(commands, formatTotal(totalOt()), 525.5, 75, 50.5, { size: 10, minimumSize: 7 });
  overlayText(commands, els.crewName.value, 94, 46, 209, { size: 9, minimumSize: 6.5, maxChars: 40 });
  drawPdfSignature(commands, state.signatures.crew, 405, 44, 120, 16, 1.05);

  commands.push("Q");
  return commands.join("\n");
}

function binaryString(bytes) {
  let output = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    output += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return output;
}

function concatBytes(first, second) {
  const combined = new Uint8Array(first.length + second.length);
  combined.set(first);
  combined.set(second, first.length);
  return combined;
}

function buildPdf(templateBytes) {
  const templateText = binaryString(templateBytes);
  const startxrefMatch = templateText.match(/startxref\s+(\d+)\s+%%EOF\s*$/);
  const sizeMatches = [...templateText.matchAll(/\/Size\s+(\d+)/g)];
  const previousXref = startxrefMatch ? Number(startxrefMatch[1]) : 0;
  const nextObject = sizeMatches.length ? Number(sizeMatches[sizeMatches.length - 1][1]) : 51;
  const streamObject = nextObject;
  const fontObject = nextObject + 1;
  const newSize = nextObject + 2;
  const stream = makeOverlayStream();
  const objects = [
    {
      id: 6,
      body: `<< /Type /Page /MediaBox [ 0 0 843 598 ] /Resources << /Font << /F1 10 0 R /OTF1 ${fontObject} 0 R >> /ProcSet [ /PDF /Text /ImageB /ImageC /ImageI ] /ExtGState << /E1 9 0 R >> /XObject << /X1 4 0 R >> >> /Parent 2 0 R /Rotate 0 /Contents [ 7 0 R ${streamObject} 0 R ] >>`
    },
    {
      id: streamObject,
      body: `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`
    },
    {
      id: fontObject,
      body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    }
  ];

  let update = "\n";
  const offsets = [];
  objects.forEach((object) => {
    offsets.push({ id: object.id, offset: templateBytes.length + update.length });
    update += `${object.id} 0 obj\n${object.body}\nendobj\n`;
  });

  const xrefOffset = templateBytes.length + update.length;
  update += "xref\n";
  offsets.forEach(({ id, offset }) => {
    update += `${id} 1\n${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  update += `trailer\n<< /Size ${newSize} /Root 1 0 R /Prev ${previousXref} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return concatBytes(templateBytes, new TextEncoder().encode(update));
}

function buildCleanPdf() {
  const stream = makeCleanPdfStream();
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [5 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 843 598] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents 6 0 R >>",
    `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

async function downloadPdf(button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Preparing...";
  try {
    debugLog("immediately before PDF generation");
    saveDraftNow();
    let pdf;
    if (state.pdfStyle === "clean") {
      pdf = buildCleanPdf();
    } else {
      const response = await fetch(TEMPLATE_PDF_URL, { cache: "no-store" });
      if (!response.ok) throw new Error("The blank OT form template could not be loaded.");
      const templateBytes = new Uint8Array(await response.arrayBuffer());
      pdf = buildPdf(templateBytes);
    }
    debugLog("immediately after PDF generation");
    const blob = new Blob([pdf], { type: "application/pdf" });
    const filename = pdfFileName();
    try {
      await savePdfToFiles(blob, filename);
      showProjectMessage("PDF saved to Files.");
    } catch (error) {
      console.warn("PDF could not be saved to Files.", error);
      debugLog("PDF IndexedDB save error", { message: error.message });
      showProjectMessage("PDF downloaded, but could not be saved to Files.", true);
    }
    triggerBlobDownload(blob, filename);
  } catch (error) {
    debugLog("PDF download error", { message: error.message });
    window.alert(error.message || "PDF download failed.");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

if (DEBUG_MODE) {
  window.addEventListener("pageshow", () => debugLog("pageshow"));
  window.addEventListener("pagehide", () => debugLog("pagehide"));
  document.addEventListener("visibilitychange", () => debugLog("visibilitychange"));
  window.addEventListener("error", (event) => {
    debugLog("JavaScript error", { message: event.message || "Unknown error" });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    debugLog("Unhandled promise rejection", {
      message: reason?.message || String(reason || "Unknown rejection")
    });
  });
}

initDebugPanel();
initializeApp();
initMobileSummaryAutoHide();
disableServiceWorkerCaching();
