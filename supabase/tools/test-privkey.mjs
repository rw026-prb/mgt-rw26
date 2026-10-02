// ============================================================================
//  test-privkey.mjs  —  Uji fungsi deteksi private key di audit-github.mjs
// ============================================================================
//  Uji ini penting karena polanya pernah terlalu longgar: README memuat contoh
//  private key dengan isi disingkat menjadi "MIIEvQIBADANBg...", dan pola
//  lama ikut menandainya sebagai kebocoran.
//
//  Kalau polanya terlalu ketat, kebocoran asli bisa lolos. Karena itu kedua
//  arah diuji: contoh harus TIDAK terdeteksi, key asli HARUS terdeteksi.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

// Path relatif ke file ini. Ditulis mati dengan "D:/..." hanya akan jalan di
// komputer itu saja, dan akan gagal di runner CI yang memakai Linux.
const DI_SINI = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(DI_SINI, 'audit-github.mjs'), 'utf8');
const m = src.match(/function adaPrivateKeyAsli\(isi\) \{[\s\S]*?\n\}/);
if (!m) {
  console.error('Fungsi adaPrivateKeyAsli tidak ditemukan di audit-github.mjs');
  process.exit(1);
}
const deklarasi = m[0].replace(/^function\s+/, '');
const adaPrivateKeyAsli = eval('(' + deklarasi.replace(/^adaPrivateKeyAsli\s*\(isi\)\s*\{/, 'function (isi) {') + ')');

/*
 * Kunci privat DIBAKAL di sini, bukan diambil dari .env.
 *
 * Alasannya dua. Pertama, berkas .env tidak ada di runner CI, jadi uji ini
 * akan gagal di sana. Kedua - dan ini yang lebih penting - sebuah pengujian
 * tidak seharusnya pernah membaca kunci sungguhan. Kalau skrip ini ikut
 * ter-commit bersama kuncinya, kebocoran itu justru menjaditools pengujiannya sendiri.
 */
const pasangan = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const keyAsli = pasangan.privateKey;

const contohReadme =
  'GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBg...\\nOT...\\n-----END PRIVATE KEY-----\\n"';

const kasus = [
  ['private key RSA asli (dibuat saat uji)', keyAsli, true],
  ['contoh di README (ada "...")', contohReadme, false],
  ['tidak ada private key sama sekali', 'SELECT 1 FROM dual', false],
  ['BEGIN dan END tanpa isi', '-----BEGIN PRIVATE KEY-----\n-----END PRIVATE KEY-----', false],
  ['hanya teks "PRIVATE KEY" di paragraf', 'Simpan private key Anda di tempat aman.', false],
];

let gagal = 0;
console.log('Uji deteksi private key');
console.log('-'.repeat(60));
for (const [nama, isi, harus] of kasus) {
  const dapat = Boolean(adaPrivateKeyAsli(isi));
  const ok = dapat === harus;
  if (!ok) gagal++;
  const tanda = !isi ? '(kosong)' : (isi.length > 60 ? isi.slice(0, 57) + '...' : isi.replace(/\n/g, '\\n'));
  console.log(`  ${ok ? 'OK   ' : 'SALAH'} ${nama}`);
  console.log(`        isi  : ${tanda}`);
  console.log(`        dapat: ${dapat}, harus: ${harus}`);
}
console.log('-'.repeat(60));
console.log(`lulus ${kasus.length - gagal}, gagal ${gagal}`);
process.exit(gagal ? 1 : 0);
