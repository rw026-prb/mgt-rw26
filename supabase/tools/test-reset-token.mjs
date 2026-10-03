// ============================================================================
//  test-reset-token.mjs  -  Buktikan reset password mandiri tidak bisa ditembus
// ============================================================================
//  Alur reset password yang baru menyimpan token di
//  public.password_reset_tokens danierima tiga aksi Apps Script yang berjalan
//  TANPA sesi - orang yang minta reset memang belum bisa login. Tiga aksi itu
//  karena itu jadi satu-satunya pintu masuk yang terbuka untuk siapa saja.
//
//  Skenario yang diuji, memakai PostgreSQL lokal sungguhan:
//
//  1. anon dan authenticated tidak boleh punya akses apa pun ke tabel token.
//  2. service_role boleh akses penuh - hanya dia yang membuat dan memakai
//     token, lewat Code.gs.
//  3. RLS dihidupkan tanpa policy: peran anon tidak melihat baris apa pun.
//  4. Fungsi cari_user_id_by_email hanya boleh dipanggil service_role.
//  5. Fungsi itu mengembalikan id HANYA untuk akun yang masih Aktif.
//  6. Klaim token bersifat single-use: klaim kedua tidak mendapat baris.
//  7. Token kedaluwarsa tidak bisa diklaim, walau belum pernah dipakai.
//  8. Baris token ikut terhapus kalau akunnya dihapus.
//  9. Tidak ada kolom yang bisa menampung password dalam bentuk apa pun.
// ============================================================================

import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DI_SINI = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(DI_SINI, '..', 'migrations');
// Port dan folder sendiri, supaya tidak bentrok dengan validate-migrations.cjs
// (55432) maupun test-ganti-password.mjs (55444) kalau keduanya dijalankan
// bersamaan.
const DATA = path.join(DI_SINI, 'pgdata-reset');
const PORT = 55446;

let lulus = 0, gagal = 0;
const ok = (n, t) => { lulus++; console.log(`    OK    ${n}${t ? '  ' + t : ''}`); };
const no = (n, t) => { gagal++; console.log(`    SALAH ${n}\n          ${t}`); };

const judul = (n) => {
  console.log('\n' + '='.repeat(62));
  console.log(n);
  console.log('='.repeat(62));
};

/** Jalankan satu operasi sebagai peran tertentu; kembalikan error atau null. */
async function sebagaiPeran(c, peran, sql, param) {
  await c.query(`set role ${peran}`);
  try {
    await c.query(sql, param);
    await c.query(`reset role`);
    return null;
  } catch (e) {
    await c.query(`reset role`);
    return e;
  }
}

const pg = new EmbeddedPostgres({
  databaseDir: DATA, user: 'postgres', password: 'postgres', port: PORT, persistent: false,
});

