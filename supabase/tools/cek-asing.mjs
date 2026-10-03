// ============================================================================
//  cek-asing.mjs  -  Cari karakter dari aksara lain yang menyusup ke teks
// ============================================================================
//  MASALAH YANG MENYEBABKAN FILE INI ADA
//  ------------------------------------
//  Komentar dan pesan di repo ini ditulis dalam Bahasa Indonesia. Sewaktu
//  menyunting berkas, karakter dari aksara lain kadang ikut terbawa ke dalam
//  kata Indonesia.
//
//  Contoh nyata yang pernah muncul di repo ini, ditulis di sini sebagai titik
//  kode supaya file pemeriksa ini sendiri tidak ikut memuat karakter yang
//  sedang dicari:
//
//    "yang dibandingkan hanya hash-nya"   ada U+628A U+5B83 U+4EEC di tengahnya
//    "& 0xff... naikkan"                 ada U+628A U+5B83 U+4EEC di komentar
//    "portal tetap berfungsi ..."        ada U+0445 U+043E U+0442 U+044F
//
//  Ketiganya berasal dari aksara Han (Mandarin) dan Cyrillic (Rusia). Teksnya
//  terlihat benar saat review diff kalau tidak diperhatiin, dan orang yang
//  tidak bisa membaca aksara itu akan mengira teks tersebut berbahasa Mandarin
//  atau Rusia - bukan Bahasa Indonesia.
//
//  ATURAN
//  ------
//  Karakter yang diizinkan:
//    - ASCII (U+0000 - U+007F)
//    - Latin-1 umum: huruf beraksen, derajat, kali, titik tengah
//    - Tanda baca yang lazim dipakai: en dash, em dash, kutip miring,
//      elipsis, panah, dan tanda matematika umum
//
//  Everything else dilaporkan sebagai "asing".
//
//  Pengecualian per nama berkas bisa ditambahkan lewat berkas
//  .asing-allowlist di root repo (satu nama per baris, diawali # untuk
//  komentar). Pengecualian per karakter lewat .asing-allowlist juga bisa -
//  baris yang diawali "U+" dibaca sebagai satu titik kode yang diizinkan.
//
//  CARA MENJALANKAN
//    node cek-asing.mjs                    -> periksa seluruh repo
//    node cek-asing.mjs Code.gs login.html -> periksa berkas tertentu
//
//  Keluar dengan kode 1 kalau ada karakter asing ditemukan.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Folder yang isinya bukan milik kita atau sengaja tidak dipindai.
const LewatiFolder = new Set(['node_modules', '.git', 'pgdata', 'pgdata-pwq', 'out']);

// Berkas biner. Isinya bukan teks, jadi tidak mungkin punya "karakter asing".
const EkstensiBiner = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp',
  '.pdf', '.zip', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.webm'
]);

// Titik kode di luar ASCII yang sah dipakai dalam teks repo ini.
const Diizinkan = new Set([
  // huruf Latin-1 beraksen, yang muncul di nama orang dan kata Portugis
  0x00c0, 0x00c1, 0x00c2, 0x00c3, 0x00c4, 0x00c5, 0x00c7, 0x00c8, 0x00c9, 0x00ca, 0x00cb,
  0x00cc, 0x00cd, 0x00ce, 0x00cf, 0x00d1, 0x00d2, 0x00d3, 0x00d4, 0x00d5, 0x00d6, 0x00d9,
  0x00da, 0x00db, 0x00dc, 0x00dd, 0x00df,
  0x00e0, 0x00e1, 0x00e2, 0x00e3, 0x00e4, 0x00e5, 0x00e6, 0x00e7, 0x00e8, 0x00e9, 0x00ea, 0x00eb,
  0x00ec, 0x00ed, 0x00ee, 0x00ef, 0x00f1, 0x00f2, 0x00f3, 0x00f4, 0x00f5, 0x00f6, 0x00f8, 0x00f9,
  0x00fa, 0x00fb, 0x00fc, 0x00fd, 0x00fe, 0x00ff,
  // huruf Latin tambahan
  0x0152, 0x0153, 0x0160, 0x0161, 0x0178, 0x017d, 0x017e,
  // simbol umum
  0x00a0, 0x00b0, 0x00b1, 0x00b7, 0x00d7, 0x00f7,
  // copyright, muncul di footer login.html dan update-password.html
  0x00a9,
  // simbol yang dipakai di README: gear, centang, silang
  0x2699, 0x2714, 0x2716, 0x2717,
  // BOM. Muncul di kode yang sengaja membuang BOM (lib.mjs:36) dan sebagai
//  byte awal beberapa berkas. Ini karakter teknis yang sah, bukan tanda
//  teks rusak, jadi dibiarkan.
  0xfeff,
  // tanda baca
  0x2013, 0x2014, 0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x2010, 0x2011,
  0x2020, 0x2021, 0x2022, 0x2026, 0x2030, 0x2039, 0x203a, 0x00bb, 0x00ab,
  // matematika, mata uang, tanda dagang
  0x20ac, 0x2122, 0x2190, 0x2192, 0x2191, 0x2193, 0x2260, 0x2264, 0x2265, 0x221e, 0x00d7
]);

