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

const src = fs.readFileSync('D:/Website RW/Mgt-portal RW/supabase/tools/audit-github.mjs', 'utf8');
const m = src.match(/function adaPrivateKeyAsli\(isi\) \{[\s\S]*?\n\}/);
if (!m) {
  console.error('Fungsi adaPrivateKeyAsli tidak ditemukan di audit-github.mjs');
  process.exit(1);
}
const deklarasi = m[0].replace(/^function\s+/, '');
const adaPrivateKeyAsli = eval('(' +deklarasi.replace(/^adaPrivateKeyAsli\s*\(isi\)\s*\{/, 'function (isi) {') + ')');

const envAsli = fs.readFileSync('D:/Website RW/Mgt-portal RW/supabase/tools/.env', 'utf8');
const barisKey = (envAsli.match(/^GOOGLE_PRIVATE_KEY\s*=\s*(.*)$/m) || [])[1] || '';
const keyAsli = barisKey.trim().replace(/^"/, '').replace(/"$/, '').replace(/\\n/g, '\n');

const contohReadme =
  'GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBg...\\nOT...\\n-----END PRIVATE KEY-----\\n"';

const kasus = [
  ['private key asli dari .env', keyAsli, true],
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