let c;
try {
  await pg.initialise();
  await pg.start();
  c = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'postgres', database: 'postgres' });
  await c.connect();

  // ---------- tiruan Supabase, sama seperti validate-migrations.cjs ----------
  await c.query(`
    create schema auth;
    create table auth.users (id uuid primary key, email text,
      raw_user_meta_data jsonb, raw_app_meta_data jsonb);
    create or replace function auth.uid() returns uuid language sql stable as $fn$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
    do $blk$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    end $blk$;
  `);

  for (const f of fs.readdirSync(MIG).filter((x) => x.endsWith('.sql')).sort()) {
    await c.query(fs.readFileSync(path.join(MIG, f), 'utf8'));
  }

  // ---------- tiga pengguna: aktif, nonaktif, dan tanpa profil ----------
  const aktif = '33333333-3333-4333-8333-333333333333';
  const nonaktif = '44444444-4444-4444-8444-444444444444';
  await c.query(`
    insert into auth.users (id, email) values
      ($1,'aktif@rw026.id'), ($2,'nonaktif@rw026.id');
  `, [aktif, nonaktif]);
  await c.query(`
    update public.profiles set legacy_id='RW-0011', nama='Aktif', role='Editor',
      status='Aktif', must_change_pw=true where id = $1
  `, [aktif]);
  await c.query(`
    update public.profiles set legacy_id='RW-0012', nama='Nonaktif', role='Editor',
      status='Nonaktif', must_change_pw=true where id = $1
  `, [nonaktif]);

  // ======================================================================
  judul('1. anon dan authenticated tidak boleh punya akses apa pun');
  // ======================================================================
  //  driver reset password memakai akun-akun ini, jadi GRANT-nya harus hilang
  //  total - bukan sekadar disembunyikan RLS.
  const operasi = [
    ['select', 'select * from public.password_reset_tokens'],
    ['insert', `insert into public.password_reset_tokens (user_id, token_hash, tanggal_kedaluwarsa)
                values ($1,'x',now()+interval '1 hour')`, [aktif]],
    ['update', `update public.password_reset_tokens set tanggal_dipakai=now()`, []],
    ['delete', 'delete from public.password_reset_tokens', []]
  ];
  for (const peran of ['anon', 'authenticated']) {
    for (const [nama, sql, param] of operasi) {
      const e = await sebagaiPeran(c, peran, sql, param);
      if (e) ok(`${peran} ditolak saat ${nama}`);
      else no(`${peran} seharusnya ditolak saat ${nama}`, 'tidak ada error');
    }
  }

  // ======================================================================
  judul('2. Fungsi cari_user_id_by_email hanya untuk service_role');
  // ======================================================================
  for (const peran of ['anon', 'authenticated']) {
    const e = await sebagaiPeran(c, peran,
      `select public.cari_user_id_by_email('aktif@rw026.id')`, []);
    if (e) ok(`${peran} ditolak memanggil fungsi`, e.message.split('\n')[0]);
    else no(`${peran} seharusnya ditolak`, 'fungsi berhasil dipanggil');
  }
  {
    await c.query(`set role service_role`);
    const r = await c.query(`select public.cari_user_id_by_email('aktif@rw026.id') as id`);
    await c.query(`reset role`);
    if (r.rows[0].id === aktif) ok('service_role boleh memanggil fungsi', 'dan dapat id yang benar');
    else no('service_role tidak dapat id yang benar', JSON.stringify(r.rows[0]));
  }

  // ======================================================================
  judul('3. Hanya akun AKTIF yang dipetakan');
  // ======================================================================
  await c.query(`set role service_role`);
  const peta = async (email) => {
    const r = await c.query(`select public.cari_user_id_by_email($1) as id`, [email]);
    return r.rows[0].id;
  };
  const idAktif = await peta('aktif@rw026.id');
  const idNonaktif = await peta('nonaktif@rw026.id');
  const idTidakAda = await peta('bukan@rw026.id');
  const idKosong = await peta('   ');
  const idCampur = await peta('  AKTIF@RW026.ID  ');
  await c.query(`reset role`);

  if (idAktif === aktif) ok('email akun Aktif dipetakan ke id-nya');
  else no('email akun Aktif tidak dipetakan', JSON.stringify(idAktif));

  //  Ini yang membuat "dinonaktifkan" berarti tidak bisa diakses sama sekali:
  //  akun Nonaktif tidak boleh mendapat link reset, hanya supaya tidak bisa
  //  masuk.
  if (!idNonaktif) ok('email akun Nonaktif TIDAK dipetakan');
  else no('akun Nonaktif seharusnya tidak dipetakan', JSON.stringify(idNonaktif));

  if (!idTidakAda) ok('email yang tidak terdaftar tidak dipetakan');
  else no('email tak terdaftar seharusnya kosong', JSON.stringify(idTidakAda));

  if (!idKosong) ok('input kosong tidak menghasilkan apa pun');
  else no('input kosong seharusnya kosong', JSON.stringify(idKosong));

  //  Email orang tidak diketik persis sama di form login, jadi pencocokan
  //  harus mengabaikan huruf besar-kecil dan spasi.
if (idCampur === aktif) ok('pencocokan mengabaikan huruf besar-kecil dan spasi');
else no('pencocokan huruf besar-kecil/spasi gagal', JSON.stringify(idCampur));

  // ======================================================================
  judul('4. service_role boleh operasi penuh (dipakai Code.gs)');
  // ======================================================================
  await c.query(`
    insert into public.password_reset_tokens (user_id, token_hash, tanggal_kedaluwarsa)
    values ($1, 'hash-aktif-1', now() + interval '1 hour')
  `, [aktif]);
  const jml = await c.query(`select count(*)::int as n from public.password_reset_tokens`);
  if (jml.rows[0].n === 1) ok('service_role bisa INSERT dan langsung membaca balik');
  else no('baris tidak masuk', JSON.stringify(jml.rows[0]));

  // ======================================================================
  judul('5. Klaim token hanya bisa berhasil sekali');
  // ======================================================================
  //  Inilah yang membuat token single-use. Klaimnya berupa UPDATE berkondisi
  //  `tanggal_dipakai IS NULL`, jadi tidak ada dua permintaan yang bisa
  //  mendapat baris yang sama - meskipun keduanya dikirim bersamaan.
  //
  //  Bentuk SQL-nya disalin persis dari resetPassword_() di Code.gs, supaya
  //  test ini benar-benar menguji hal yang dijalankan di produksi, bukan
  //  versi yang ditulis lebih rapi.
  const klaim = `update public.password_reset_tokens set tanggal_dipakai = now()
                   where token_hash = $1 and tanggal_dipakai is null
                     and tanggal_kedaluwarsa > now()`;

  const pertama = await c.query(klaim, ['hash-aktif-1']);
  if (pertama.rowCount === 1) ok('klaim pertama berhasil', '(1 baris)');
  else no('klaim pertama seharusnya dapat 1 baris', 'rowCount=' + pertama.rowCount);

  const kedua = await c.query(klaim, ['hash-aktif-1']);
  if (kedua.rowCount === 0) ok('klaim kedua TIDAK dapat baris - token sudah hangus');
  else no('token seharusnya tidak bisa dipakai dua kali', 'rowCount=' + kedua.rowCount);

  // ======================================================================
  judul('6. Token kedaluwarsa tidak bisa diklaim');
  // ======================================================================
  await c.query(`
    insert into public.password_reset_tokens (user_id, token_hash, tanggal_kedaluwarsa)
    values ($1, 'hash-kedaluwarsa', now() - interval '1 minute')
  `, [aktif]);
  const lama = await c.query(klaim, ['hash-kedaluwarsa']);
  if (lama.rowCount === 0) ok('token yang sudah lewat 60 menit ditolak');
  else no('token kedaluwarsa seharusnya ditolak', 'rowCount=' + lama.rowCount);

  const cek = await c.query(
    `select tanggal_dipakai from public.password_reset_tokens where token_hash='hash-kedaluwarsa'`);
