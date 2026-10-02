// ============================================================================
//  diagnose-login.mjs
// ============================================================================
//  Memeriksa apakah password di berkas kredensial benar-benar cocok dengan
//  akun yang ada di Supabase Auth.
//
//  Melakukan SATU percobaan login per akun. Supabase membatasi percobaan
//  login berulang, jadi Diagnosa ini sengaja tidak mengulang.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './lib.mjs';

const DI_SINI = path.dirname(fileURLToPath(import.meta.url));
const cfg = { ...loadEnv(path.join(DI_SINI, '.env')), ...process.env };
const base = cfg.SUPABASE_URL.replace(/\/+$/, '');

const dirKredensial = path.join(DI_SINI, 'out');
const berkas = fs.existsSync(dirKredensial)
  ? fs.readdirSync(dirKredensial).filter((f) => f.endsWith('.csv'))
  : [];

if (!berkas.length) {
  console.log('Tidak ada berkas kredensial di out/');
  process.exit(0);
}

const kredensial = [];
for (const f of berkas) {
  const isi = fs.readFileSync(path.join(dirKredensial, f), 'utf8').trim().split(/\r?\n/);
  const kepala = isi[0].replace(/"/g, '').split(',');
  for (const baris of isi.slice(1)) {
    const bagian = baris.match(/("[^"]*"|[^,]*)(?:,|$)/g) || [];
    const v = bagian.map((s) => s.replace(/,$/, '').replace(/^"|"$/g, ''));
    kredensial.push({ berkas: f, ...Object.fromEntries(kepala.map((k, i) => [k, v[i]])) });
  }
}

console.log('Berkas kredensial : ' + berkas.join(', '));
console.log('Akun di daftar    : ' + kredensial.length);
console.log('');

// --- daftar akun yang benar-benar ada di Supabase Auth ---
const res = await fetch(`${base}/auth/v1/admin/users?per_page=100`, {
  headers: { apikey: cfg.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_SERVICE_ROLE_KEY },
});
const data = await res.json();
const akunDiSupabase = (data.users || []).map((u) => ({
  id: u.id, email: u.email, dibuat: u.created_at, terakhirMasuk: u.last_sign_in_at,
}));

console.log('Akun di Supabase Auth : ' + akunDiSupabase.length);
for (const a of akunDiSupabase) {
  console.log(`  ${a.email}`);
  console.log(`      dibuat        : ${String(a.dibuat).slice(0, 19).replace('T', ' ')}`);
  console.log(`      terakhir masuk: ${a.terakhirMasuk ? String(a.terakhirMasuk).slice(0, 19).replace('T', ' ') : 'BELUM PERNAH'}`);
}
console.log('');

// --- coba satu login per akun ---
const sbAnon = { apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
let cocok = 0, tidakCocok = 0;

for (const k of kredensial) {
  const r = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: sbAnon,
    body: JSON.stringify({ email: k.email, password: k.password }),
  });
  const t = await r.json();
  const ok = r.ok && !!t.access_token;
  if (ok) cocok++; else tidakCocok++;
  console.log(`  ${ok ? 'COCOK  ' : 'GAGAL  '} ${k.email}  (dari ${k.berkas})`);
  if (!ok) console.log(`          alasan: ${t.error_description || t.msg || t.error || 'tidak diketahui'}`);
}

console.log('');
console.log(`Ringkasan: ${cocok} cocok, ${tidakCocok} tidak cocok`);

// --- apakah ada akun yang tidak ada di daftar kredensial? ---
const emailDiSupabase = akunDiSupabase.map((a) => String(a.email).toLowerCase());
const emailDiDaftar = kredensial.map((k) => String(k.email).toLowerCase());
const tanpa = emailDiSupabase.filter((e) => !emailDiDaftar.includes(e));
if (tanpa.length) {
  console.log('\nAkun di Supabase yang TIDAK ada di berkas kredensial:');
  for (const e of tanpa) console.log('  - ' + e);
}
