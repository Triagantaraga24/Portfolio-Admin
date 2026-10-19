import { CONFIG } from "./config.js";

export class ApiError extends Error {
  constructor(message, status = 0, payload = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

function encodeUtf8Base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
function decodeUtf8Base64(base64) {
  const normalized = String(base64 || "").replace(/\s/g, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
function safeSegmentPath(path) { return path.split("/").map(segment => encodeURIComponent(segment)).join("/"); }

export function createGithubService(initialToken) {
  let tokenValue = String(initialToken || "");
  let currentSha = null;
  const fileUrl = `${CONFIG.apiBase}/repos/${encodeURIComponent(CONFIG.owner)}/${encodeURIComponent(CONFIG.contentRepo)}/contents/${safeSegmentPath(CONFIG.dataPath)}`;
  const branchQuery = `ref=${encodeURIComponent(CONFIG.branch)}`;

  function clearToken() { tokenValue = ""; currentSha = null; }
  function requireToken() { if (!tokenValue) throw new ApiError("Sesi telah berakhir. Masukkan token kembali.", 401); }
  function headers(extra = {}) {
    requireToken();
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${tokenValue}`,
      "X-GitHub-Api-Version": CONFIG.apiVersion,
      "Content-Type": "application/json",
      ...extra
    };
  }
  async function request(url, options = {}) {
    requireToken();
    if (!url.startsWith(CONFIG.apiBase + "/")) throw new ApiError("Permintaan diblokir karena tujuan API tidak diizinkan.", 0);
    let response;
    try {
      response = await fetch(url, { ...options, headers: headers(options.headers || {}), cache: "no-store" });
    } catch {
      throw new ApiError("Tidak dapat terhubung ke GitHub API. Periksa koneksi internet lalu coba kembali.", 0);
    }
    const raw = await response.text();
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch { payload = null; }
    if (!response.ok) {
      let message = payload?.message || `GitHub API merespons HTTP ${response.status}.`;
      if (tokenValue) message = message.split(tokenValue).join("[redacted]");
      throw new ApiError(message, response.status, payload);
    }
    return payload;
  }
  async function load() {
    const response = await request(`${fileUrl}?${branchQuery}`, { method: "GET" });
    if (!response || response.type !== "file" || !response.sha || typeof response.content !== "string") {
      throw new ApiError("GitHub API tidak mengembalikan file JSON dengan SHA yang valid.", 422, response);
    }
    let data;
    try { data = JSON.parse(decodeUtf8Base64(response.content)); }
    catch { throw new ApiError("Isi data/portfolio.json bukan JSON UTF-8 yang valid.", 422); }
    currentSha = response.sha;
    return { data, sha: currentSha, path: CONFIG.dataPath, branch: CONFIG.branch };
  }
  async function save(data, message = "chore(portfolio): update portfolio content") {
    requireToken();
    if (!currentSha) throw new ApiError("SHA file belum tersedia. Muat ulang data dari GitHub sebelum menyimpan.", 409);
    const body = { message, content: encodeUtf8Base64(`${JSON.stringify(data, null, 2)}\n`), sha: currentSha, branch: CONFIG.branch };
    const response = await request(fileUrl, { method: "PUT", body: JSON.stringify(body) });
    const newSha = response?.content?.sha;
    if (!newSha) throw new ApiError("GitHub tidak mengembalikan SHA setelah commit. Muat ulang file untuk memverifikasi status.", 422, response);
    currentSha = newSha;
    return { sha: newSha, commit: response.commit || null };
  }
  async function latestCommit() {
    const url = `${CONFIG.apiBase}/repos/${encodeURIComponent(CONFIG.owner)}/${encodeURIComponent(CONFIG.contentRepo)}/commits?path=${encodeURIComponent(CONFIG.dataPath)}&per_page=1&sha=${encodeURIComponent(CONFIG.branch)}`;
    const response = await request(url, { method: "GET" });
    const commit = Array.isArray(response) ? response[0] : null;
    return commit ? { sha: commit.sha, message: commit.commit?.message || "", date: commit.commit?.committer?.date || commit.commit?.author?.date || "", url: commit.html_url || "" } : null;
  }
  return Object.freeze({ load, save, latestCommit, clear: clearToken, get hasToken() { return Boolean(tokenValue); } });
}