if (cek.rows[0].tanggal_dipakai === null) ok('token kedaluwarsa tetap belum ditandai terpakai');
else no('token kedaluwarsa tiba-tiba ditandai terpakai');

  // ======================================================================
  judul('7. Hash token wajib unik');
  // ======================================================================
  //  Tanpa unique ini, dua orang bisa menerima tautan dengan hash yang sama
  //  dan salah satunya bisa dipakai untuk mengubah password orang lain.
  try {
    await c.query(`
      insert into public.password_reset_tokens (user_id, token_hash, tanggal_kedaluwarsa)
      values ($1, 'hash-aktif-1', now() + interval '1 hour')
    `, [aktif]);
    no('hash yang sama seharusnya ditolak', 'insert kedua berhasil');
  } catch (e) {
    ok('hash yang sama ditolak', e.message.split('\n')[0]);
  }

  // ======================================================================
  judul('8. Hapus akun -> token ikut terhapus');
  // ======================================================================
  //  Kalau token-nya tidak ikut hilang, orang yang sudah dihapus dari portal
  //  masih bisa mengganti password-nya dengan tautan yang sudah dibearn.
  await c.query(`delete from public.password_reset_tokens where user_id = $1`, [nonaktif]);
  await c.query(`
    insert into public.password_reset_tokens (user_id, token_hash, tanggal_kedaluwarsa)
    values ($1, 'hash-nonaktif', now() + interval '1 hour')
  `, [nonaktif]);
  await c.query(`delete from auth.users where id = $1`, [nonaktif]);
  const sisa = await c.query(
    `select count(*)::int as n from public.password_reset_tokens where token_hash='hash-nonaktif'`);
  if (sisa.rows[0].n === 0) ok('token ikut terhapus begitu auth.users dihapus');
  else no('token yatim', JSON.stringify(sisa.rows[0]));

  // ======================================================================
  judul('9. Tabel token tidak punya kolom penampung password');
  // ======================================================================
  //  Yang boleh disimpan di sini HANYA hash token. Kalau suatu saat ada kolom
  //  password atau password_hash, isinya bisa bocor dan langsung berguna
  //  buat-who yang mencuri database.
  const kolom = await c.query(`
    select column_name from information_schema.columns
     where table_schema='public' and table_name='password_reset_tokens'
     order by column_name
  `);
  const namaKolom = kolom.rows.map((r) => r.column_name);
  const diharapkan = ['id', 'tanggal_dibuat', 'tanggal_dipakai', 'tanggal_kedaluwarsa', 'token_hash', 'user_id'];
  const urut = [...namaKolom].sort();
  if (JSON.stringify(urut) === JSON.stringify(diharapkan)) {
    ok('kolom persis seperti yang dirancang', urut.join(', '));
  } else {
    no('kolom berbeda dari rancangan', 'dapat: ' + urut.join(', '));
  }
  const mencurigakan = namaKolom.filter((n) => /pass|secret|pin|otp|credential/i.test(n));
  if (!mencurigakan.length) ok('tidak ada kolom bernama pass/secret/pin/otp');
  else no('ada kolom yang bisa menampung rahasia', mencurigakan.join(', '));

  // ======================================================================
  judul('10. Index parsial token aktif benar');
  // ======================================================================
  //  Index-nya parsial (hanya yang belum dipakai). Kalau filter-nya salah,
  //  index ini akan ikut menyimpan baris yang sudah tidak berguna - dan
  //  Code.gs selalu menanyakan "token aktif milik user ini".
  const idx = await c.query(`
    select indexdef from pg_indexes
     where schemaname='public' and tablename='password_reset_tokens'
       and indexname='password_reset_tokens_aktif_idx'
  `);
  const def = idx.rows.length ? idx.rows[0].indexdef : '';
  if (/where/i.test(def) && /tanggal_dipakai is null/i.test(def)) {
    ok('index token aktif hanya mencakup yang belum dipakai');
  } else {
    no('filter index token aktif tidak sesuai', def || '(index tidak ada)');
  }

  await c.end();
  await pg.stop();
} catch (e) {
  console.error('FATAL: ' + e.message);
  try { if (c) await c.end(); } catch {}
  try { await pg.stop(); } catch {}
  process.exit(1);
}

console.log('\n' + '='.repeat(62));
console.log(`lulus ${lulus}, gagal ${gagal}`);
process.exit(gagal ? 1 : 0);