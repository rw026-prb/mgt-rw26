// ============================================================================
//  lib.mjs  —  Klien Google Sheets + Supabase, tanpa dependency npm
// ============================================================================
//  Sengaja memakai API bawaan Node (fetch, crypto) supaya skrip migrasi bisa
//  dijalankan tanpa `npm install` sama sekali. Node 18+ sudah menyediakan
//  keduanya.
//
//  Dua hal yang fiddly handled di sini:
//
//  1. GOOGLE SHEETS DATE SERIAL
//     Nilai sel bertanggal di Sheets dikembalikan sebagai angka (serial),
//     bukan string tanggal. Angka 25569 berarti 1970-01-01. Karena file
//     spreadsheet bisa berada di zona waktu berbeda dari komputer kita,
//     konversinya selalu memakai zona waktu spreadsheet itu sendiri.
//
//  2. FORMULA =HYPERLINK(...)
//     Kolom foto di Sheets berisi formula, bukan teks.ULEM URL biasa harus
//     dibaca dari string formula-nya, bukan dari teks yang tampil. Kalau
//     salah baca, semua link foto hilang.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
//  Konfigurasi
// ---------------------------------------------------------------------------

export function loadEnv(file) {
  const target = file || path.join(process.cwd(), '.env');
  if (!fs.existsSync(target)) return {};
  const out = {};
  // Notepad di Windows menyimpan UTF-8 dengan BOM. Tanpa dibuang, kunci pertama
  // akan terbaca sebagai "﻿SUPABASE_URL" dan tidak dikenali.
  const raw = fs.readFileSync(target, 'utf8').replace(/^﻿/, '');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

// ---------------------------------------------------------------------------
//  Zona waktu
// ---------------------------------------------------------------------------

function partsIn(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  return dtf.formatToParts(date).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
}

function offsetMinutes(date, timeZone) {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

const pad2 = (n) => String(n).padStart(2, '0');

/** Serial number Sheets -> 'YYYY-MM-DD' menurut zona waktu spreadsheet. */
export function serialToDate(serial, timeZone = 'Asia/Jakarta') {
  const d = new Date(Math.round((serial - 25569) * 86400000));
  const p = partsIn(d, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Serial number Sheets -> 'YYYY-MM-DDTHH:MM:SS+07:00'. */
export function serialToTimestamp(serial, timeZone = 'Asia/Jakarta') {
  return isoFrom(new Date(Math.round((serial - 25569) * 86400000)), timeZone);
}

// ---------------------------------------------------------------------------
//  Google service account -> access token
// ---------------------------------------------------------------------------

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Tandatangani JWT RS256 tanpa library pihak ketiga. */
function signJwt({ clientEmail, privateKey, scope, expiresInSec = 3600 }) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: clientEmail,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + expiresInSec,
  }));
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), privateKey);
  return `${header}.${claims}.${base64url(signature)}`;
}

