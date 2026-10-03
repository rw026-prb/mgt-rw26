// ============================================================================
//  cek-mojibake.mjs  -  Cari teks UTF-8 yang sudah rusak jadi Latin-1
// ============================================================================
//  MASALAH YANG MENYEBABKAN FILE INI ADA
//  ------------------------------------
//  MOSIBAKE terjadi ketika teks UTF-8 dibaca sebagai cp1252 (atau sebaliknya).
//  Hasilnya rangkaian karakter aneh yang MIRIP tipografi, bukan error.
//
//  Dua contoh, ditulis sebagai byte agar berkas ini tidak ikut dilaporkan
//  oleh pemeriksa yang sedang berjalan:
//
//      em-dash  E2 80 94   ->   E2 lalu U+20AC lalu U+201D  (tiga karakter)
//      middle   C2 B7      ->   U+00C2 lalu U+00B7          (dua karakter)
//
//  Teks aslinya adalah satu karakter masing-masing. Yang muncul di layar
//  adalah tiga dan dua karakter asing yangitorek tidak masuk akal.
//
//  Alasan kenapa ini penting dan tidak tertangkap pemeriksa lain:
//
//  1. Karakter hasil rusaknya SANGAT SAH. `·` (U+00B7) dan `—` (U+2014)
//     adalah tipografi normal, dan keduanya ada di allowlist cek-asing.mjs.
//     Jadi pemeriksa karakter asing tidak akan pernah melaporkannya.
//  2. Tidak merusak sintaks. `node --check` tetap lulus.
//  3. Tampilannya rusak di layar. Salah ketik sekecil `—` yang jadi tiga
//     karakter sudah cukup untuk membuat pesan bantuan tidak terbaca.
//
//  TANDA KENALNYA
//  -------------
//  Mojibake Latin-1 punya sifat yang bisa dibuktikan, bukan hanya dikira-kira:
//  jika deretan byte itu dibaca sebagai UTF-8, hasilnya akan menjadi satu
//  karakter yang SAH. Itu berbeda dari "é" yang memang benar-benar ada di
//  teks asli - yang terakhir hanya satu karakter dan tidak bisa di-decode jadi
//  apa pun yang lebih bermakna.
//
//  Jadi pemeriksaan di bawah tidak memakai pola tebakan. Ia mengambil setiap
//  deretan karakter U+0080-U+00FF, lalu mencoba mengubahnya dari Latin-1 ke
//  UTF-8. Kalau:
//    - hasilnya bukan U+FFFD (tanda gagal decode), dan
//    - hasilnya bukan karakter ASCII biasa, dan
//    - panjang hasil lebih pendek dari deret asalnya (2-3 byte UTF-1
//      menyatu jadi 1 karakter),
//  maka deret itu pasti salah baca.
//
//  Pendekatan ini tidak punya kemungkinan false positive pada teks Latin-1
//  yang benar, dan tidak bisa masuk ke backtracking yang membuat versi
//  berbasis regex sebelumnya menghabiskan seluruh memori.
//
//  CARA MENJALANKAN
//    node cek-mojibake.mjs             -> periksa seluruh repo
//    node cek-mojibake.mjs index.html  -> periksa satu berkas
//
//  Keluar dengan kode 1 kalau ada mojibake ditemukan.
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

// Batas jumlah laporan per berkas, supaya satu file rusak tidak membanjiri
// log dan menutupi temuan lain.
const MAKS_PER_BERKAS = 20;

// Peta karakter cp1252 yang mewakili byte 0x80-0x9F.
//
// Ini wajib ada. Urutan tiga byte UTF-8 yang dibaca sebagai cp1252 tidak
// selalu menghasilkan karakter di rentang U+0080-U+00FF:
//
//      "—"  (E2 80 94)  ->  "â" + "€" + "”"
//
// `€` adalah U+20AC dan `”` adalah U+201D - keduanya DI LUAR U+00FF. Kalau
// deret hanya dicari di rentang Latin-1, `â` akan terlihat sendirian dan
// terlewat. Peta di bawah memperbaikinya: setiap karakter dipetakan balik ke
// satu byte, lalu byte-byte itu dicoba decode sebagai UTF-8.
const cp1252 = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
  [0x017e, 0x9e], [0x0178, 0x9f]
]);

/** Byte yang mewakili satu karakter, atau -1 kalau karakter itu bukan cp1252. */
function byteDari(ch) {
  const cp = ch.codePointAt(0);
  if (cp <= 0xff) return cp;
  const b = cp1252.get(cp);
  return b === undefined ? -1 : b;
}

