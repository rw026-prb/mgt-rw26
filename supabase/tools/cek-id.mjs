// ============================================================================
//  cek-id.mjs  -  Pastikan setiap id yang dipanggil JS benar-benar ada di markup
// ============================================================================
//  MASALAH YANG MENYEBABKAN FILE INI ADA
//  ------------------------------------
//  Kode UI mengambil elemen dengan `document.getElementById('nama')` atau
//  `querySelector('#nama')`. Kalau id di markup salah ketik - atau elemennya
//  dihapus saat refactor - pemanggilan itu mengembalikan null, bukan error.
//
//  Akibatnya kalimatnya biasanya `null.textContent = ...`, dan itu melempar
//  TypeError di tengah-tengah fungsi. Kalau yang gagal adalah initializer,
//  seluruh tab itu mati: dropdown tidak pernah terisi, tombol tidak meresap.
//  Kalau yang gagal adalah penggambar tabel, area itu cuma diam saja.
//
// Dua sebab yang sering muncul di repo ini:
//    - salah ketik pada id (bukan pada nama fungsinya), dan
//    - id yang dihapus dari markup tapi masih dirujuk di skrip.
//
//  Yang diperiksa
//  --------------
//  1. Semua id yang di-string-kan di getElementById / querySelector /
//     closest('#x') harus ada di markup berkas yang sama.
//  2. Sebaliknya: id yang tidak pernah dirujuk pun tidak dilaporkan - id
//     boleh dipakai untuk CSS, dan `querySelector` bisa mengambil id yang
//     hanya ada di template string.
//
//  CARA MENJALANKAN
//    node cek-id.mjs             -> periksa semua .html di repo
//    node cek-id.mjs index.html  -> periksa satu berkas
//
//  Keluar dengan kode 1 kalau ada referensi yang menggantung.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const argumen = process.argv.slice(2);
const berkas = argumen.length
  ? argumen
  : fs.readdirSync(REPO).filter((n) => n.endsWith('.html')).map((n) => path.join(REPO, n));

let masalah = 0;

console.log('='.repeat(64));
console.log('CEK REFERENSI ID');
console.log('='.repeat(64));

for (const f of berkas) {
  const penuh = path.isAbsolute(f) ? f : path.join(REPO, f);
  if (!fs.existsSync(penuh)) {
    console.log('  dilewati (tidak ada): ' + f);
    continue;
  }
  const html = fs.readFileSync(penuh, 'utf8');
  const namaBerkas = path.basename(penuh);

  // Id yang benar-benar ada di markup.
  const ada = new Set();
  for (const m of html.matchAll(/\bid\s*=\s*"([^"]+)"/g)) ada.add(m[1]);
  for (const m of html.matchAll(/\bid\s*=\s*'([^']+)'/g)) ada.add(m[1]);

  // Id yang dirujuk di skrip inline.
  const dirujuk = new Map();
  const catat = (id, cara) => {
    if (!id || /[+(){}[\]$?:|&<>=!]/.test(id)) return;
    if (!dirujuk.has(id)) dirujuk.set(id, cara);
  };

  // PENTING: pola di bawah mensyaratkan tanda kurung penutup HANYA SESUDAH
  // kutip penutup - yaitu `getElementById('x')`, bukan
  // `getElementById('x' + (i+1))`.
  //
  // Kalau hanya kutip penutup yang dijadikan penanda, konkatenasi akan
  // tercatat sebagai id `x` padahal id yang sebenarnya `x1`, `x2`, dan
  // pelanggannya dilaporkan menggantung padahal semuanya ada di markup.
  // Itu yang terjadi pada statDynLabel1/statDynLabel2 di index.html - tiga
  // laporan palsu yang membuat pemeriksa ini tidak dipercaya.
  for (const m of html.matchAll(/getElementById\(\s*'([^']*)'\s*\)/g)) catat(m[1], 'getElementById');
  for (const m of html.matchAll(/getElementById\(\s*"([^"]*)"\s*\)/g)) catat(m[1], 'getElementById');
  for (const m of html.matchAll(/getElementById\(\s*`([^`$]*)`\s*\)/g)) catat(m[1], 'getElementById');
  for (const m of html.matchAll(/closest\(\s*['"]#([A-Za-z0-9_-]+)['"]/g)) catat(m[1], 'closest');
  for (const m of html.matchAll(/querySelector(?:All)?\(\s*['"]#([A-Za-z0-9_-]+)['"]/g)) catat(m[1], 'querySelector');

  console.log('');
  console.log('  ' + namaBerkas);
  console.log(`    id di markup           : ${ada.size}`);
  console.log(`    id dirujuk di skrip   : ${dirujuk.size}`);

  if (!dirujuk.size) {
    console.log('    tidak ada referensi id');
    continue;
  }

  // Id yang dirujuk tapi dibangun sebagian dari template string (misal
  // 'kasBodyMasuk' yang ikut muncul dari string lain) tetap dihitung sebagai
  // dirujuk; yang dilaporkan hanya yang benar-benar tidak ada di markup.
  const hilang = [...dirujuk].filter(([id]) => !ada.has(id)).sort();
  const dipakai = [...dirujuk].filter(([id]) => ada.has(id)).length;

  console.log(`    ketemu                : ${dipakai}   menggantung: ${hilang.length}`);
  for (const [id, cara] of hilang) {
    masalah++;
    console.log(`      ! #${id}  (dipakai lewat ${cara})`);
  }
}

console.log('');
console.log('='.repeat(64));
if (masalah) {
  console.log(`HASIL: ${masalah} referensi id menggantung. Lihat tanda "!" di atas.`);
  console.log('='.repeat(64));
  process.exit(1);
}
console.log('HASIL: semua id yang dirujuk ada di markup. AMAN.');
console.log('='.repeat(64));