// Kotak dan segitiga untuk menggambar garis pemisah di keluaran konsol.
// Sejumlah skrip pengujian memakai ini untuk membingkai bagian hasil.
// Mengizinkan rentang kotak saja jauh lebih sempit daripada mengizinkan
// seluruh blok "Miscellaneous Symbols", jadi karakter dari aksara lain tetap
// ketahuan.
for (let cp = 0x2500; cp <= 0x257f; cp++) Diizinkan.add(cp);
for (const cp of [0x25a0, 0x25b2, 0x25b6, 0x25bc, 0x25c0, 0x25cf]) Diizinkan.add(cp);

const argumen = process.argv.slice(2);

// Baca allowlist. Satu entri per baris. Awalan # = komentar. Bentuk "U+XXXX"
// berarti satu titik kode yang diizinkan; nama lain dibaca sebagai nama
// berkas atau folder yang dilewati.
const allowlistPath = path.join(REPO, '.asing-allowlist');
const barisAllowlist = fs.existsSync(allowlistPath)
  ? fs.readFileSync(allowlistPath, 'utf8').split(/\r?\n/)
  : [];
const Lewati = new Set();
for (const mentah of barisAllowlist) {
  const b = mentah.trim();
  if (!b || b.startsWith('#')) continue;
  const poin = b.match(/^U\+([0-9a-f]{4,6})$/i);
  if (poin) Diizinkan.add(parseInt(poin[1], 16));
  else Lewati.add(b);
}

const heksa = (cp) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');

const temuan = [];

function periksa(teks, label) {
  for (let i = 0; i < teks.length; i++) {
    const cp = teks.codePointAt(i);
    if (cp <= 0x7f || Diizinkan.has(cp)) continue;
    // Karakter di luar Basic Multilingual Plane memakai dua unit UTF-16,
    // jadi lompat satu lagi supaya tidak dilaporkan dua kali.
    const panjang = cp > 0xffff ? 2 : 1;
    const karakter = teks.slice(i, i + panjang);
    temuan.push({
      label,
      baris: teks.slice(0, i).split('\n').length,
      cp,
      karakter
    });
    i += panjang - 1;
  }
}

function telusuri(target) {
  if (!fs.existsSync(target)) {
    console.log('  dilewati (tidak ada): ' + path.relative(REPO, target));
    return;
  }
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const isi of fs.readdirSync(target, { withFileTypes: true })) {
      if (LewatiFolder.has(isi.name) || Lewati.has(isi.name)) continue;
      telusuri(path.join(target, isi.name));
    }
    return;
  }
  if (Lewati.has(path.basename(target))) return;
  if (EkstensiBiner.has(path.extname(target).toLowerCase())) return;
  if (stat.size > 2_000_000) return;
  periksa(fs.readFileSync(target, 'utf8'), path.relative(REPO, target) || target);
}

console.log('='.repeat(62));
console.log('CEK KARAKTER ASING');
console.log('='.repeat(62));
for (const b of barisAllowlist) {
  const s = b.trim();
  if (s && !s.startsWith('#')) console.log('  allowlist: ' + s);
}
console.log('  titik kode diizinkan tambahan: ' + (barisAllowlist.some((b) => /^U\+/i.test(b.trim())) ? 'ada' : 'tidak'));

if (argumen.length) {
  for (const a of argumen) telusuri(path.isAbsolute(a) ? a : path.join(REPO, a));
} else {
  telusuri(REPO);
}

if (!temuan.length) {
  console.log('\nHASIL: bersih, tidak ada karakter asing');
  process.exit(0);
}

// Kelompokkan per berkas supaya mudah dipindai.
const perBerkas = new Map();
for (const t of temuan) {
  if (!perBerkas.has(t.label)) perBerkas.set(t.label, []);
  perBerkas.get(t.label).push(t);
}
console.log('');
for (const [label, daftar] of perBerkas) {
  console.log('  ' + label);
  for (const t of daftar) {
    console.log(`    baris ${t.baris}  ${heksa(t.cp)}  ${JSON.stringify(t.karakter)}`);
  }
}
console.log('');
console.log(`HASIL: ${temuan.length} karakter asing di ${perBerkas.size} berkas`);
process.exit(1);