const temuan = [];

/**
 * Deteksi satu baris.
 *
 * Tiga aturan, semuanya penting:
 *
 * 1. Pencarian HANYA dimulai dari byte >= 0xC2. Byte itu lead byte UTF-8
 *    dua byte atau lebih, jadi hanya byte seperti itu yang bisa memulai
 *    karakter UTF-8 - dan hanya byte seperti itu yang bisa jadi hasil
 *    salah baca. Versi pertama skrip ini memulai dari karakter apa pun
 *    bercode <= 0xFF, termasuk huruf ASCII biasa, sehingga setiap langkah
 *    lompat empat karakter dan deret mojibake di tengah barik pernah
 *    terlewat tanpa terdeteksi.
 *
 * 2. Deret berhenti di karakter ASCII. Karakter ASCII di teks asli selalu
 *    sudah benar, jadi tidak mungkin bagian dari mojibake.
 *
 * 3. Setiap awalan deret (2, 3, lalu 4 byte) dicoba sebagai satu karakter
 *    UTF-8. Yang berhasil decode tanpa U+FFFD dan menyatu jadi lebih sedikit
 *    karakter itulah Mojibake.
 */
function periksaBaris(label, nomorBaris, baris) {
  const karakter = [...baris];
  let i = 0;
  while (i < karakter.length) {
    if (byteDari(karakter[i]) < 0xc2) { i++; continue; }

    // Kumpulkan byte lanjutan. Berhenti di karakter yang tidak mungkin
    // menjadi byte kelanjutan mojibake (yaitu ASCII).
    const deret = [byteDari(karakter[i])];
    let j = i + 1;
    while (j < karakter.length && deret.length < 4) {
      const b = byteDari(karakter[j]);
      // ASCII (< 0x80) selalu benar, jadi bukan bagian dari mojibake.
      if (b >= 0 && b < 0x80) break;
      if (b < 0) break;
      deret.push(b);
      j++;
    }

    for (let n = Math.min(deret.length, 4); n >= 2; n--) {
      const hasil = Buffer.from(deret.slice(0, n)).toString('utf8');
      // U+FFFD ditulis sebagai escape supaya berkas pemeriksa ini sendiri
      // tidak dilaporkan oleh cek-asing.mjs.
      if (hasil.includes(String.fromCharCode(0xfffd))) continue;
      if ([...hasil].length >= n) continue;
      const cp = hasil.codePointAt(0);
      // Hasil harus non-ASCII dan bukan byte kendali C0/C1 - dua hal itu
      // menandakan byte-nya memang rusak, bukan teks Latin-1 asli.
      if (cp <= 0x7f || (cp >= 0x80 && cp <= 0x9f) || cp === 0xfffd) continue;
      return {
        label,
        baris: nomorBaris,
        deret: karakter.slice(i, i + n).join(''),
        hasil,
        konteks: baris.slice(Math.max(0, i - 34), i + n + 34)
      };
    }

    i = j > i ? j : i + 1;
  }
  return null;
}

function periksa(target) {
  const stat = fs.statSync(target);
  if (stat.size > 4_000_000) return;
  const label = path.relative(REPO, target) || target;
  const baris = fs.readFileSync(target, 'utf8').split(/\r?\n/);
  let n = 0;
  baris.forEach((b, i) => {
    if (n >= MAKS_PER_BERKAS) return;
    const ketemu = periksaBaris(label, i + 1, b);
    if (ketemu) { temuan.push(ketemu); n++; }
  });
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
console.log('CEK MOJIBAKE');
console.log('='.repeat(64));

const argumen = process.argv.slice(2);
if (argumen.length) {
  for (const a of argumen) telusuri(path.isAbsolute(a) ? a : path.join(REPO, a));
} else {
  telusuri(REPO);
}

if (!temuan.length) {
  console.log('\nHASIL: bersih, tidak ada mojibake');
  process.exit(0);
}

console.log('');
for (const t of temuan) {
  console.log(`  ${t.label}:${t.baris}  ${JSON.stringify(t.deret)}  ->  ${JSON.stringify(t.hasil)}`);
  console.log(`      ${JSON.stringify(t.konteks)}`);
}
console.log('');
console.log(`HASIL: ${temuan.length} mojibake di ${new Set(temuan.map((t) => t.label)).size} berkas`);
console.log('Perbaikan: buka berkas itu sebagai UTF-8, lalu ketik ulang teksnya.');
process.exit(1);