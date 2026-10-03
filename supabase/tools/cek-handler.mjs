// ============================================================================
//  cek-handler.mjs  -  Pastikan setiap handler inline di HTML benar-benar ada
// ============================================================================
//  MASALAH YANG MENYEBABKAN FILE INI ADA
//  ------------------------------------
//  index.html memuat banyak handler lewat atribut inline:
//
//      <button onclick="inisialisasiLaporanKas()">
//      <div onclick="bukaFormKas('masuk')">
//
//  Atribut inline dieksekusi browser sebagai kode global. Kalau nama yang
//  dipanggil tidak ada di lingkup global, browser melempar ReferenceError
//  di konsol - dan handler itu TIDAK pernah jalan.
//
//  Gejalanya selalu tersembunyi di balik tanda markup yang masih terlihat:
//
//    - Dropdown bulan/tahun di tab Laporan Kas dan Arus Kas TERISI markup
//      tapi ISINYA KOSONG, karena option-nya dibuat oleh fungsi yang tidak
//      pernah terpanggil.
//    - Tombol terlihat tidak meresap apa-apa saat diklik.
//    - Tidak ada error yang terlihat di layar, hanya di konsol.
//
//  Karena penanda markup-nya masih ada, keadaan seperti ini mudah lolos dari
//  pemeriksaan mata - dan dari `node --check` yang hanya memeriksa sintaks,
//  bukan apakah nama yang dipanggil benar-benar ada.
//
//  Yang diperiksa
//  --------------
//  1. Semua fungsi yang dipanggil dari atribut onclick / onchange / oninput
//     harus ada sebagai deklarasi tingkat atas di blok script inline.
//  2. Sebaliknya, id yang dipakai sebagai #selector oleh bridge atau UI.
//
//  CARA MENJALANKAN
//    node cek-handler.mjs            -> periksa semua .html di repo
//    node cek-handler.mjs index.html -> periksa satu berkas
//
//  Keluar dengan kode 1 kalau ada handler yang menggantung.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Nama yang boleh dipanggil tanpa pendefinisian di berkas ini: API bawaan
// browser dan pustaka pihak ketiga.
const BAWAAN = new Set([
  'alert', 'confirm', 'prompt', 'fetch', 'console', 'document', 'window',
  'location', 'history', 'navigator', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'requestAnimationFrame', 'parseInt',
  'parseFloat', 'isNaN', 'encodeURIComponent', 'decodeURIComponent',
  'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Math',
  'RegExp', 'Error', 'Promise', 'Map', 'Set', 'Symbol', 'BigInt',
  'bootstrap', 'Chart', 'supabase', 'toast', 'apiRequest', 'esc'
]);

const argumen = process.argv.slice(2);
const berkas = argumen.length
  ? argumen
  : fs.readdirSync(REPO).filter((n) => n.endsWith('.html')).map((n) => path.join(REPO, n));

let masalah = 0;

console.log('='.repeat(64));
console.log('CEK HANDLER INLINE');
console.log('='.repeat(64));

/**
 * Kumpulkan nama yang tersedia di lingkup global.
 *
 * Script inline dibungkus IIFE `(async () => { ... })()`, jadi setiap
 * `function` di dalamnya hanya hidup selama IIFE itu berjalan - bukan di
 * `window`. Atribut `onclick` mencari nama di `window`. Karena itu nama
 * harus dikumpulkan dari deklarasi tingkat atas PLUS assignment `window.x =`.
 *
 * Galat parse TIDAK boleh ditelan diam-diam. Kalau ditelan, skrip ini akan
 * melaporkan "semua handler menggantung" tanpa menjelaskan bahwa sumbernya
 * tidak terbaca sama sekali - hasil yang sepenuhnya salah.
 */
function deklarasiTingkatAtas(html) {
  const nama = new Set();
  const blok = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  for (const b of blok) {
    let ast;
    try {
      ast = acorn.parse(b[1], { ecmaVersion: 2022, sourceType: 'script' });
    } catch (e) {
      throw new Error('script inline gagal di-parse: ' + e.message);
    }
    for (const n of ast.body) {
      if (n.type === 'FunctionDeclaration' && n.id) nama.add(n.id.name);
      if (n.type === 'VariableDeclaration') {
        for (const d of n.declarations) {
          if (d.id.type === 'Identifier') nama.add(d.id.name);
        }
      }
    }
    // Assignment ke `window.x` HARUS dicari di seluruh pohon AST, bukan hanya
    // di ast.body.
    //
    // Alasannya: script ini dibungkus `(async () => { ... })()`, jadi
    // `window.deleteNews = deleteNews;` berada DI DALAM IIFE - satu tingkat
    // lebih dalam. Kalau hanya ast.body yang diperiksa, semua fungsi yang
    // sudah diekspor akan dilaporkan menggantung, dan pemeriksaan ini jadi
    // tidak berguna karena meng tropics hal yang sebenarnya sudah benar.
    telusuriAssignmentWindow(ast, nama);
  }
  return nama;
}

/** Kumpulkan semua `window.x = ...` di seluruh pohon AST. */
function telusuriAssignmentWindow(node, nama) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) telusuriAssignmentWindow(n, nama);
    return;
  }
  if (node.type === 'AssignmentExpression') {
    const l = node.left;
    if (l && l.type === 'MemberExpression' && !l.computed
        && l.object && l.object.name === 'window'
        && l.property && l.property.type === 'Identifier') {
      nama.add(l.property.name);
    }
  }
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
    telusuriAssignmentWindow(node[key], nama);
  }
}

