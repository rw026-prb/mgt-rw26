// ============================================================================
//  split-codegs.mjs  —  Membelah Code.gs menjadi blok-blok yang bisa dipotong
// ============================================================================
//  Code.gs punya 174 fungsi dengan format tidak seragam (ada yang satu baris,
//  ada yang banyak baris). Menghapus blok satu per satu secara manual rawan
//  salah pasang kurung.
//
//  Batas tiap fungsi dibaca dari AST, bukan dari menghitung kurung. Menghitung
//  kurung secara manual MUSTAHIL untuk file ini karena ada tanda kutip di dalam
//  regex literal, misalnya .replace(/"/g,'""') - keduanya akan salah baca
//  sebagai pembuka string dan menggeser seluruh hitungan.
//
//  Perintah:
//    node split-codegs.mjs            -> hanya laporan, tidak mengubah file
//    node split-codegs.mjs --apply    -> menulis Code.gs.baru
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

// Path relatif ke file ini, bukan hard-coded. Supaya jalan di mana saja.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(REPO, 'Code.gs');
const OUT = path.join(REPO, 'Code.gs.baru');
const APPLY = process.argv.includes('--apply');

const src = fs.readFileSync(SRC, 'utf8');
const lines = src.split(/\r?\n/);

// Offset -> nomor baris (1-based)
const lineStarts = [0];
for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1);
const lineOf = (offset) => {
  let lo = 0, hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return lo;   // 0-based
};

let ast;
try {
  ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script', allowReturnOutsideFunction: true });
} catch (e) {
  console.error('GAGAL mem-parse Code.gs: ' + e.message);
  process.exit(1);
}

const blocks = [];
for (const node of ast.body) {
  if (node.type === 'FunctionDeclaration' && node.id) {
    blocks.push({
      name: node.id.name,
      startLine: lineOf(node.start),
      endLine: lineOf(node.end),
      params: node.params.length,
    });
  }
}
blocks.sort((a, b) => a.startLine - b.startLine);
const padaNama = new Map(blocks.map((b) => [b.name, b]));

// ---------------------------------------------------------------------------
//  Blok yang dibuang: seluruh data & auth pindah ke Supabase
// ---------------------------------------------------------------------------
const BUANG = [
  // --- auth & sesi (Supabase Auth menggantikannya) ---
  'login_', 'logout_', 'requireSession_', 'requireAdmin_', 'requireSuperAdmin_',
  'hasMenuAccess_', 'requireMenuAccess_', 'indexSession_', 'unindexSession_',
  'invalidateUserSessions_', 'hashPassword_', 'verifyPassword_', 'pbkdf2Hash_',
  'sha256Hex_', 'requestPasswordReset_', 'validateResetToken_', 'resetPassword_',

  // --- himbauan ---
  'getHimbauanRows_', 'findHimbauanRow_', 'himbauanRowToObject_',
  'getHimbauanSheet_', 'createHimbauan_', 'toggleHimbauan_', 'deleteHimbauan_',
  'setupHimbauanSheet',

  // --- pengumuman (sheet informasi) ---
  'getInfoSheet_', 'announcementRowToObject_',
  'createAnnouncement_', 'updateAnnouncement_', 'toggleAnnouncement_', 'deleteAnnouncement_',

  // --- berita: TETAP. (tidak ada di daftar buang) ---

  // --- fasilitas ---
  'getFacilitySheet_', 'facilityRowToObject_',
  'createFacility_', 'updateFacility_', 'deleteFacility_',

  // --- organisasi ---
  'getOrgSheet_', 'validateOrgGroup_', 'orgRowToObject_',
  'createOrgMember_', 'updateOrgMember_', 'deleteOrgMember_',

  // --- statistik ---
  'getStatistikSheet_', 'getStatistikRows_', 'statistikRowToObject_',
  'createStatistik_', 'updateStatistik_', 'deleteStatistik_',

  // --- kas (seluruhnya) ---
  'getKasSheet_', 'getKasRows_', 'kasRowToObject_', 'kasTimestamp_',
  'createKas_', 'updateKas_', 'deleteKas_', 'updateKasBalances_',
  'approveKas_', 'rejectKas_', 'listKas_', 'refreshKas_',
  'getKasDashboard_', 'kasDashboardData_', 'getKasReport_', 'getKasCashFlow_',
  'kasReportData_', 'kasCashFlowData_', 'clampMonth_', 'clampYear_',
  'publicKasReport_', 'publicKasCashFlow_',

  // --- daftar (listing) milik modul yang sudah pindah ---
  // Fungsi-fungsi ini hanya membungkus pemanggilan sheet, jadi tidak ada
  // gunanya lagi. Data mereka sudah dibaca lewat PostgREST.
  'listHimbauan_', 'listAnnouncements_', 'listFacilities_',
  'listOrganization_', 'listStatistik_',

  // --- pengguna (sheet user) ---
  'getSheet_', 'getRows_', 'getUserRows_', 'rowToUser_', 'findUserRow_',
  'nextUserId_', 'listUsers_', 'createUser_', 'updateUser_', 'toggleUser_',
  'deleteUser_', 'updateMyProfile_', 'setupSheet',

  // --- pengunjung & aktivitas ---
  'getVisitorSheet_', 'getVisitorRows_', 'logVisitor_', 'getVisitorStats_',
  'getVisitorLogs_', 'getActivityLogSheet_', 'logActivity_', 'listActivity_',
  'publicContentData_', 'emptyPublicContent_', 'dashboardData_',
  'setupPortalSheets', 'setupAllSheets',
];

