export const COLLECTION_KEYS = ["skills", "experiences", "education", "organizations", "achievements", "projects", "socialLinks"];

const text = (key, label, options = {}) => ({ key, label, type: "text", ...options });
const area = (key, label, options = {}) => ({ key, label, type: "textarea", full: true, ...options });
const url = (key, label, options = {}) => ({ key, label, type: "url", ...options });
const array = (key, label, options = {}) => ({ key, label, type: "array", full: true, hint: "Satu item per baris.", ...options });
const select = (key, label, options, extra = {}) => ({ key, label, type: "select", options, ...extra });
const checkbox = (key, label, options = {}) => ({ key, label, type: "checkbox", ...options });
const number = (key, label, options = {}) => ({ key, label, type: "number", ...options });

export const ENTITY_CONFIG = {
  profile: {
    key: "profile", label: "Profil", singular: "profil", kind: "single", icon: "◎",
    description: "Informasi utama yang tampil pada bagian hero, tentang saya, dan kontak.",
    fields: [
      text("name", "Nama lengkap", { required: true }), text("title", "Profesi / headline", { required: true }),
      area("summary", "Ringkasan profil", { hint: "Gunakan ringkasan faktual yang telah diverifikasi." }),
      text("location", "Lokasi"), text("email", "Email", { inputMode: "email" }), text("phone", "Nomor telepon"),
      url("photoUrl", "URL foto profil", { hint: "URL HTTPS atau path relatif, misalnya ./assets/profile.jpg." }),
      url("cvIdUrl", "URL CV Bahasa Indonesia"), url("cvEnUrl", "URL CV Bahasa Inggris")
    ], searchKeys: ["name", "title", "summary"]
  },
  skills: {
    key: "skills", label: "Skills", singular: "skill", kind: "collection", icon: "✳",
    description: "Kelola daftar skill beserta kategori dan tingkat kemahiran. ID dan timestamp dikelola otomatis.",
    fields: [text("name", "Nama skill", { required: true }), text("category", "Kategori", { required: true }), select("proficiency", "Tingkat kemahiran", [{value:"Beginner",label:"Beginner"},{value:"Intermediate",label:"Intermediate"},{value:"Advanced",label:"Advanced"},{value:"Expert",label:"Expert"}], { allowBlank: true }), number("sortOrder", "Urutan tampilan", { hint: "Angka lebih kecil tampil lebih dahulu." })],
    columns: [{key:"name",label:"Skill"},{key:"category",label:"Kategori"},{key:"proficiency",label:"Kemahiran"},{key:"updatedAt",label:"Diperbarui",type:"date"}], searchKeys: ["name", "category", "proficiency"], filterKey: "category", sortKey: "sortOrder"
  },
  experiences: {
    key: "experiences", label: "Pengalaman", singular: "pengalaman", kind: "collection", icon: "↗",
    description: "Riwayat kerja, mengajar, atau pengalaman relevan yang sudah terverifikasi.",
    fields: [text("organization", "Organisasi / tempat", {required:true}), text("position", "Posisi", {required:true}), area("description", "Deskripsi"), text("startDate", "Tanggal mulai", {hint:"Format yang disarankan: YYYY-MM."}), text("endDate", "Tanggal selesai", {hint:"Kosongkan bila masih berlangsung."}), checkbox("isCurrent", "Masih berlangsung"), number("sortOrder", "Urutan tampilan")],
    columns: [{key:"position",label:"Posisi"},{key:"organization",label:"Organisasi"},{key:"startDate",label:"Mulai"},{key:"endDate",label:"Selesai"}], searchKeys: ["organization", "position", "description"], sortKey: "sortOrder"
  },
  education: {
    key: "education", label: "Pendidikan", singular: "pendidikan", kind: "collection", icon: "⌂",
    description: "Informasi institusi, jenjang, bidang studi, dan rentang tahun pendidikan.",
    fields: [text("institution", "Institusi", {required:true}), text("degree", "Jenjang", {required:true}), text("field", "Bidang studi"), text("startYear", "Tahun mulai", {hint:"Misalnya 2020."}), text("endYear", "Tahun selesai", {hint:"Misalnya 2024, atau kosongkan bila masih berjalan."}), area("description", "Deskripsi"), number("sortOrder", "Urutan tampilan")],
    columns: [{key:"institution",label:"Institusi"},{key:"degree",label:"Jenjang"},{key:"field",label:"Bidang studi"},{key:"endYear",label:"Tahun selesai"}], searchKeys: ["institution", "degree", "field", "description"], sortKey: "sortOrder"
  },
  organizations: {
    key: "organizations", label: "Organisasi", singular: "organisasi", kind: "collection", icon: "◎",
    description: "Keikutsertaan organisasi dan peran yang dapat dicantumkan secara publik.",
    fields: [text("name", "Nama organisasi", {required:true}), text("position", "Jabatan / peran", {required:true}), area("description", "Deskripsi"), text("startDate", "Tanggal mulai"), text("endDate", "Tanggal selesai"), checkbox("isCurrent", "Masih aktif"), number("sortOrder", "Urutan tampilan")],
    columns: [{key:"name",label:"Organisasi"},{key:"position",label:"Peran"},{key:"startDate",label:"Mulai"},{key:"endDate",label:"Selesai"}], searchKeys: ["name", "position", "description"], sortKey: "sortOrder"
  },
  achievements: {
    key: "achievements", label: "Pencapaian", singular: "pencapaian", kind: "collection", icon: "✦",
    description: "Sertifikat, penghargaan, dan pencapaian. Pastikan informasi penerbit dan tautan kredensial benar.",
    fields: [text("title", "Judul pencapaian", {required:true}), text("issuer", "Penerbit", {required:true}), text("date", "Tanggal", {hint:"Gunakan YYYY-MM atau YYYY-MM-DD."}), area("description", "Deskripsi"), url("credentialUrl", "URL kredensial"), url("imageUrl", "URL gambar sertifikat")],
    columns: [{key:"title",label:"Pencapaian"},{key:"issuer",label:"Penerbit"},{key:"date",label:"Tanggal"},{key:"credentialUrl",label:"Kredensial",type:"link"}], searchKeys: ["title", "issuer", "description"]
  },
  projects: {
    key: "projects", label: "Proyek", singular: "proyek", kind: "collection", icon: "◈",
    description: "Detail proyek, teknologi, galeri, repositori, demo, dan penanda unggulan.",
    fields: [text("title", "Nama proyek", {required:true}), text("slug", "Slug", {hint:"URL-friendly id proyek, contoh: portfolio-cms."}), text("summary", "Ringkasan", {required:true, full:true}), area("description", "Deskripsi lengkap"), array("technologies", "Teknologi"), url("thumbnailUrl", "URL thumbnail", {full:true}), array("gallery", "URL gambar galeri"), url("repositoryUrl", "URL repositori"), url("demoUrl", "URL demo"), checkbox("featured", "Tandai sebagai proyek unggulan"), number("sortOrder", "Urutan tampilan")],
    columns: [{key:"title",label:"Proyek"},{key:"technologies",label:"Teknologi"},{key:"featured",label:"Unggulan",type:"boolean"},{key:"updatedAt",label:"Diperbarui",type:"date"}], searchKeys: ["title", "slug", "summary", "description", "technologies"], filterKey: "featured", sortKey: "sortOrder", previewField: "thumbnailUrl"
  },
  socialLinks: {
    key: "socialLinks", label: "Social Links", singular: "social link", kind: "collection", icon: "↗",
    description: "Tautan profil eksternal. Hanya URL HTTPS yang valid akan ditampilkan pada situs publik.",
    fields: [text("platform", "Platform", {required:true}), text("label", "Label tampilan", {hint:"Contoh: GitHub, LinkedIn, Instagram."}), url("url", "URL profil", {required:true, full:true})],
    columns: [{key:"platform",label:"Platform"},{key:"label",label:"Label"},{key:"url",label:"URL",type:"link"}], searchKeys: ["platform", "label", "url"]
  },
  siteSettings: {
    key: "siteSettings", label: "Pengaturan Situs", singular: "pengaturan", kind: "single", icon: "⚙",
    description: "Preferensi default bahasa dan tema, serta metadata dasar SEO.",
    fields: [select("defaultLanguage", "Bahasa default", [{value:"id",label:"Bahasa Indonesia"},{value:"en",label:"English"}], {required:true}), select("defaultTheme", "Tema default", [{value:"light",label:"Light mode"},{value:"dark",label:"Dark mode"}], {required:true}), text("siteTitle", "Judul situs", {required:true, full:true}), area("metaDescription", "Deskripsi SEO", {full:true})], searchKeys: ["siteTitle", "metaDescription"]
  }
};

