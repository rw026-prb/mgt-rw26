// ============================================================================
//  diagnose-alur.mjs  —  Simulasi alur loginPENUH, seperti yang dilakukan browser
// ============================================================================
//  Meniru apa yang dilakukan login.html + rw26-api.js + index.html, langkah demi
//  langkah. Tujuannya: memisahkan masalah "server" dari masalah "browser".
//
//  Kalau langkah ini berhasil, server pasti benar. Kalau gagal, kita tahu
//  persis di titik mana tanpa perlu menebak.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './lib.mjs';

const DI_SINI = path.dirname(fileURLToPath(import.meta.url));
const cfg = { ...loadEnv(path.join(DI_SINI, '.env')), ...process.env };
const base = cfg.SUPABASE_URL.replace(/\/+$/, '');

const langkah = (n, teks) => console.log(`\n[${n}] ${teks}`);
const ok = (t) => console.log(`    OK    ${t}`);
const no = (t) => console.log(`    GAGAL ${t}`);

const cred = fs.readdirSync(path.join(DI_SINI, 'out')).filter((f) => f.endsWith('.csv'))
  .map((f) => ({
    f,
    rows: fs.readFileSync(path.join(DI_SINI, 'out', f), 'utf8').trim().split(/\r?\n/).slice(1)
      .map((b) => {
        const v = (b.match(/("[^"]*"|[^,]*)(?:,|$)/g) || []).map((s) => s.replace(/,$/, '').replace(/^"|"$/g, ''));
        return { legacy_id: v[0], nama: v[1], email: v[2], role: v[3], password: v[4] };
      }),
  }));
const k = cred[0].rows.find((r) => r.role === 'Super Admin') || cred[0].rows[0];
console.log('Menguji akun : ' + k.nama + '  <' + k.email + '>  (dari ' + cred[0].f + ')');

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(62));
console.log('LANGKAH 1 - signInWithPassword (setelah mengisi form login)');
console.log('='.repeat(62));
const anon = { apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
const tokenRes = await fetch(`${base}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: anon, body: JSON.stringify({ email: k.email, password: k.password }),
});
const tokenData = await tokenRes.json();
if (!tokenRes.ok) {
  no('login ditolak: ' + (tokenData.error_description || tokenData.msg));
  process.exit(1);
}
ok('token diperoleh, panjang ' + tokenData.access_token.length);
const jwt = tokenData.access_token;

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(62));
console.log('LANGKAH 2 - bootstrap(): baca profil sendiri (butuh token)');
console.log('='.repeat(62));
const authH = { apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + jwt };
const pRes = await fetch(`${base}/rest/v1/profiles?select=*&id=eq.${tokenData.user.id}`, { headers: authH });
const pRows = await pRes.json();
if (pRes.status !== 200 || !pRows.length) { no('profil tidak terbaca: HTTP ' + pRes.status + ' ' + JSON.stringify(pRows)); process.exit(1); }
const profil = pRows[0];
ok(`profil terbaca: ${profil.legacy_id} / ${profil.nama} / ${profil.role} / ${profil.status}`);
console.log(`       must_change_pw = ${profil.must_change_pw}`);

if (String(profil.status).toLowerCase() !== 'aktif') { no('profil nonaktif - portal akan mengarahkan ke login?err=nonaktif'); }
if (profil.must_change_pw) {
  console.log('       -> portal akan mengarahkan ke update-password.html');
  console.log('          Halaman itu butuh SESI yang valid. Kalau tautan reset');
  console.log('          tidak sampai ke domain yang benar, halaman itu gagal.');
}

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(62));
console.log('LANGKAH 3 - panggil fungsi yang butuh login');
console.log('='.repeat(62));
const rpc = await fetch(`${base}/rest/v1/rpc/list_kas`, {
  method: 'POST', headers: { ...authH, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_page: 1, p_perpage: 5 }),
});
const rpcData = await rpc.json();
if (rpc.status === 200) {
  ok(`list_kas berhasil: ${rpcData.total} transaksi, peran ${rpcData.userRole}`);
} else {
  no('list_kas: HTTP ' + rpc.status + ' ' + JSON.stringify(rpcData).slice(0, 200));
}

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(62));
console.log('LANGKAH 4 - aksi yang perlu Google Apps Script');
console.log('='.repeat(62));
const appsUrl = fs.readFileSync(path.join(DI_SINI, '..', '..', 'config.js'), 'utf8')
  .match(/APPS_SCRIPT_URL\s*=\s*'([^']+)'/)[1];
const scRes = await fetch(appsUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({ action: 'listNews', token: jwt }),
});
const scData = await scRes.json();
if (scData.ok) {
  ok(`listNews berhasil: ${scData.news.length} berita (token Supabase diterima Apps Script)`);
} else {
  no('listNews: ' + scData.message);
  console.log('       -> token tidak dikenali.cek script properties Supabase di Apps Script');
  console.log('          (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY)');
}

console.log('\n' + '='.repeat(62));
console.log('Kesimpulan');
console.log('='.repeat(62));
console.log('Kalau langkah 1-3 hijau tapi langkah 4 merah, masalahnya ada di');
console.log('konfigurasi Script Properties, bukan di password.');
console.log('Kalau semuanya hijau, masalahnya murni di sisi browser (cache).');
