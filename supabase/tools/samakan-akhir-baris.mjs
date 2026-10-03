// ============================================================================
//  samakan-akhir-baris.mjs  -  Pastikan tiap berkas teks satu gaya akhir baris
// ============================================================================
//  MASALAH YANG MENYEBABKAN FILE INI ADA
//  -------------------------------------
//  Sebagian alat penyunting menulis LF, sebagian menulis CRLF. Kalau keduanya
//  dipakai pada satu berkas, baris yang disentuh jadi LF sementara baris
//  lainnya tetap CRLF:
//
//      index.html : 1109 LF, 435 CRLF   (BERCAMPUR)
//
//  Kenapa ini penting, padahal git sudah mennormalkan sendiri:
//
//  1. `core.autocrlf=true` di komputer Windows membuat git mengubah CRLF jadi
//     LF SAAT COMMIT. Di runner Linux (autocrlf=false) tidak ada perubahan
//     apa pun - dan itu sebabnya berkas bercampur bisa ikut ter-commit
//     apa adanya.
//
//  2. diff di dalam editor dan di beberapa alat become jauh lebih sulit dibaca
//     kalau akhir baris bercampur.
//
//  3. Beberapa perkakas membandingkan berkas byte-per-byte, dan perbedaan
//     akhir baris akan dilaporkan sebagai perbedaan isi.
//
//  ACUAN: satu berkas, bukan satu repository.
//
//  CATATAN PENTING SOAL core.autocrlf
//  ---------------------------------
//  Di komputer ini `core.autocrlf=true`, jadi git menulis CRLF ke working tree
//  saat checkout dan mengubahnya kembali jadi LF saat commit. Akibatnya
// Almost semua berkas teks di sini tetap LF di working tree setelah
  // di-normalkan, dan hanya LF yang masuk repository.
//
//  Itu membuat "gaya berbeda dari HEAD" BUKAN tanda kerusakan di komputer
//  Windows - git akan merapikannya sendiri. Yang benar-benar salah hanyalah
//  berkas yang CAMPUR: sebagian baris CRLF, sebagian LF, di dalam satu
//  berkas. Campuran itu tidak akan pernah dirapikan oleh git di kedua arah,
//  dan hanya muncul karena alat penyunting menulis LF pada baris yang
//  disentuh di tengah berkas yang lain CRLF.
//
//  Jadi skrip ini HANYA melaporkan berkas bercampur. Berkas yang murni CRLF
//  atau murni LF dianggap beres.
//
//  CARA MENJALANKAN
//    node samakan-akhir-baris.mjs            -> hanya laporan
//    node samakan-akhir-baris.mjs --pasang   -> ubah yang perlu
//
//  Tanpa --pasang skrip hanya melaporkan dan keluar dengan kode 1. Menyunting
//  akhir baris adalah perubahan yang tidak terlihat di diff, jadi sebaiknya
//  disengaja.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEMPAR = process.argv.includes('--pasang');

const LewatiFolder = new Set(['node_modules', '.git', 'pgdata', 'pgdata-pwq', 'out']);
const EkstensiBiner = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp',
  '.pdf', '.zip', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.webm'
]);

// Hanya berkas yang PERNAH di-commit yang diperiksa. Berkas baru tidak punya
// acuan, dan menebak gaya-nya hanya menambah laporan yang tidak berguna.
const dilacak = new Set(
  execFileSync('git', ['-C', REPO, 'ls-files'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split('\n').filter(Boolean)
);

const perlu = [];

function hitung(latin) {
  return {
    crlf: (latin.match(/\r\n/g) || []).length,
    lf: (latin.match(/(?<!\r)\n/g) || []).length
  };
}

for (const rel of dilacak) {
  if (EkstensiBiner.has(path.extname(rel).toLowerCase())) continue;
  const target = path.join(REPO, rel);
  if (!fs.existsSync(target)) continue;
  if (fs.statSync(target).size > 4_000_000) continue;

  const bytes = fs.readFileSync(target);
  const sekarang = hitung(bytes.toString('latin1'));

  // Hanya campur yang bothersome. Murni CRLF dan murni LF keduanya beres.
  if (!(sekarang.crlf > 0 && sekarang.lf > 0)) continue;

  // Kalau campur, gaya mayoritas yang menentukan bentuk akhir berkas.
  const mau = sekarang.crlf > sekarang.lf ? 'CRLF' : 'LF';
  perlu.push({ rel, mau, ...sekarang });
  if (LEMPAR) {
    const teks = bytes.toString('utf8');
    fs.writeFileSync(target,
      mau === 'CRLF' ? teks.replace(/\r?\n/g, '\r\n') : teks.replace(/\r\n/g, '\n'),
      'utf8');
  }
}

console.log('='.repeat(64));
console.log('GAYA AKHIR BARIS' + (LEMPAR ? '  (mode pasang)' : '  (mode laporan)'));
console.log('='.repeat(64));
console.log('  yang diperiksa: berkas bercampur saja (CRLF dan LF dalam satu berkas)');

if (!perlu.length) {
  console.log('\nHASIL: tidak ada berkas yang bercampur');
  process.exit(0);
}

for (const h of perlu) {
  console.log(`  ${h.rel}`);
  console.log(`      ${h.crlf} CRLF, ${h.lf} LF  ->  diseragamkan ke ${h.mau}`);
}
console.log('');
console.log(LEMPAR
  ? `HASIL: ${perlu.length} berkas diseragamkan`
  : `HASIL: ${perlu.length} berkas bercampur. Jalankan lagi dengan --pasang.`);
process.exit(LEMPAR ? 0 : 1);