export function createId() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* use fallback */ }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
export function emptyPortfolio() {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    profile: { name:"Raga Triagantara", title:"Web Developer", summary:"", location:"Tangerang Selatan, Indonesia", email:"ragatriagantara@gmail.com", phone:"+62-822-1893-0675", photoUrl:"", cvIdUrl:"", cvEnUrl:"", createdAt:"", updatedAt:"" },
    skills:[], experiences:[], education:[], organizations:[], achievements:[], projects:[], socialLinks:[],
    siteSettings:{ defaultLanguage:"id", defaultTheme:"light", siteTitle:"Raga Triagantara — Portfolio", metaDescription:"Portofolio profesional Raga Triagantara — Web Developer." }
  };
}
export function blankRecord(config) {
  const result = {};
  for (const field of config.fields) {
    if (field.type === "checkbox") result[field.key] = false;
    else if (field.type === "array") result[field.key] = [];
    else if (field.type === "number") result[field.key] = 0;
    else result[field.key] = "";
  }
  return result;
}
export function validatePortfolioData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("JSON harus berisi satu objek root.");
  if (data.schemaVersion !== 1) throw new Error("schemaVersion harus bernilai 1.");
  if (!data.profile || typeof data.profile !== "object" || Array.isArray(data.profile)) throw new Error("Field profile harus berupa objek.");
  if (!data.siteSettings || typeof data.siteSettings !== "object" || Array.isArray(data.siteSettings)) throw new Error("Field siteSettings harus berupa objek.");
  for (const key of COLLECTION_KEYS) {
    if (!Array.isArray(data[key])) throw new Error(`Field '${key}' harus berupa array.`);
    const ids = new Set();
    for (const [index, record] of data[key].entries()) {
      if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error(`Record ${index + 1} pada '${key}' bukan objek yang valid.`);
      if (typeof record.id !== "string" || !record.id.trim()) throw new Error(`Record ${index + 1} pada '${key}' tidak memiliki ID stabil.`);
      if (ids.has(record.id)) throw new Error(`Ditemukan ID duplikat '${record.id}' pada '${key}'.`);
      ids.add(record.id);
      if (Array.isArray(record.technologies) && record.technologies.some(item => typeof item !== "string")) throw new Error(`Teknologi proyek nomor ${index + 1} harus berupa daftar teks.`);
    }
  }
  return data;
}