async function getGoogleAccessToken(cfg) {
  const key = (cfg.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!key || !cfg.GOOGLE_CLIENT_EMAIL) {
    throw new Error(
      'GOOGLE_CLIENT_EMAIL atau GOOGLE_PRIVATE_KEY belum diisi di .env\n' +
      'Ikuti langkah di supabase/tools/README.md untuk membuat service account.'
    );
  }
  const assertion = signJwt({
    clientEmail: cfg.GOOGLE_CLIENT_EMAIL,
    privateKey: key,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Gagal ambil token Google: ' + JSON.stringify(data));
  return data.access_token;
}

// ---------------------------------------------------------------------------
//  Google Sheets
// ---------------------------------------------------------------------------

export class Sheets {
  constructor({ token, timeZone = 'Asia/Jakarta' }) {
    this.token = token;
    this.timeZone = timeZone;
    this.cache = new Map();
  }

  static async create(cfg) {
    const token = await getGoogleAccessToken(cfg);
    const tz = await Sheets.fetchTimeZone(cfg, token);
    return new Sheets({ token, timeZone: tz });
  }

  static async fetchTimeZone(cfg, token) {
    for (const id of [cfg.SPREADSHEET_INFO, cfg.SPREADSHEET_FASUM, cfg.SPREADSHEET_ORG, cfg.SPREADSHEET_HIMBAUAN].filter(Boolean)) {
      try {
        const res = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties.timeZone`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) continue;
        const data = await res.json();
        if (data?.properties?.timeZone) return data.properties.timeZone;
      } catch { /* coba spreadsheet berikutnya */ }
    }
    return 'Asia/Jakarta';
  }

  async #get(range, params) {
    const url = new URL(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.#spreadsheetId}/values/${encodeURIComponent(range)}`
    );
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Sheets API error pada "${range}": ${res.status} ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    return data.values || [];
  }

  #spreadsheetId = null;

  /**
   * Baca satu tab dan kembalikan baris data (baris 1 = header, dilewati).
   *
   * Setiap elemen hasil adalah { r, v, f, t }:
   *   r = nomor baris di sheet (2 = baris data pertama)
   *   v = nilai mentah (angka, teks, atau serial tanggal)
   *   f = string formula bila sel berisi formula, selain itu null
   *   t = 'number' | 'string' | 'formula'
   */
  async read(spreadsheetId, tabName, lastColumn = 26) {
    this.#spreadsheetId = spreadsheetId;
    const range = `'${tabName}'!A2:${colLetter(lastColumn)}`;
    const key = `${spreadsheetId}|${tabName}`;

    if (!this.cache.has(key)) {
      const [formulas, raw] = await Promise.all([
        this.#get(range, { valueRenderOption: 'FORMULA' }),
        this.#get(range, { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' }),
      ]);
      this.cache.set(key, { formulas, raw });
    }
    const { formulas, raw } = this.cache.get(key);

    const out = [];
    const height = Math.max(formulas.length, raw.length);
    for (let i = 0; i < height; i++) {
      const fRow = formulas[i] || [];
      const vRow = raw[i] || [];
      if (fRow.every((c) => c === '' || c == null) && vRow.every((c) => c === '' || c == null)) continue;
      out.push(makeRow(i + 2, fRow, vRow, lastColumn));
    }
    return out;
  }

  toDate(serial) { return serialToDate(serial, this.timeZone); }
  toTimestamp(serial) { return serialToTimestamp(serial, this.timeZone); }
}

function colLetter(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Bentuk satu baris menjadi array sel.
 *
 * Panjang array SELALU sama dengan `width`, walaupun kolom terakhir kosong.
 * Ini penting: kalau kolom FOTO kosong di semua baris, Sheets hanya
 * mengembalikan 3 kolom. Kalau lalu diurai dengan
 * `const [id, jabatan, nama, foto] = row.cells`, variabel `foto` bernilai
 * undefined dan pembacaan `foto.f` akan membuat skrip berhenti mendadak.
 */
function makeRow(rowNumber, fRow, vRow, width) {
  const total = Math.max(width, fRow.length, vRow.length);
  const cells = [];
  for (let j = 0; j < total; j++) {
    const f = fRow[j];
    const v = vRow[j];
    if (typeof f === 'string' && f.startsWith('=')) {
      cells.push({ v, f, t: 'formula' });
    } else if (typeof v === 'number') {
      cells.push({ v, f: null, t: 'number' });
    } else {
      cells.push({ v: v == null ? '' : String(v), f: null, t: 'string' });
    }
  }
  return { r: rowNumber, cells };
}

// ---------------------------------------------------------------------------
//  PostgREST + Supabase Admin
// ---------------------------------------------------------------------------

/** Parse JSON, atau null kalau isinya bukan JSON (mis. halaman error HTML). */
export function safeJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export class Supabase {
  constructor({ url, serviceRoleKey, anonKey }) {
    this.url = url.replace(/\/+$/, '');
    this.serviceRoleKey = serviceRoleKey;
    this.anonKey = anonKey;
  }

  #headers(key, extra = {}) {
    return {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  async request(method, path, { key, body, prefer, query } = {}) {
    const url = new URL(`${this.url}/rest/v1/${path}`);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);

    // WAJIB huruf kapital. Node fetch tidak menormalkan method: `patch`
    // dikirim apa adanya, dan Cloudflare menolak dengan "400 Bad Request"
    // sebelum request-nya sempat sampai ke PostgREST. Gejalanya menyesatkan
    // karena error-nya HTML, bukan JSON seperti error PostgREST biasa.
    const verb = String(method).toUpperCase();

    const res = await fetch(url, {
      method: verb,
      headers: this.#headers(key || this.serviceRoleKey, prefer ? { Prefer: prefer } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      // Bedakan error dari PostgREST (JSON) dengan penolakan di tepi (HTML).
      const json = safeJson(text);
      if (json && json.message) {
        throw new Error(`${verb} ${path} -> ${res.status} ${json.message}` +
          (json.hint ? ` (${json.hint})` : '') + (json.details ? ` [${json.details}]` : ''));
      }
      throw new Error(
        `${verb} ${path} -> ${res.status} ${res.statusText}\n` +
        `  Respons bukan JSON dari PostgREST - biasanya ditolak proxy/CDN.\n` +
        `  Cuplikan: ${text.replace(/\s+/g, ' ').slice(0, 200)}`
      );
    }
    return safeJson(text);
  }

  select(table, query = {}) { return this.request('get', table, { query }); }
  upsert(table, rows, onConflict) {
    const q = onConflict ? { on_conflict: onConflict } : {};
    return this.request('post', table, {
      body: rows, prefer: 'resolution=merge-duplicates,return=minimal', query: q,
    });
  }
  patch(table, query, body) { return this.request('patch', table, { query, body }); }
  remove(table, query) { return this.request('delete', table, { query, prefer: 'return=minimal' }); }
  count(table, query = {}) { return this.request('head', table, { query }); }

  rpc(fn, args, { anon = false } = {}) {
    return this.request('post', `rpc/${fn}`, { body: args, key: anon ? this.anonKey : this.serviceRoleKey });
  }

  // ---- Admin API (Buat user) ----
  //
  // Catatan: endpoint ini tidak selalu mengembalikan body. PATCH pada sebagian
  // operasi membalas 204 No Content, dan res.json() akan melempar
  // "Unexpected end of JSON input". Karena itu semua di sini memakai safeJson.
  async adminCreateUser({ email, password, user_metadata, app_metadata }) {
    const res = await fetch(`${this.url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: this.#headers(this.serviceRoleKey),
      body: JSON.stringify({
        email, password, email_confirm: true,
        user_metadata: user_metadata || {},
        app_metadata: app_metadata || {},
      }),
    });
    const data = safeJson(await res.text());
    if (!res.ok) throw new Error(`Buat user ${email} gagal: ${data?.msg || data?.message || res.status}`);
    if (!data || !data.id) throw new Error(`Buat user ${email} tidak mengembalikan id. Respons: ${JSON.stringify(data)}`);
    return data;
  }

  async adminListUsers() {
    const res = await fetch(`${this.url}/auth/v1/admin/users?per_page=1000`, {
      headers: this.#headers(this.serviceRoleKey),
    });
    const data = safeJson(await res.text());
    if (!res.ok) throw new Error('Daftar user gagal: ' + JSON.stringify(data));
    return data?.users || [];
  }

  async adminPatchUser(id, patch) {
    // WAJIB PUT, bukan PATCH. Endpoint pembaruan user di GoTrue terdaftar
    // sebagai PUT /admin/users/{id}. Kalau dipakai PATCH, jawabannya
    // 405 Method Not Allowed.
    const res = await fetch(`${this.url}/auth/v1/admin/users/${id}`, {
      method: 'PUT',
      headers: this.#headers(this.serviceRoleKey),
      body: JSON.stringify(patch),
    });
    const text = await res.text();
    if (!res.ok) {
      const d = safeJson(text);
      throw new Error(`Update user ${id} gagal: ${d?.msg || d?.message || res.status} ${text.slice(0, 200)}`);
    }
    return safeJson(text) || { id, ok: true };
  }
}

// ---------------------------------------------------------------------------
//  Parser nilai sel
// ---------------------------------------------------------------------------

/** Ambil URL dari formula =HYPERLINK("url";"label"). Cermin extractUrl_ di Code.gs:1990 */
export function extractUrl(formula, displayValue = '') {
  if (typeof formula === 'string') {
    const m = formula.match(/HYPERLINK\("([^"]+)"/i);
    if (m) return m[1];
    const any = formula.match(/https?:\/\/[^",\s)]+/);
    if (any) return any[0];
  }
  const fromText = String(displayValue || '').match(/https?:\/\/\S+/);
  return fromText ? fromText[0] : '';
}

/** Ambil ID file Google Drive dari URL. Cermin extractFileId_ di Code.gs:1991 */
export function extractFileId(url) {
  if (!url) return '';
  const d = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (d) return d[1];
  const q = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (q) return q[1];
  return '';
}

/**
 * 'DD/MM/YYYY' -> 'YYYY-MM-DD'. Mengembalikan '' kalau tidak dikenali.
 *
 * PERHATIKAN URUTAN: pola tangkapannya adalah (hari, bulan, tahun), jadi
 * m[1]=hari, m[2]=bulan, m[3]=tahun. Hasil harus tahun-BULAN-HARI. Salah
 * membalik m[1] dan m[2] akan menggeser 9 Agustus menjadi 8 September -
 * dan tidak ada error, hanya angka yang salah.
 */
export function parseDdMmYyyy(text) {
  const m = String(text || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  const tahun = m[3];
  const bulan = pad2(+m[2]);
  const hari = pad2(+m[1]);
  // Tolak tanggal yang tidak mungkin (mis. 31/02) daripada mengirimnya ke
  // PostgreSQL dan menggagalkan seluruh batch.
  const probe = new Date(Date.UTC(+tahun, +bulan - 1, +hari));
  if (probe.getUTCMonth() !== +bulan - 1 || probe.getUTCDate() !== +hari) return '';
  return `${tahun}-${bulan}-${hari}`;
}

/**
 * 'DD/MM/YYYY HH:mm' (waktu lokal spreadsheet) -> ISO 8601 dengan offset.
 *
 * Sheets menyimpan tanggal sebagai teks, jadi jamnya sudah "waktu lokal"
 * tanpa informasi zona. Kita perlakukan sebagai waktu sheet, lalu tulis
 * sebagai ISO bers[offset] supaya nilainya tidak berubah waktu diubah atau
 * dibuka di komputer lain.
 */
export function parseDdMmYyyyTime(text, timeZone = 'Asia/Jakarta') {
  const m = String(text || '').trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return '';
  const y = +m[3], mo = +m[2] - 1, d = +m[1];
  const hh = m[4] ? +m[4] : 0, mi = m[5] ? +m[5] : 0;

  // Anggap dulu dinding waktunya adalah UTC, lalu cari offset yang membuat
  // jam dindingnya kembali sama. Dua putaran sudah cukup untuk hampir semua
  // zona waktu.
  const asUtc = Date.UTC(y, mo, d, hh, mi, 0);
  let off = offsetMinutes(new Date(asUtc), timeZone);
  let corrected = new Date(asUtc - off * 60000);
  off = offsetMinutes(corrected, timeZone);
  corrected = new Date(asUtc - off * 60000);
  return isoFrom(corrected, timeZone);
}

function isoFrom(date, timeZone) {
  const p = partsIn(date, timeZone);
  const off = offsetMinutes(date, timeZone);
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  // Jam wajib dua digit. Beberapa versi ICU mengembalikan '8' (bukan '08')
  // dan midnight bisa muncul sebagai '24' - karena itu modulo 24 DAN pad2.
  const jam = pad2(+p.hour % 24);
  return `${p.year}-${p.month}-${p.day}T${jam}:${pad2(+p.minute)}:${p.second}`
       + `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/**
 * CATATAN: fungsi neutralizeFormula_ yang ada di Code.gs TIDAK dipakai di sini.
 *
 * Fungsi itu ada untuk mencegah formula injection, yaitu saat sel diawali
 * `=` maka Excel/Sheets menganggapnya rumus. PostgreSQL tidak punya
 * perilaku tersebut - nilai `=A1` yang masuk ke kolom text akan tersimpan
 * apa adanya. Jadi tidak ada yang perlu dibersihkan.
 *
 * Yang tetap perlu: Sanitasi HTML. Isi kolom Isi / Ringkasan / Deskripsi
 * sudah disanitasi sejak dulu oleh sanitizeHtml_ di sisi server Code.gs
 * (Code.gs:2022), jadi isinya aman untuk ditaruh apa adanya.
 */

export function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

/** Password acak yang cukup kuat untuk 15 akun admin. */
export function randomPassword(len = 16) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digit = '23456789';
  const all = upper + lower + digit;
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [pick(upper), pick(lower), pick(digit), pick(digit)];
  while (chars.length < len) chars.push(pick(all));
  // Acak urutan supaya posisi karakter wajib tidak selalu di depan.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
