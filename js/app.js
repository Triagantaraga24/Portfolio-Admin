import { CONFIG } from "./config.js";
import { ApiError, createGithubService } from "./github-service.js";
import { COLLECTION_KEYS, ENTITY_CONFIG, blankRecord, createId, emptyPortfolio, validatePortfolioData } from "./schema.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const PAGE_SIZE = 8;
let github = null;
let portfolioData = null;
let latestCommit = null;
let currentSection = "overview";
let isWriting = false;
let editorContext = null;
let pendingConfirm = null;
let viewStates = new Map();
let renderAfterEditorClose = false;
let activeInputMap = null;

function node(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}
function clear(element) { element.replaceChildren(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function nowIso() { return new Date().toISOString(); }
function safeUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  if (/^https?:\/\//i.test(raw)) { try { const u = new URL(raw); return ["https:", "http:"].includes(u.protocol) ? raw : null; } catch { return null; } }
  if ((raw.startsWith("./") || raw.startsWith("/")) && !raw.startsWith("//") && !raw.includes("\\")) return raw;
  return null;
}
function resolvePublicUrl(value) {
  const normalized = safeUrl(value);
  if (!normalized) return null;
  if (normalized.startsWith("./") || normalized.startsWith("/")) {
    try { return new URL(normalized, CONFIG.publicUrl).href; } catch { return null; }
  }
  return normalized;
}
function setLink(anchor, url, label) {
  const normalized = resolvePublicUrl(url);
  if (!normalized) { anchor.hidden = true; return false; }
  anchor.hidden = false; anchor.href = normalized;
  if (label) anchor.textContent = label;
  if (/^https?:/i.test(normalized)) { anchor.target = "_blank"; anchor.rel = "noopener noreferrer"; }
  return true;
}
function showLogin() {
  $("#login-screen").hidden = false;
  $("#admin-shell").hidden = true;
  $("#pat-token").value = "";
  $("#login-message").textContent = "";
  $("#login-message").className = "form-message";
}
function showDashboard() {
  $("#login-screen").hidden = true;
  $("#admin-shell").hidden = false;
  $("#sidebar-repo").textContent = `${CONFIG.owner}/${CONFIG.contentRepo}`;
  $("#footer-branch").textContent = `${CONFIG.branch} · ${CONFIG.dataPath}`;
  renderCurrentPage();
}
function friendlyApiError(error) {
  const status = error?.status || 0;
  const base = error?.message || "Operasi belum berhasil.";
  if (status === 401) return "Token tidak valid, kedaluwarsa, atau tidak diterima GitHub (401). Buat token baru dengan akses yang benar.";
  if (status === 403) return "Akses ditolak (403). Periksa izin Contents: Read and write, persetujuan organisasi, masa berlaku token, dan rate limit.";
  if (status === 404) return "Repository atau file tidak ditemukan (404). Pastikan repository content publik/tersedia, owner, branch, dan path sudah benar.";
  if (status === 409) return "Konflik GitHub (409). File berubah sejak data terakhir dimuat; perubahan Anda tidak diterapkan.";
  if (status === 422) return `GitHub menolak perubahan (422). Periksa format JSON, aturan branch, SHA, atau validasi API. Detail: ${base}`;
  if (status === 429) return "Permintaan terlalu banyak (429). Tunggu sebelum mencoba lagi.";
  if (status === 0) return base;
  return `${base} (HTTP ${status})`;
}
function showToast(type, title, message = "") {
  const region = $("#toast-region");
  const toast = node("div", `toast ${type || "success"}`);
  const icon = node("span", "toast-icon", type === "error" ? "!" : type === "warning" ? "·" : "✓");
  const copy = node("div"); copy.append(node("strong", "", title)); if (message) copy.append(node("p", "", message));
  const close = node("button", "toast-close", "×"); close.type = "button"; close.setAttribute("aria-label", "Tutup notifikasi"); close.addEventListener("click", () => toast.remove());
  toast.append(icon, copy, close); region.append(toast);
  window.setTimeout(() => toast.remove(), 6500);
}
function setLoginMessage(message, type = "error") {
  const item = $("#login-message"); item.textContent = message; item.className = `form-message${type === "success" ? " success" : ""}`;
}
function requestConfirmation({ title, message, acceptLabel = "Ya, lanjutkan", danger = true, action }) {
  $("#confirm-title").textContent = title;
  $("#confirm-copy").textContent = message;
  $("#confirm-accept").textContent = acceptLabel;
  $("#confirm-accept").className = `button ${danger ? "button-danger" : "button-primary"}`;
  pendingConfirm = action;
  const dialog = $("#confirm-dialog");
  if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
}
async function refreshData({ silent = false } = {}) {
  if (!github) { showToast("error", "Sesi berakhir", "Masukkan kembali token GitHub untuk melanjutkan."); showLogin(); return false; }
  if (isWriting) { showToast("warning", "Sedang menyimpan", "Tunggu commit yang sedang berjalan sebelum memuat ulang data."); return false; }
  if (!silent) setConnectionBanner("info", "Memuat ulang data", "Membaca versi terbaru data/portfolio.json dari GitHub. Konten saat ini tetap ditampilkan sampai pembacaan selesai.");
  try {
    const response = await github.load();
    validatePortfolioData(response.data);
    portfolioData = response.data;
    try { latestCommit = await github.latestCommit(); } catch { latestCommit = null; }
    renderCurrentPage();
    setConnectionBanner("info", "Mode GitHub JSON", "Setiap simpanan akan membuat commit baru pada repository konten publik. Periksa perubahan sebelum menyimpan.");
    if (!silent) showToast("success", "Data dimuat ulang", "Versi terbaru data/portfolio.json berhasil dibaca dari GitHub.");
    return true;
  } catch (error) {
    if (!portfolioData) renderFatalLoadError(error);
    else { setConnectionBanner("danger", "Pembaruan data gagal", friendlyApiError(error)); showToast("error", "Gagal memuat data", friendlyApiError(error)); }
    return false;
  }
}
function setConnectionBanner(kind, title, message) {
  const banner = $("#connection-warning");
  banner.className = `alert ${kind === "danger" ? "alert-danger" : kind === "warning" ? "alert-warning" : "alert-info"}`;
  const icon = banner.querySelector(":scope > span"); if (icon) icon.textContent = kind === "danger" ? "!" : kind === "warning" ? "!" : "i";
  const strong = banner.querySelector("strong"), paragraph = banner.querySelector("p");
  if (strong) strong.textContent = title;
  if (paragraph) paragraph.textContent = message;
}
function renderFatalLoadError(error) {
  const target = $("#page-content"); clear(target);
  const alert = node("div", "alert alert-danger"); alert.append(node("span", "", "!"));
  const copy = node("div"); copy.append(node("strong", "", "Data tidak dapat dimuat"), node("p", "", friendlyApiError(error)));
  const button = node("button", "button button-primary", "Coba lagi"); button.type = "button"; button.addEventListener("click", () => refreshData());
  alert.append(copy, button); target.append(alert);
}
function currentView(section) {
  if (!viewStates.has(section)) viewStates.set(section, { query: "", filter: "all", page: 1, sortKey: null, sortDirection: "asc" });
  return viewStates.get(section);
}
function addHeading(target, title, description, actions = []) {
  const head = node("div", "page-heading");
  const copy = node("div"); copy.append(node("p", "eyebrow", "RAGA PORTFOLIO CMS"), node("h1", "", title));
  if (description) copy.append(node("p", "", description));
  const actionWrap = node("div", "heading-actions"); actions.forEach(action => actionWrap.append(action));
  head.append(copy, actionWrap); target.append(head); return head;
}
function button(label, className = "button button-primary", click, icon = "") {
  const element = node("button", className); element.type = "button";
  if (icon) element.append(node("span", "", icon));
  element.append(document.createTextNode(label));
  if (click) element.addEventListener("click", click);
  return element;
}
function linkButton(label, href, className = "button button-ghost") {
  const element = node("a", className, label); setLink(element, href); return element;
}
function renderCurrentPage() {
  if (!portfolioData) return;
  const target = $("#page-content"); clear(target);
  const config = ENTITY_CONFIG[currentSection];
  const title = currentSection === "overview" ? "Overview" : (config?.label || "Overview");
  $("#current-page-title").textContent = title;
  $$("[data-section]").forEach(item => item.classList.toggle("active", item.dataset.section === currentSection));
  if (currentSection === "overview") renderOverview(target);
  else if (config?.kind === "single") renderSingleObject(target, config);
  else if (config?.kind === "collection") renderCollection(target, config);
}
function renderOverview(target) {
  const headingActions = [
    button("Muat ulang", "button button-ghost", () => refreshData(), "↻"),
    button("Export JSON", "button button-ghost", exportJson, "↓")
  ];
  addHeading(target, "Overview", "Ringkasan konten, status sinkronisasi, dan akses cepat ke pengelolaan portofolio.", headingActions);
  const stats = node("div", "stats-grid");
  const definitions = [
    ["Profil", portfolioData.profile?.name ? 1 : 0, "◎", "Informasi utama"],
    ["Skills", portfolioData.skills.length, "✳", "Keahlian"],
    ["Pengalaman", portfolioData.experiences.length, "↗", "Riwayat pengalaman"],
    ["Pendidikan", portfolioData.education.length, "⌂", "Institusi / studi"],
    ["Organisasi", portfolioData.organizations.length, "◎", "Kegiatan organisasi"],
    ["Pencapaian", portfolioData.achievements.length, "✦", "Sertifikat / penghargaan"],
    ["Proyek", portfolioData.projects.length, "◈", "Karya portfolio"],
    ["Social links", portfolioData.socialLinks.length, "↗", "Tautan profil"]
  ];
  definitions.forEach(([label, amount, icon, foot]) => {
    const card = node("article", "stat-card"); const cardHead = node("div", "stat-card-head"); cardHead.append(node("span", "", label), node("span", "stat-icon", icon));
    card.append(cardHead, node("div", "stat-number", amount), node("div", "stat-foot", foot)); stats.append(card);
  }); target.append(stats);
  const grid = node("div", "dashboard-grid");
  const activityPanel = node("section", "panel");
  const activityHead = node("div", "panel-header"); const activityCopy = node("div"); activityCopy.append(node("h2", "", "Commit terbaru"), node("p", "", "Riwayat versi file portfolio JSON")); activityHead.append(activityCopy, node("span", "status-pill", "GitHub source"));
  const activityBody = node("div", "panel-body");
  if (latestCommit) {
    const details = node("div", "repo-detail-list");
    const date = latestCommit.date ? new Date(latestCommit.date).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "Tanggal tidak tersedia";
    [["Pesan commit", latestCommit.message], ["Dibuat", date], ["SHA", String(latestCommit.sha || "").slice(0, 10)]].forEach(([key, value]) => { const row = node("div", "repo-detail"); row.append(node("span", "", key), node("strong", "", value || "—")); details.append(row); });
    if (latestCommit.url) details.append(linkButton("Buka commit di GitHub ↗", latestCommit.url, "button button-ghost"));
    activityBody.append(details);
  } else activityBody.append(node("div", "activity-empty", "Detail commit belum tersedia. Gunakan Muat ulang untuk mencoba mengambilnya lagi."));
  activityPanel.append(activityHead, activityBody);
  const quickPanel = node("section", "panel"); const quickHead = node("div", "panel-header"); quickHead.append(node("h2", "", "Aksi cepat")); quickPanel.append(quickHead);
  const quickBody = node("div", "panel-body"); const links = node("div", "quick-links");
  [["Edit profil", "profile", "Kelola informasi utama"], ["Kelola proyek", "projects", "Tambah karya terbaru"], ["Kelola keahlian", "skills", "Perbarui kategori skill"], ["Pengaturan situs", "siteSettings", "Bahasa dan metadata"]].forEach(([label, section, _desc]) => {
    const a = node("button", "quick-link"); a.type = "button"; a.append(node("span", "", label), node("span", "", "→")); a.addEventListener("click", () => navigateTo(section)); links.append(a);
  }); quickBody.append(links); quickPanel.append(quickBody);
  grid.append(activityPanel, quickPanel); target.append(grid);
  const security = node("div", "alert alert-warning"); security.append(node("span", "", "!")); const securityCopy = node("div"); securityCopy.append(node("strong", "", "Semua konten di repository bersifat publik"), node("p", "", "Jangan simpan password, token, data sensitif, atau draft rahasia di file JSON. Tombol simpan membuat commit dan langsung memperbarui sumber konten publik.")); security.append(securityCopy); target.append(security);
}
function formatValue(value) {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ") || "—";
  if (typeof value === "boolean") return value ? "Ya" : "Tidak";
  return String(value);
}
function renderSingleObject(target, config) {
  const object = portfolioData[config.key] || {};
  const action = button("Edit " + config.singular, "button button-primary", () => openEditor(config.key, object), "✎");
  addHeading(target, config.label, config.description, [action]);
  const card = node("section", "single-object-card");
  const copyWrap = node("div", "single-object-copy");
  if (config.key === "profile") {
    const row = node("div", "record-preview"); const avatar = node("div", "preview-avatar");
    const photo = safeUrl(object.photoUrl);
    if (photo) { const image = node("img"); image.src = resolvePublicUrl(photo) || photo; image.alt = "Profile preview"; image.onerror = () => { image.remove(); avatar.textContent = initials(object.name); }; avatar.append(image); }
    else avatar.textContent = initials(object.name);
    const names = node("div"); names.append(node("h2", "", object.name || "Nama belum diatur"), node("p", "", object.title || "Profesi belum diatur")); row.append(avatar, names); copyWrap.append(row);
    copyWrap.append(node("p", "", object.summary || "Ringkasan profil masih kosong."));
  } else {
    copyWrap.append(node("h2", "", object.siteTitle || "Pengaturan situs"), node("p", "", object.metaDescription || "Deskripsi SEO belum diatur."));
  }
  const tags = node("div", "single-object-tags");
  if (config.key === "profile") {
    [["Lokasi", object.location], ["Email", object.email], ["Telepon", object.phone], ["CV ID", object.cvIdUrl ? "Tersedia" : "Belum diatur"], ["CV EN", object.cvEnUrl ? "Tersedia" : "Belum diatur"]].forEach(([label,value]) => tags.append(node("span", "summary-tag", `${label}: ${value || "—"}`)));
  } else [["Bahasa", object.defaultLanguage === "en" ? "English" : "Bahasa Indonesia"], ["Tema", object.defaultTheme || "light"], ["Judul", object.siteTitle || "—"]].forEach(([label,value]) => tags.append(node("span", "summary-tag", `${label}: ${value}`)));
  copyWrap.append(tags); card.append(copyWrap, action.cloneNode(true));
  // Attach behavior to the second visual edit button without cloning listeners.
  const copyButton = card.querySelector("button"); if (copyButton) copyButton.addEventListener("click", () => openEditor(config.key, object));
  target.append(card);
  const info = node("section", "panel"); info.style.marginTop = "17px"; const header = node("div", "panel-header"); header.append(node("h2", "", "Ringkasan field")); info.append(header);
  const body = node("div", "panel-body"); const list = node("div", "repo-detail-list");
  config.fields.forEach(field => {
    const row = node("div", "repo-detail"); row.append(node("span", "", field.label), node("strong", "", formatValue(object[field.key]))); list.append(row);
  }); body.append(list); info.append(body); target.append(info);
}
function renderCollection(target, config) {
  const add = button(`Tambah ${config.singular}`, "button button-primary", () => openEditor(config.key, null), "+");
  const exportButton = button("Export JSON", "button button-ghost", exportJson, "↓");
  const importButton = button("Import JSON", "button button-ghost", importJson, "↑");
  addHeading(target, config.label, config.description, [importButton, exportButton, add]);
  const panel = node("section", "table-panel");
  const toolbar = node("div", "table-toolbar"); const searchWrap = node("label", "table-search"); searchWrap.append(node("span", "", "⌕"));
  const search = node("input"); search.type = "search"; search.placeholder = `Cari ${config.label.toLowerCase()}…`; search.setAttribute("aria-label", `Cari ${config.label}`); search.value = currentView(config.key).query;
  search.addEventListener("input", () => { const view = currentView(config.key); view.query = search.value; view.page = 1; drawTable(config, panel); }); searchWrap.append(search); toolbar.append(searchWrap);
  if (config.filterKey) {
    const filter = node("select", "toolbar-select"); filter.setAttribute("aria-label", "Filter konten"); const options = [{value:"all", label:"Semua data"}];
    if (config.filterKey === "featured") options.push({value:"true",label:"Unggulan"},{value:"false",label:"Tidak unggulan"});
    else [...new Set((portfolioData[config.key] || []).map(row => row[config.filterKey]).filter(Boolean))].sort().forEach(value => options.push({value:String(value),label:String(value)}));
    options.forEach(opt => { const option = node("option", "", opt.label); option.value = opt.value; filter.append(option); });
    filter.value = currentView(config.key).filter; filter.addEventListener("change", () => { const view = currentView(config.key); view.filter = filter.value; view.page = 1; drawTable(config, panel); }); toolbar.append(filter);
  }
  const refresh = button("↻", "icon-button", () => refreshData(), ""); refresh.setAttribute("aria-label", "Muat ulang data dari GitHub"); refresh.title = "Muat ulang data"; toolbar.append(refresh);
  panel.append(toolbar);
  const tableBody = node("div", "table-render-area"); panel.append(tableBody);
  target.append(panel);
  drawTable(config, panel);
}
function drawTable(config, panel) {
  const area = panel.querySelector(".table-render-area"); if (!area) return; clear(area);
  const view = currentView(config.key);
  const all = Array.isArray(portfolioData[config.key]) ? portfolioData[config.key] : [];
  let rows = all.filter(record => {
    const allText = config.searchKeys.map(key => formatValue(record[key])).join(" ").toLowerCase();
    const matchesSearch = !view.query.trim() || allText.includes(view.query.trim().toLowerCase());
    let matchesFilter = true;
    if (view.filter !== "all" && config.filterKey === "featured") matchesFilter = Boolean(record.featured) === (view.filter === "true");
    else if (view.filter !== "all" && config.filterKey) matchesFilter = String(record[config.filterKey] || "") === view.filter;
    return matchesSearch && matchesFilter;
  });
  if (!view.sortKey) { view.sortKey = config.sortKey || config.columns?.[0]?.key || "updatedAt"; view.sortDirection = config.sortKey ? "asc" : "desc"; }
  rows.sort((a,b) => {
    const av = a[view.sortKey], bv = b[view.sortKey];
    let result;
    if (typeof av === "number" || typeof bv === "number") result = Number(av || 0) - Number(bv || 0);
    else result = String(av ?? "").localeCompare(String(bv ?? ""), "id", {numeric:true,sensitivity:"base"});
    return view.sortDirection === "desc" ? -result : result;
  });
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)); view.page = Math.min(Math.max(view.page, 1), pageCount);
  const start = (view.page - 1) * PAGE_SIZE; const shown = rows.slice(start, start + PAGE_SIZE);
  if (!rows.length) {
    const empty = node("div", "empty-table"); empty.append(node("div", "empty-symbol", "⌕"), node("strong", "", view.query || view.filter !== "all" ? "Tidak ada data yang cocok" : `Belum ada ${config.label.toLowerCase()}`), node("p", "", view.query || view.filter !== "all" ? "Ubah kata kunci atau filter, lalu coba lagi." : `Klik Tambah ${config.singular} untuk membuat data pertama.`)); area.append(empty);
  } else {
    const wrap = node("div", "table-wrap"); const table = node("table", "data-table"); const thead = node("thead"); const headRow = node("tr");
    config.columns.forEach(column => {
      const th = node("th"); const sort = node("button", "sort-button", `${column.label}${view.sortKey === column.key ? (view.sortDirection === "asc" ? " ↑" : " ↓") : ""}`); sort.type = "button"; sort.addEventListener("click", () => { if (view.sortKey === column.key) view.sortDirection = view.sortDirection === "asc" ? "desc" : "asc"; else { view.sortKey = column.key; view.sortDirection = "asc"; } drawTable(config, panel); }); th.append(sort); headRow.append(th);
    });
    const actionHead = node("th", "", "AKSI"); actionHead.style.textAlign = "right"; headRow.append(actionHead); thead.append(headRow); table.append(thead);
    const tbody = node("tbody");
    shown.forEach(record => {
      const tr = node("tr");
      config.columns.forEach(column => { const td = node("td"); td.append(formatCell(record, column)); tr.append(td); });
      const actions = node("td"); const actionWrap = node("div", "table-actions");
      const edit = node("button", "icon-button", "✎"); edit.type = "button"; edit.title = "Edit"; edit.setAttribute("aria-label", `Edit ${config.singular}`); edit.addEventListener("click", () => openEditor(config.key, record));
      const remove = node("button", "icon-button delete-action", "⌫"); remove.type = "button"; remove.title = "Hapus"; remove.setAttribute("aria-label", `Hapus ${config.singular}`); remove.addEventListener("click", () => deleteRecord(config.key, record));
      actionWrap.append(edit, remove); actions.append(actionWrap); tr.append(actions); tbody.append(tr);
    });
    table.append(tbody); wrap.append(table); area.append(wrap);
  }
  const meta = node("div", "table-meta"); meta.append(node("span", "", `Menampilkan ${rows.length ? start + 1 : 0}–${Math.min(start + PAGE_SIZE, rows.length)} dari ${rows.length} · ${all.length} total`));
  const pagination = node("div", "pagination");
  const prev = node("button", "page-button", "‹"); prev.type = "button"; prev.disabled = view.page <= 1; prev.setAttribute("aria-label", "Halaman sebelumnya"); prev.addEventListener("click", () => { view.page -= 1; drawTable(config, panel); }); pagination.append(prev);
  for (let p = Math.max(1, view.page - 2); p <= Math.min(pageCount, view.page + 2); p++) { const b = node("button", `page-button${p === view.page ? " active" : ""}`, p); b.type = "button"; b.setAttribute("aria-current", p === view.page ? "page" : "false"); b.addEventListener("click", () => { view.page = p; drawTable(config, panel); }); pagination.append(b); }
  const next = node("button", "page-button", "›"); next.type = "button"; next.disabled = view.page >= pageCount; next.setAttribute("aria-label", "Halaman berikutnya"); next.addEventListener("click", () => { view.page += 1; drawTable(config, panel); }); pagination.append(next);
  meta.append(pagination); area.append(meta);
}
function formatCell(record, column) {
  const value = record[column.key];
  if (column.type === "boolean") return node("span", `status-badge ${value ? "green" : "gray"}`, value ? "Unggulan" : "Biasa");
  if (column.type === "date") return node("span", "", value ? new Date(value).toLocaleDateString("id-ID", {year:"numeric",month:"short",day:"2-digit"}) : "—");
  if (column.type === "link") {
    const url = safeUrl(value); if (url) { const anchor = node("a", "", "Buka ↗"); setLink(anchor, url); anchor.style.color = "var(--secondary)"; anchor.style.fontWeight = "700"; return anchor; }
    return node("span", "", "—");
  }
  const textValue = formatValue(value);
  const el = node("span", "", textValue);
  if (textValue.length > 75) { el.textContent = `${textValue.slice(0,72)}…`; el.title = textValue; }
  return el;
}
function navigateTo(section) {
  currentSection = section;
  if (window.innerWidth <= 760) $("#sidebar").classList.remove("is-open");
  renderCurrentPage();
}
function openEditor(section, record = null) {
  if (isWriting) { showToast("warning", "Sedang menyimpan", "Tunggu hingga operasi sebelumnya selesai."); return; }
  const config = ENTITY_CONFIG[section]; if (!config) return;
  editorContext = { section, recordId: record?.id || null, isNew: !record && config.kind === "collection" };
  const form = $("#editor-form"), fields = $("#editor-fields"); clear(fields); $("#editor-message").textContent = ""; $("#editor-message").className = "form-message";
  $("#editor-title").textContent = `${record ? "Edit" : "Tambah"} ${config.singular}`;
  $("#editor-description").textContent = "Perubahan akan disimpan sebagai commit di repository konten publik.";
  $("#editor-save").disabled = false; $("#editor-save").textContent = "Simpan perubahan →"; $("#editor-cancel").textContent = "Batal";
  const values = record ? clone(record) : blankRecord(config);
  const inputMap = new Map();
  config.fields.forEach(field => {
    const wrapper = node("div", `field${field.full ? " full-span" : ""}`);
    if (field.type === "checkbox") {
      const row = node("div", "checkbox-field"); const input = node("input"); input.type = "checkbox"; input.id = `field-${field.key}`; input.name = field.key; input.checked = Boolean(values[field.key]);
      const label = node("label", "", field.label); label.htmlFor = input.id; row.append(input, label); wrapper.append(row); inputMap.set(field.key,input);
    } else {
      const label = node("label", "", field.label); label.htmlFor = `field-${field.key}`;
      if (field.required) label.append(node("span", "required", "*")); wrapper.append(label);
      let input;
      if (field.type === "textarea" || field.type === "array") { input = node("textarea"); input.rows = field.type === "array" ? 4 : 3; input.value = Array.isArray(values[field.key]) ? values[field.key].join("\n") : (values[field.key] ?? ""); if (field.type === "array") input.placeholder = "Tulis satu item per baris"; }
      else if (field.type === "select") {
        input = node("select");
        if (field.allowBlank) { const blank = node("option", "", "— Pilih —"); blank.value = ""; input.append(blank); }
        field.options.forEach(opt => { const option = node("option", "", opt.label); option.value = opt.value; input.append(option); }); input.value = values[field.key] ?? "";
      } else { input = node("input"); input.type = field.type === "number" ? "number" : field.inputMode === "email" ? "email" : "text"; if (field.type === "number") input.step = "1"; input.value = values[field.key] ?? ""; }
      input.id = `field-${field.key}`; input.name = field.key;
      if (field.required) input.required = true;
      if (field.hint) input.setAttribute("aria-describedby", `hint-${field.key}`);
      wrapper.append(input); inputMap.set(field.key,input);
      if (field.hint) { const hint = node("p", "field-hint-inline", field.hint); hint.id = `hint-${field.key}`; wrapper.append(hint); }
      if (field.type === "url" || field.key.toLowerCase().includes("image") || field.key.toLowerCase().includes("photo") || field.key.toLowerCase().includes("thumbnail")) {
        const preview = node("img", "image-preview"); preview.alt = `${field.label} preview`; preview.hidden = true; wrapper.append(preview);
        const updatePreview = () => { const safe = safeUrl(input.value); if (safe) { preview.src = resolvePublicUrl(safe) || safe; preview.hidden = false; } else { preview.hidden = true; preview.removeAttribute("src"); } };
        input.addEventListener("input", updatePreview); preview.onerror = () => { preview.hidden = true; }; updatePreview();
      }
    }
    fields.append(wrapper);
  });
  activeInputMap = inputMap;
  form.onsubmit = async event => {
    event.preventDefault();
    if (!github || !portfolioData) { editorMessage("Sesi GitHub tidak tersedia. Login kembali sebelum menyimpan."); return; }
    if (isWriting) return;
    const validation = validateEditorValues(config, inputMap);
    if (!validation.ok) { editorMessage(validation.message); validation.input?.focus(); return; }
    const nextFields = validation.values;
    let nextData = clone(portfolioData);
    const timestamp = nowIso();
    if (config.kind === "single") {
      const existing = nextData[section] || {};
      nextData[section] = { ...existing, ...nextFields, createdAt: existing.createdAt || timestamp, updatedAt: timestamp };
    } else if (record) {
      const index = nextData[section].findIndex(item => item.id === record.id);
      if (index < 0) { editorMessage("Record tidak ditemukan pada data terbaru. Muat ulang dan ulangi edit."); return; }
      nextData[section][index] = { ...nextData[section][index], ...nextFields, id: record.id, createdAt: nextData[section][index].createdAt || timestamp, updatedAt: timestamp };
    } else {
      nextData[section].push({ ...nextFields, id: createId(), createdAt: timestamp, updatedAt: timestamp });
    }
    nextData.updatedAt = timestamp;
    try { validatePortfolioData(nextData); } catch (error) { editorMessage(error.message); return; }
    const commitVerb = record ? "update" : "add";
    const message = `content(${section}): ${commitVerb} ${nextFields.title || nextFields.name || nextFields.position || nextFields.platform || config.singular}`;
    const saved = await commitData(nextData, message, `${config.singular} berhasil disimpan.`, { keepDialogOnFailure: true });
    if (saved) { closeEditor(); renderCurrentPage(); }
  };
  const dialog = $("#editor-dialog");
  if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
}
function renderEditorPreview() {
  if (!editorContext || !activeInputMap || !portfolioData) return;
  const config = ENTITY_CONFIG[editorContext.section];
  const validation = validateEditorValues(config, activeInputMap);
  if (!validation.ok) { editorMessage(`Lengkapi field yang diperlukan sebelum pratinjau: ${validation.message}`); validation.input?.focus(); return; }
  const values = validation.values;
  const target = $("#preview-content"); clear(target);
  $("#preview-title").textContent = `Pratinjau — ${config.singular}`;
  const card = node("article", "preview-card");
  const imageUrl = safeUrl(values.photoUrl || values.thumbnailUrl || values.imageUrl);
  if (imageUrl) { const image = node("img", "preview-cover"); image.src = resolvePublicUrl(imageUrl) || imageUrl; image.alt = "Pratinjau gambar"; image.onerror = () => { image.hidden = true; }; card.append(image); }
  const title = values.name || values.title || values.institution || values.organization || values.platform || values.label || values.siteTitle || config.label;
  const subtitle = values.position || values.title && values.name ? (values.position || values.title) : [values.degree, values.field, values.category].filter(Boolean).join(" · ");
  card.append(node("div", "eyebrow", `PREVIEW / ${config.label.toUpperCase()}`), node("h3", "", title));
  if (subtitle && subtitle !== title) card.append(node("div", "preview-subtitle", subtitle));
  const summary = values.summary || values.summaryText || values.description || values.metaDescription || values.email || "";
  if (summary) card.append(node("p", "", summary));
  const tags = node("div", "preview-tags");
  for (const tech of (values.technologies || values.gallery || [])) tags.append(node("span", "status-badge", tech));
  if (values.category) tags.append(node("span", "status-badge", values.category));
  if (values.proficiency) tags.append(node("span", "status-badge green", values.proficiency));
  if (values.featured) tags.append(node("span", "status-badge green", "Proyek unggulan"));
  if (tags.childElementCount) card.append(tags);
  if (values.repositoryUrl || values.demoUrl || values.credentialUrl || values.url) {
    const links = node("div", "preview-tags");
    for (const [key, label] of [["repositoryUrl","Repositori"],["demoUrl","Demo"],["credentialUrl","Kredensial"],["url","Tautan"]]) {
      const safe = safeUrl(values[key]); if (!safe) continue;
      const link = node("a", "summary-tag", `${label} ↗`); setLink(link, safe); links.append(link);
    }
    if (links.childElementCount) card.append(links);
  }
  const details = node("div", "preview-details");
  for (const field of config.fields) {
    if (["summary","description","technologies","gallery","photoUrl","thumbnailUrl","imageUrl","metaDescription"].includes(field.key)) continue;
    const value = values[field.key]; if (value === "" || value == null || Array.isArray(value) && !value.length || value === false || value === 0) continue;
    const item = node("div", "preview-detail"); item.append(node("span", "", field.label), node("strong", "", Array.isArray(value) ? value.join(", ") : String(value))); details.append(item);
  }
  if (details.childElementCount) card.append(details);
  target.append(card, node("p", "preview-disclaimer", "Pratinjau ini dirender lokal dari nilai formulir. Belum ada perubahan yang dikirim ke GitHub; simpan untuk membuat commit dan memublikasikan konten."));
  const dialog = $("#preview-dialog"); if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
}