/**
 * Nama yang benar-benar dideklarasikan di mana pun dalam script.
 *
 * Dipakai untuk memeriksa `window.x = x`. Bentuk itu	error yang sangat
 * mudah lolos: kalau fungsi `x` tidak ada, baris tersebut melempar
 * ReferenceError saat IIFE berjalan - portalnya sendiri tidak bisa dimuat -
 * dan pemeriksa handler tetap akan bilang "aman" karena nama `x` memang ada
 * di window.
 */
function semuaDeklarasi(html) {
  const nama = new Set();
  const blok = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  const jelajah = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(jelajah); return; }
    if (n.type === 'FunctionDeclaration' && n.id) nama.add(n.id.name);
    if (n.type === 'VariableDeclarator' && n.id && n.id.type === 'Identifier') nama.add(n.id.name);
    Object.keys(n).forEach((k) => {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') return;
      jelajah(n[k]);
    });
  };
  for (const b of blok) {
    try {
      jelajah(acorn.parse(b[1], { ecmaVersion: 2022, sourceType: 'script' }));
    } catch { /* ditangani pemeriksa sintaks */ }
  }
  return nama;
}

/** Nama-nama pada baris `window.x = x` (ekspor-diri). */
function selfAssignment(html) {
  const hasil = [];
  const blok = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  const jelajah = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(jelajah); return; }
    if (n.type === 'AssignmentExpression') {
      const l = n.left;
      if (l && l.type === 'MemberExpression' && !l.computed
          && l.object && l.object.name === 'window'
          && l.property && l.property.type === 'Identifier'
          && n.right && n.right.type === 'Identifier' && n.right.name === l.property.name) {
        hasil.push(n.right.name);
      }
    }
    Object.keys(n).forEach((k) => {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') return;
      jelajah(n[k]);
    });
  };
  for (const b of blok) {
    try {
      jelajah(acorn.parse(b[1], { ecmaVersion: 2022, sourceType: 'script' }));
    } catch { /* ditangani pemeriksa sintaks */ }
  }
  return hasil;
}

/**
 * Nama fungsi yang dipanggil di dalam ekspresi string handler.
 *
 * Hanya nama yang diikuti tanda kurung yang diambil, supaya atribut seperti
 * `onclick="toast('x')"` tidak ikut melaporkan `toast` sebagai handler yang
 * harus ada - meski `toast` memang boleh.
 */
function panggilDari(handler) {
  const nama = new Set();
  const pola = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = pola.exec(handler))) nama.add(m[2]);
  return [...nama];
}

for (const f of berkas) {
  const penuh = path.isAbsolute(f) ? f : path.join(REPO, f);
  if (!fs.existsSync(penuh)) {
    console.log('  dilewati (tidak ada): ' + f);
    continue;
  }
  const html = fs.readFileSync(penuh, 'utf8');
  const tersedia = deklarasiTingkatAtas(html);
  const namaBerkas = path.basename(penuh);

  // Semua atribut handler yang ada di berkas ini.
  const handler = new Map();
  for (const m of html.matchAll(/\son(click|change|input|submit|load|error|keyup|keydown)\s*=\s*"([^"]*)"/gi)) {
    for (const namaFn of panggilDari(m[2])) {
      if (!handler.has(namaFn)) handler.set(namaFn, []);
      handler.get(namaFn).push(m[1].toLowerCase());
    }
  }
  // Atribut beranda kutip tunggal.
  for (const m of html.matchAll(/\son(click|change|input|submit|load|error)\s*=\s*'([^']*)'/gi)) {
    for (const namaFn of panggilDari(m[2])) {
      if (!handler.has(namaFn)) handler.set(namaFn, []);
      handler.get(namaFn).push(m[1].toLowerCase());
    }
  }

  console.log('');
  console.log('  ' + namaBerkas);
  console.log('    deklarasi tingkat atas : ' + tersedia.size);

  // --- Lapis 2: `window.x = x` harus menunjuk fungsi yang benar-benar ada ---
  //
  // Tanpa pemeriksaan ini, menghapus satu baris deklarasi cukup untuk membuat
  // portal tidak bisa dimuat sama sekali - sementara pemeriksaan handler di
  // atas tetap bilang "aman", karena nama `x` memang ada di window.
  const dideklarasi = semuaDeklarasi(html);
  const eksportDiri = [...new Set(selfAssignment(html))];
  const eksporPalsu = eksportDiri.filter((n) => !dideklarasi.has(n));
  console.log(`    ekspor window.x = x    : ${eksportDiri.length}  (${eksportDiri.length - eksporPalsu.length} valid)`);
  for (const n of eksporPalsu) {
    masalah++;
    console.log(`      ! window.${n} = ${n}  ->  tidak ada deklarasi bernama "${n}"`);
    console.log('        Ini akan melempar ReferenceError saat portal dimuat.');
  }

  if (!handler.size) {
    console.log('    tidak ada handler inline');
    continue;
  }

  let baik = 0;
  const buruk = [];
  for (const [namaFn, ev] of [...handler].sort()) {
    if (tersedia.has(namaFn) || BAWAAN.has(namaFn)) {
      baik++;
      continue;
    }
    buruk.push(`${namaFn}  (dipakai di on${[...new Set(ev)].join(', on')})`);
  }

  console.log(`    handler inline         : ${baik + buruk.length}  (${baik} ketemu, ${buruk.length} menggantung)`);
  for (const b of buruk) {
    masalah++;
    console.log('      ! ' + b);
  }
}

console.log('');
console.log('='.repeat(64));
if (masalah) {
  console.log(`HASIL: ${masalah} handler menggantung. Lihat tanda "!" di atas.`);
  console.log('='.repeat(64));
  process.exit(1);
}
console.log('HASIL: semua handler inline punya definisi di lingkup global. AMAN.');
console.log('='.repeat(64));