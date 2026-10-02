// ============================================================================
//  smoke.mjs  —  Uji jalur yang akan dipakai website publik
// ============================================================================
//  Mengirim permintaan dengan kunci `anon`, persis seperti yang dilakukan
//  browser pengunjung yang belum login. Kalau perintah ini berhasil, website
//  sudah bisa menampilkan datanya.
//
//  Jalankan: node smoke.mjs
// ============================================================================

import { loadEnv } from './lib.mjs';

const cfg = { ...loadEnv('.env'), ...process.env };
const base = cfg.SUPABASE_URL.replace(/\/+$/, '');
const anon = { apikey: cfg.SUPABASE_ANON_KEY, Authorization: `Bearer ${cfg.SUPABASE_ANON_KEY}` };

let lulus = 0, gagal = 0;
const ok = (nama, pesan) => { lulus++; console.log(`  OK    ${nama}${pesan ? '  ' + pesan : ''}`); };
const no = (nama, pesan) => { gagal++; console.log(`  SALAH ${nama}\n        ${pesan}`); };

const get = async (p) => {
  const r = await fetch(`${base}/rest/v1/${p}`, { headers: anon });
  return { status: r.status, data: await r.json() };
};
const rpc = async (fn, args) => {
  const r = await fetch(`${base}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { ...anon, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const t = await r.text();
  return { status: r.status, data: t ? JSON.parse(t) : null };
};

console.log('JALUR PUBLIK (kunci anon, tanpa login)\n');

console.log('Isi halaman utama');
const c = await rpc('get_public_content', {});
if (c.status === 200) {
  const d = c.data;
  ok('get_public_content', `himbauan ${d.himbauan.length}, pengumuman ${d.announcements.length}, `
    + `fasilitas ${d.facilities.length}, organisasi ${Object.values(d.organization).flat().length}, `
    + `statistik ${d.statistik.length}`);
  const grup = Object.keys(d.organization).sort().join(',');
  if (Object.keys(d.organization).length !== 5) no('lima grup organisasi harus ada', grup);
  else ok('lima grup organisasi lengkap', grup);
  if (d.himbauan.every((h) => h.status === 'Aktif')) ok('hanya himbauan Aktif yang tampil');
  else no('ada himbauan nonaktif yang bocor', JSON.stringify(d.himbauan.map((h) => h.status)));
  if (d.himbauan.every((h) => h.fileId)) ok('semua himbauan punya fileId foto');
  else no('himbauan tanpa fileId', JSON.stringify(d.himbauan.filter((h) => !h.fileId)));
  if (d.statistik.length === 6) ok('statistik 6 baris', d.statistik.map((s) => `${s.nama}=${s.nilai}`).join(' '));
  else no('jumlah statistik', JSON.stringify(d.statistik.length));
} else no('get_public_content', `status ${c.status}`);

console.log('\nLaporan kas publik');
for (const bulan of [5, 6, 7]) {
  const r = await rpc('kas_report', { p_bulan: bulan, p_tahun: 2026 });
  if (r.status !== 200) { no(`kas_report bulan ${bulan + 1}`, `status ${r.status}`); continue; }
  const d = r.data;
  const nama = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'][bulan];
  ok(`kas_report ${nama} 2026`,
     `saldoAwal ${d.saldoAwal} | masuk ${d.totalMasuk} | keluar ${d.totalKeluar} | akhir ${d.saldoAkhir} `
     + `| rincian masuk ${d.rincianMasuk.length}, keluar ${d.rincianKeluar.length}`);
  if (d.saldoAkhir !== d.saldoAwal + d.totalMasuk - d.totalKeluar) {
    no(`kas_report ${nama} tidak seimbang`, JSON.stringify(d));
  }
}

const cf = await rpc('kas_cash_flow', { p_bulan_awal: 4, p_tahun_awal: 2026, p_bulan_akhir: 7, p_tahun_akhir: 2026 });
if (cf.status === 200 && cf.data.data.length === 4) {
  ok('kas_cash_flow 4 bulan', cf.data.data.map((d) => `${d.label}=${d.saldo}`).join(' '));
} else no('kas_cash_flow', JSON.stringify(cf.data));

console.log('\nYang HARUS ditolak');
for (const [label, fn] of [
  ['visitor_stats()', () => rpc('visitor_stats', {})],
  ['kas_dashboard()', () => rpc('kas_dashboard', {})],
  ['list_kas()', () => rpc('list_kas', {})],
  ['update_my_profile()', () => rpc('update_my_profile', { p_nama: 'x', p_no_hp: 'y' })],
]) {
  const r = await fn();
  if (r.status === 400 || r.status === 401 || r.status === 403) ok(`${label} ditolak`, `status ${r.status}`);
  else no(`${label} seharusnya ditolak`, `status ${r.status} ${JSON.stringify(r.data)}`);
}

for (const [label, table] of [
  ['profiles', 'profiles'],
  ['kas (tabel)', 'kas'],
  ['visitor_log', 'visitor_log'],
  ['activity_log', 'activity_log'],
]) {
  const r = await get(`${table}?select=*`);
  if (r.status === 401 || r.status === 403) {
    // 401/403 = GRANT ditolak (0002b_lockdown.sql). Ini hasil yang lebih kuat
    // daripada 200 dengan 0 baris:-nya memang tidak diizinkan.
    ok(`SELECT ${label} ditolak`, `status ${r.status}`);
  } else if (r.status === 200 && Array.isArray(r.data) && r.data.length === 0) {
    ok(`SELECT ${label} -> kosong (RLS menyaring)`);
  } else {
    no(`SELECT ${label} seharusnya tidak bisa dibaca`,
       `status ${r.status}, isi ${JSON.stringify(r.data).slice(0, 120)}`);
  }
}

console.log(`\nlulus ${lulus}, gagal ${gagal}`);
process.exit(gagal ? 1 : 0);