const buangSet = new Set(BUANG);
const hilang = BUANG.filter((n) => !padaNama.has(n));
const ada = BUANG.filter((n) => padaNama.has(n));

console.log('='.repeat(64));
console.log('LAPORAN PEMBELAHAN Code.gs');
console.log('='.repeat(64));
console.log(`Total baris          : ${lines.length}`);
console.log(`Fungsi tingkat atas  : ${blocks.length}`);
console.log(`Akan dibuang          : ${ada.length}`);
console.log(`Tetap dipertahankan  : ${blocks.length - ada.length}`);
console.log(`Baris dibuang        : ${ada.reduce((s, b) => s + (padaNama.get(b).endLine - padaNama.get(b).startLine + 1), 0)}`);

if (hilang.length) {
  console.log(`\nNama di daftar buang tapi TIDAK ADA di file (boleh, tidak error):`);
  for (const n of hilang) console.log('  - ' + n);
}

// Daftar fungsi yang bertahan setelah pemotongan.
const tetap = new Set(blocks.filter((b) => !buangSet.has(b.name)).map((b) => b.name));
console.log(`\nFungsi yang dipertahankan (${tetap.size}):`);
console.log('  ' + [...tetap].join(', '));

if (!APPLY) {
  console.log('\nMode laporan. Tambahkan --apply untuk menulis Code.gs.baru');
  process.exit(0);
}

// ---------------------------------------------------------------------------
//  Tulis hasil
// ---------------------------------------------------------------------------
const buangIdx = new Set();
for (const n of ada) {
  const b = padaNama.get(n);
  for (let i = b.startLine; i <= b.endLine; i++) buangIdx.add(i);
}

const keluar = [];
for (let i = 0; i < lines.length; i++) if (!buangIdx.has(i)) keluar.push(lines[i]);
const teks = keluar.join('\n').replace(/\n{3,}/g, '\n\n');

fs.writeFileSync(OUT, teks, 'utf8');
console.log(`\nDitulis: Code.gs.baru  (${keluar.length} baris, dari ${lines.length})`);

// ---------------------------------------------------------------------------
//  Uji hasil: file baru harus bisa di-parse, dan tidak boleh ada fungsi
//  yang hilang tapi masih dipanggil.
// ---------------------------------------------------------------------------
let astBaru = null;
try {
  astBaru = acorn.parse(teks, { ecmaVersion: 2022, sourceType: 'script', allowReturnOutsideFunction: true });
  console.log('Sintaks Code.gs.baru  : OK');
} catch (e) {
  console.log('Sintaks Code.gs.baru  : GAGAL - ' + e.message);
}

if (astBaru) {
  const namaBaru = new Set(astBaru.body.filter((n) => n.type === 'FunctionDeclaration').map((n) => n.id.name));
  const dipanggil = new Set();
  JSON.stringify(astBaru, (k, v) => {
    if (v && v.type === 'CallExpression' && v.callee && v.callee.type === 'Identifier') dipanggil.add(v.callee.name);
    return v;
  });
  const hilangDipanggil = [...dipanggil].filter((n) => !namaBaru.has(n) && !/^(json|Object|Array|String|Number|Math|Date|Error|RegExp|JSON|Promise|parseInt|parseFloat|isNaN|encodeURIComponent|decodeURIComponent|Utilities|SpreadsheetApp|DriveApp|CacheService|LockService|Session|PropertiesService|ContentService|MailApp|GmailApp|ScriptApp|UrlFetchApp|console|require|setTimeout|clearTimeout|fetch|Text|Blob|URL|Intl|structuredClone|Symbol|globalThis|BigInt|WeakMap|WeakSet|Map|Set)$/.test(n));
  if (hilangDipanggil.length) {
    console.log('\nPERINGATAN - fungsi ini dipanggil tapi tidak ada lagi di file:');
    for (const n of hilangDipanggil) console.log('  - ' + n);
  } else {
    console.log('Tidak ada pemanggilan fungsi yang menggantung.');
  }
}
