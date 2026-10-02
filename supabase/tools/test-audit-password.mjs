// Uji aturan "kata sandi" di audit-github.mjs: berkas uji boleh, berkas lain
// tidak boleh lolos.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DI_SINI = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(DI_SINI, 'audit-github.mjs'), 'utf8');

// Ambil blok POLA beserta re dan lewatiDi-nya apa adanya, lalu pakai.
const blok = src.match(/const POLA = \[[\s\S]*?\n\];/);
if (!blok) { console.error('Blok POLA tidak ditemukan'); process.exit(1); }
const POLA = eval(blok[0].replace('const POLA =', '(').replace(/;\s*$/, ')'));

let lulus = 0, gagal = 0;
const cek = (nama, dapat, harus) => {
  const ok = dapat === harus;
  if (ok) lulus++; else gagal++;
  console.log(`  ${ok ? 'OK   ' : 'SALAH'} ${nama}  -> terdeteksi=${dapat}, harus=${harus}`);
};

const rule = POLA.find((p) => p.nama === 'kata sandi');
console.log('Aturan "kata sandi"');
console.log('-'.repeat(60));
cek('memiliki pengecualian untuk berkas uji', Boolean(rule.lewatiDi), true);

// Simulasikan isi berkas dengan bentuk kebocoran yang realistis.
const isiUji = "const c = new Client({ password: 'postgres' });";
const bocor = [
  ['password', "const db = { password: 'PasswordSuperRahasia123' };"],
  ['pwd', 'const pwd = "RahasiaBanget123";'],
  ['secret', 'const secret: "abc123def456ghi";'],
  ['kunci', 'const KUNCI = "isiKunciYangRahasia";'],
];

const jalankan = (isi, jalur) => {
  if (rule.lewatiDi && rule.lewatiDi.test(jalur)) return false;
  return rule.re.test(isi);
};

cek('password tiruan di berkas uji diabaikan',
  jalankan(isiUji, 'supabase/tools/test-ganti-password.mjs'), false);
cek('password tiruan di berkas NON-uji tetap terdeteksi',
  jalankan(isiUji, 'config.js'), true);
for (const [nama, isi] of bocor) {
  cek(`kunci "${nama}" di config.js terdeteksi`, jalankan(isi, 'config.js'), true);
  cek(`kunci "${nama}" di Code.gs terdeteksi`, jalankan(isi, 'Code.gs'), true);
}
cek('berkas tanpa pola diabaikan', jalankan('const x = 1;', 'config.js'), false);
cek('nilai pendek diabaikan', jalankan('const password = "abc";', 'config.js'), false);

console.log('-'.repeat(60));
console.log(`lulus ${lulus}, gagal ${gagal}`);
process.exit(gagal ? 1 : 0);
