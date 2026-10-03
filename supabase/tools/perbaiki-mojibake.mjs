// Perbaiki mojibake di satu berkas.
//
// Dijalankan sebagai skrip, bukan diedit manual, karena karakter rusaknya
// sendiri tricky untuk diketik di editor - dan menyalin ulang deret rusak
// itu justru risked membuat berkas rusak lagi.
//
// Yang diperbaiki hanya pasangan yang sudah dipastikan salah oleh
// cek-mojibake.mjs: deret byte yang, kalau dibaca sebagai cp1252, berubah
// dari tiga karakter menjadi satu tanda baca yang jelas maksudnya.
import fs from 'node:fs';
import path from 'node:path';

const target = process.argv[2];
if (!target) {
  console.error('pemakaian: node perbaiki-mojibake.mjs <berkas>');
  process.exit(1);
}

// Setiap kunci adalah deret rusak; nilainya adalah teks yang benar.
const PASANGAN = [
  // em-dash U+2014. Rusaknya: E2  ->  U+00E2, lalu 80 -> U+20AC, lalu 94 -> U+201D
  { rusak: '\u00e2\u20ac\u201d', benar: '\u2014' },
  // middle dot U+00B7. Rusaknya: C2 -> U+00C2, lalu B7 -> U+00B7
  { rusak: '\u00c2\u00b7', benar: '\u00b7' },
  // en-dash U+2013. Rusaknya: E2 -> U+00E2, lalu 80 -> U+20AC, lalu 93 -> U+201C
  { rusak: '\u00e2\u20ac\u201c', benar: '\u2013' },
  // curly quote. E2 80 9C -> U+00E2 U+20AC U+201C
  { rusak: '\u00e2\u20ac\u0153', benar: '\u201c' }
];

const p = path.resolve(target);
const sebelum = fs.readFileSync(p, 'utf8');
let sesudah = sebelum;
const laporan = [];

for (const { rusak, benar } of PASANGAN) {
  let hitung = 0;
  // split/join, bukan replaceAll, supaya jelas tidak memakai regex dan
  // karakter '$' di teks tidak punya arti khusus.
  const bagian = sesudah.split(rusak);
  if (bagian.length > 1) {
    hitung = bagian.length - 1;
    sesudah = bagian.join(benar);
  }
  if (hitung) {
    laporan.push(`  ${JSON.stringify(rusak)} -> ${JSON.stringify(benar)}  x${hitung}`);
  }
}

if (sesudah === sebelum) {
  console.log('tidak ada yang perlu diperbaiki: ' + path.basename(p));
  process.exit(0);
}

fs.writeFileSync(p, sesudah, 'utf8');
console.log('diperbaiki: ' + path.basename(p));
console.log(laporan.join('\n'));