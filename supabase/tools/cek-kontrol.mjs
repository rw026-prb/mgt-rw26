// ============================================================================
//  cek-kontrol.mjs  -  Cari karakter kontrol tersembunyi di berkas teks
// ============================================================================
//  MASALAH YANG MENYEBABKAN FILE INI ADA
//  ------------------------------------
//  Saat menyunting teks, karakter kontrol bisa ikut terbawa ke dalam kata.
//  Contoh nyata di repo ini, di assets/js/rw26-api.js:
//
//      // news tetap dari Apps Script (tab <BS>erita), sisanya dari Supabase.
//
//  Huruf 'b' pada "berita" tergantikan oleh U+0008 BACKSPACE. Teksnya masih
//  terbaca seperti "berita" di editor mana pun - backing saja satu karakter
//  hilang, dan mengedit baris itu di kemudian hari bisa membuat huruf yang
//  sebenarnya salah ketik tersembunyi di dalam kata.
//
//  Yang dipindai dan yang tidak
//  ---------------------------
//  Dipindai: U+0000-U+0008, U+000B, U+000C, U+000E-U+001F, dan U+007F
//            (DEL). Semua itu tidak punya teks yang bisa ditampilkan.
//  Tidak dipindai: TAB (U+0009), LF (U+000A), dan CR (U+000D). Tiga ini
//            normal di berkas teks - CR+LF dipakai di seluruh repo ini
//            karena berkasnya dibuat di Windows.
//
//  CARA MENJALANKAN
//    node cek-kontrol.mjs             -> periksa seluruh repo
//    node cek-kontrol.mjs assets/js   -> periksa satu folder atau berkas
//
//  Keluar dengan kode 1 kalau ada karakter kontrol ditemukan.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const LewatiFolder = new Set(['node_modules', '.git', 'pgdata', 'pgdata-pwq', 'out']);

const EkstensiBiner = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp',
  '.pdf', '.zip', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.webm'
]);

// TAB, LF, dan CR dikecualikan - semuanya normal di berkas teks.
const polaKontrol = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

const heksa = (cp) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');

const temuan = [];

function periksa(target) {
  const stat = fs.statSync(target);
  if (stat.size > 4_000_000) return;
  const teks = fs.readFileSync(target, 'utf8');
  polaKontrol.lastIndex = 0;
  let m;
  while ((m = polaKontrol.exec(teks))) {
    const cp = teks.codePointAt(m.index);
    temuan.push({
      label: path.relative(REPO, target) || target,
      baris: teks.slice(0, m.index).split('\n').length,
      cp,
      konteks: teks.slice(Math.max(0, m.index - 34), m.index + 34)
    });
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
      if (LewatiFolder.has(isi.name)) continue;
      telusuri(path.join(target, isi.name));
    }
    return;
  }
  if (EkstensiBiner.has(path.extname(target).toLowerCase())) return;
  periksa(target);
}

console.log('='.repeat(64));
console.log('CEK KARAKTER KONTROL');
console.log('='.repeat(64));
console.log('  searching : TAB, LF, dan CR dikecualikan (normal di berkas teks)');

const argumen = process.argv.slice(2);
if (argumen.length) {
  for (const a of argumen) telusuri(path.isAbsolute(a) ? a : path.join(REPO, a));
} else {
  telusuri(REPO);
}

if (!temuan.length) {
  console.log('\nHASIL: bersih, tidak ada karakter kontrol tersembunyi');
  process.exit(0);
}

console.log('');
for (const t of temuan) {
  console.log(`  ${t.label}:${t.baris}  ${heksa(t.cp)}`);
  console.log(`      ${JSON.stringify(t.konteks)}`);
}
console.log('');
console.log(`HASIL: ${temuan.length} karakter kontrol di ${new Set(temuan.map((t) => t.label)).size} berkas`);
process.exit(1);