function validateEditorValues(config, inputMap) {
  const values = {};
  for (const field of config.fields) {
    const input = inputMap.get(field.key); let value;
    if (field.type === "checkbox") value = input.checked;
    else if (field.type === "array") value = input.value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
    else if (field.type === "number") value = input.value.trim() === "" ? 0 : Number(input.value);
    else value = input.value.trim();
    if (field.required && (value === "" || (Array.isArray(value) && !value.length))) return { ok:false, message:`Field '${field.label}' wajib diisi.`, input };
    if (field.type === "number" && !Number.isFinite(value)) return { ok:false, message:`Field '${field.label}' harus berupa angka yang valid.`, input };
    if (field.inputMode === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { ok:false, message:`Format email pada '${field.label}' tidak valid.`, input };
    if (field.type === "url" && value && !safeUrl(value)) return { ok:false, message:`URL pada '${field.label}' harus HTTPS/HTTP atau path relatif yang aman.`, input };
    values[field.key] = value;
  }
  return { ok:true, values };
}
function editorMessage(message, type = "error") { const target = $("#editor-message"); target.textContent = message; target.className = `form-message${type === "success" ? " success" : ""}`; }
function closeEditor() { const dialog = $("#editor-dialog"); if (dialog.open && typeof dialog.close === "function") dialog.close(); else dialog.removeAttribute("open"); editorContext = null; activeInputMap = null; }
async function deleteRecord(section, record) {
  const config = ENTITY_CONFIG[section];
  requestConfirmation({ title: `Hapus ${config.singular}?`, message: `Data “${record.title || record.name || record.position || record.platform || config.singular}” akan dihapus dari file JSON publik melalui commit GitHub. Tindakan ini tidak dapat dibatalkan di dashboard.`, acceptLabel: "Hapus data", danger: true, action: async () => {
    if (isWriting) { showToast("warning", "Sedang menyimpan", "Tunggu hingga operasi sebelumnya selesai."); return; }
    const next = clone(portfolioData); next[section] = next[section].filter(item => item.id !== record.id); next.updatedAt = nowIso();
    const saved = await commitData(next, `content(${section}): delete ${record.id}`, `${config.singular} berhasil dihapus.`);
    if (saved) renderCurrentPage();
  }});
}
async function commitData(nextData, commitMessage, successMessage, options = {}) {
  if (!github) { showToast("error", "Tidak ada sesi", "Login kembali dengan token GitHub."); return false; }
  if (isWriting) { showToast("warning", "Sedang menyimpan", "Satu operasi tulis sudah berjalan. Coba kembali setelah selesai."); return false; }
  try { validatePortfolioData(nextData); } catch (error) { showToast("error", "Validasi data gagal", error.message); return false; }
  isWriting = true;
  const saveButton = $("#editor-save"); if (saveButton) { saveButton.disabled = true; saveButton.textContent = "Menyimpan…"; }
  try {
    await github.save(nextData, commitMessage);
    portfolioData = nextData;
    try { latestCommit = await github.latestCommit(); } catch { latestCommit = null; }
    showToast("success", "Perubahan tersimpan", successMessage || "GitHub berhasil membuat commit pada repository konten.");
    return true;
  } catch (error) {
    let conflict = error.status === 409 || (error.status === 422 && /sha|conflict|reference/i.test(error.message || ""));
    if (conflict) {
      try {
        const latest = await github.load(); validatePortfolioData(latest.data); portfolioData = latest.data;
        renderAfterEditorClose = true;
        if (options.keepDialogOnFailure && $("#editor-dialog").open) {
          editorMessage("Konflik versi: GitHub menolak perubahan ini karena file telah berubah. Perubahan belum disimpan. Tutup editor, tinjau versi terbaru, lalu terapkan ulang perubahan secara manual.");
          $("#editor-save").disabled = true;
          $("#editor-save").textContent = "Konflik — simpan diblokir";
          $("#editor-cancel").textContent = "Tutup & tinjau versi terbaru";
        } else renderCurrentPage();
      } catch { /* keep the loaded view and surface the original error */ }
      showToast("warning", "Konflik versi terdeteksi", "Perubahan tidak ditimpa. Data terbaru dimuat untuk ditinjau; ulangi perubahan setelah memeriksa versi terbaru.");
    } else if (error.status === 0) {
      // A network error can occur after GitHub accepts a write. Re-read to avoid suggesting blind retries.
      try {
        const latest = await github.load(); validatePortfolioData(latest.data);
        if (JSON.stringify(latest.data) === JSON.stringify(nextData)) {
          portfolioData = latest.data;
          try { latestCommit = await github.latestCommit(); } catch { latestCommit = null; }
          showToast("success", "Commit terverifikasi", "Koneksi terputus saat menunggu respons, tetapi versi terbaru GitHub cocok dengan data yang dikirim.");
          return true;
        }
        portfolioData = latest.data; renderAfterEditorClose = true;
        if (options.keepDialogOnFailure && $("#editor-dialog").open) {
          editorMessage("Status operasi belum dapat dipastikan dan data GitHub berbeda. Perubahan ini belum diverifikasi. Tutup editor, tinjau data terbaru, lalu coba lagi setelah memastikan perubahan yang diperlukan.");
          $("#editor-save").disabled = true; $("#editor-save").textContent = "Perlu ditinjau"; $("#editor-cancel").textContent = "Tutup & tinjau data";
        } else renderCurrentPage();
      } catch { /* service remains in a recoverable uncertain state */ }
      showToast("error", "Status commit belum pasti", friendlyApiError(error));
    } else {
      const message = friendlyApiError(error);
      if (options.keepDialogOnFailure && $("#editor-dialog").open) editorMessage(message);
      showToast("error", "Gagal menyimpan", message);
    }
    return false;
  } finally {
    isWriting = false;
    if (saveButton && $("#editor-save")?.textContent === "Menyimpan…") { saveButton.disabled = false; saveButton.textContent = "Simpan perubahan →"; }
  }
}
function exportJson() {
  if (!portfolioData) { showToast("error", "Tidak ada data", "Data belum berhasil dimuat."); return; }
  const blob = new Blob([`${JSON.stringify(portfolioData, null, 2)}\n`], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob); const anchor = node("a"); anchor.href = url; anchor.download = `portfolio-backup-${new Date().toISOString().slice(0,10)}.json`; document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
  showToast("success", "Backup diekspor", "File JSON telah dibuat di perangkat ini.");
}
function importJson() {
  if (!github || isWriting) { showToast("warning", "Belum siap", "Pastikan sesi aktif dan tidak ada operasi simpan yang berjalan."); return; }
  const input = node("input"); input.type = "file"; input.accept = ".json,application/json"; input.hidden = true; document.body.append(input);
  input.addEventListener("change", async () => {
    try {
      const file = input.files?.[0]; if (!file) return;
      if (file.size > 2 * 1024 * 1024) throw new Error("Ukuran JSON maksimal 2 MB untuk mencegah file terlalu besar.");
      const parsed = JSON.parse(await file.text()); validatePortfolioData(parsed);
      requestConfirmation({ title: "Import dan ganti seluruh data?", message: "Isi file JSON akan menggantikan seluruh konten saat ini di repository publik melalui satu commit. Pastikan Anda sudah mengekspor backup data terkini.", acceptLabel: "Import & commit", danger: true, action: async () => {
        const next = clone(parsed); next.updatedAt = nowIso();
        const ok = await commitData(next, "chore(portfolio): import JSON backup", "File JSON berhasil diimpor dan dikomit ke repository.");
        if (ok) renderCurrentPage();
      }});
    } catch (error) { showToast("error", "Import ditolak", error instanceof SyntaxError ? "File tidak berisi JSON yang valid." : error.message); }
    finally { input.remove(); }
  });
  input.click();
}
function initials(name) { return String(name || "Raga Triagantara").trim().split(/\s+/).slice(0,2).map(value => value[0] || "").join("").toUpperCase(); }

// Login tests repository/file access; write permission is verified only when a save is attempted.
$("#login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const input = $("#pat-token"); const submit = $("#login-button"); const token = input.value.trim();
  if (!token) { setLoginMessage("Masukkan token GitHub terlebih dahulu."); return; }
  input.value = ""; submit.disabled = true; submit.querySelector("span").textContent = "Memverifikasi…"; setLoginMessage("Memeriksa akses repository…", "success");
  const candidate = createGithubService(token);
  try {
    const loaded = await candidate.load(); validatePortfolioData(loaded.data);
    github?.clear(); github = candidate; portfolioData = loaded.data;
    try { latestCommit = await github.latestCommit(); } catch { latestCommit = null; }
    showDashboard(); showToast("success", "Akses terverifikasi", "Data repository berhasil dibaca. Operasi tulis tetap memerlukan Contents: Read and write.");
  } catch (error) {
    candidate.clear();
    setLoginMessage(friendlyApiError(error));
  } finally { submit.disabled = false; submit.querySelector("span").textContent = "Verifikasi akses"; }
});
$("#logout-button").addEventListener("click", () => {
  requestConfirmation({ title: "Akhiri sesi admin?", message: "Referensi token dihapus dari sesi aplikasi ini. Pastikan perubahan yang belum tersimpan sudah dicadangkan.", acceptLabel: "Logout", danger: false, action: () => {
    github?.clear(); github = null; portfolioData = null; latestCommit = null; currentSection = "overview"; viewStates = new Map(); showLogin(); showToast("success", "Sesi berakhir", "Referensi token telah dibersihkan dari state aplikasi.");
  }});
});
$$("[data-section]").forEach(item => item.addEventListener("click", () => navigateTo(item.dataset.section)));
$("#mobile-menu-button").addEventListener("click", () => $("#sidebar").classList.toggle("is-open"));
$("#sidebar-close").addEventListener("click", () => $("#sidebar").classList.remove("is-open"));
$("#editor-close").addEventListener("click", closeEditor);
$("#editor-cancel").addEventListener("click", closeEditor);
$("#editor-preview").addEventListener("click", renderEditorPreview);
$("#preview-close").addEventListener("click", () => $("#preview-dialog").close());
$("#preview-back").addEventListener("click", () => $("#preview-dialog").close());
$("#preview-save").addEventListener("click", () => { $("#preview-dialog").close(); $("#editor-form").requestSubmit(); });
$("#preview-dialog").addEventListener("click", event => { if (event.target === $("#preview-dialog")) $("#preview-dialog").close(); });
$("#editor-dialog").addEventListener("click", event => { if (event.target === $("#editor-dialog") && !isWriting) closeEditor(); });
$("#editor-dialog").addEventListener("close", () => {
  if (renderAfterEditorClose) { renderAfterEditorClose = false; renderCurrentPage(); }
});
$("#confirm-cancel").addEventListener("click", () => { pendingConfirm = null; $("#confirm-dialog").close(); });
$("#confirm-accept").addEventListener("click", async () => {
  const action = pendingConfirm; pendingConfirm = null; $("#confirm-dialog").close();
  if (action) { try { await action(); } catch (error) { showToast("error", "Operasi gagal", friendlyApiError(error)); } }
});
$("#confirm-dialog").addEventListener("click", event => { if (event.target === $("#confirm-dialog")) { pendingConfirm = null; $("#confirm-dialog").close(); } });
window.addEventListener("pagehide", () => { github?.clear(); github = null; });
window.addEventListener("pageshow", event => { if (event.persisted && !github) showLogin(); });
document.addEventListener("keydown", event => { if (event.key === "Escape") $("#sidebar").classList.remove("is-open"); });

$$("[data-public-link]").forEach(link => setLink(link, CONFIG.publicUrl));
showLogin();
