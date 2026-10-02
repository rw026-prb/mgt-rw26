// ============================================================================
//  diagnose-editor.mjs  —  Buktikan masalah Editor + perbaikannya sudah benar
// ============================================================================
//  Skenario yang diuji, memakai database lokal PostgreSQL sungguhan:
//
//  1. Editor mencoba menurunkan flag must_change_pw dengan UPDATE biasa.
//     Ini harus DITOLAK - inilah bug yang membuat Editor tersangkut
//     selamanya di halaman ganti password.
//
//  2. Editor memanggil fungsi complete_password_change().
//     Harus BERHASIL dan hanya menyentuh barisnya sendiri.
//
//  3. Editor tidak boleh menurunkan flag milik orang lain.
//
//  4. Peran anon tidak boleh memanggil fungsi itu sama sekali.
// ============================================================================

import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DI_SINI = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(DI_SINI, '..', 'migrations');
const DATA = path.join(DI_SINI, 'pgdata-pwq');
const PORT = 55444;

let lulus = 0, gagal = 0;
const ok = (n, t) => { lulus++; console.log(`    OK    ${n}${t ? '  ' + t : ''}`); };
const no = (n, t) => { gagal++; console.log(`    SALAH ${n}\n          ${t}`); };

const pg = new EmbeddedPostgres({
  databaseDir: DATA, user: 'postgres', password: 'postgres', port: PORT, persistent: false,
});

let c;
try {
  await pg.initialise();
  await pg.start();
  c = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'postgres', database: 'postgres' });
  await c.connect();

  // ---------- siapkan tiruan Supabase ----------
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

  // ---------- siapkan dua pengguna ----------
  const editor = '11111111-1111-4111-8111-111111111111';
  const admin = '22222222-2222-4222-8222-222222222222';
  await c.query(`
    insert into auth.users (id, email) values ($1,'editor@rw026.id'), ($2,'admin@rw026.id');
  `, [editor, admin]);
  // Trigger tg_auth_user_created sudah membuat baris profiles dengan nilai
  // minimal. Yang perlu dilakukan adalah melengkapinya, bukan insert baru.
  await c.query(`
    update public.profiles set legacy_id='RW-0003', nama='Sudarwanto', role='Editor',
      status='Aktif', menu_access='{kas,berita}', must_change_pw=true
    where id = $1
  `, [editor]);
  await c.query(`
    update public.profiles set legacy_id='RW-0001', nama='Yunianto', role='Admin',
      status='Aktif', menu_access='{}', must_change_pw=true
    where id = $1
  `, [admin]);

  console.log('\n' + '='.repeat(62));
  console.log('1. Editor mencoba UPDATE biasa (cara lama)');
  console.log('='.repeat(62));
  // PENTING: RLS tidak melempar error. Policy yang tidak cocok hanya membuat
  // UPDATE tidak menyentuh baris mana pun, dan PostgREST mengembalikan 200
  // dengan 0 baris. Kalau test ini mengharapkan error, ia akan selalu gagal
  // - padahal aturan RLS-nya sudah benar bekerja.
  await c.query(`select set_config('request.jwt.claim.sub', $1, false)`, [editor]);
  await c.query(`set role authenticated`);
  const lama = await c.query(`update public.profiles set must_change_pw = false where id = $1`, [editor]);
  if (lama.rowCount === 0) {
    ok('UPDATE biasa tidak menyentuh baris mana pun', '(RLS menyaring diam-diam, tidak error)');
  } else {
    no('UPDATE biasa seharusnya tidak berhasil', 'rowCount=' + lama.rowCount);
  }
  const masih = await c.query(`select must_change_pw from public.profiles where id = $1`, [editor]);
  if (masih.rows[0].must_change_pw === true) {
    ok('flag Editor masih true - inilah yang membuat dia tersangkut selamanya');
  } else {
    no('flag Editor seharusnya masih true', JSON.stringify(masih.rows[0]));
  }

  console.log('\n' + '='.repeat(62));
  console.log('2. Editor memanggil complete_password_change()');
  console.log('='.repeat(62));
  const r2 = await c.query(`select public.complete_password_change() as ok`);
  if (r2.rows[0].ok === true) ok('fungsi berhasil dipanggil');
  else no('fungsi mengembalikan false');
  const after = await c.query(`select must_change_pw, login_terakhir from public.profiles where id = $1`, [editor]);
  if (after.rows[0].must_change_pw === false) ok('flag must_change_pw sudah turun');
  else no('flag tidak turun', JSON.stringify(after.rows[0]));

  console.log('\n' + '='.repeat(62));
  console.log('3. Fungsi hanya boleh menyentuh baris sendiri');
  console.log('='.repeat(62));
  // Editor memanggilnya lagi. Yang diperiksa bukan nilai balik fungsi - fungsi
  // selalu mengembalikan true selama barisnya ada - tapi apakah baris orang
  // lain ikut berubah.
  await c.query(`select set_config('request.jwt.claim.sub', $1, false)`, [editor]);
  await c.query(`select public.complete_password_change()`);

  // Sebagai Editor, baris milik Admin bahkan tidak terlihat - RLS menyaring
  // SELECT juga, bukan hanya UPDATE. Itu sudah bukti bahwa fungsi tidak
  // mungkin menyentuh baris orang lain.
  const terlihat = await c.query(`select must_change_pw from public.profiles where id = $1`, [admin]);
  if (terlihat.rowCount === 0) {
    ok('baris milik Admin tidak terlihat oleh Editor', '(RLS menyaring SELECT juga)');
  } else if (terlihat.rows[0].must_change_pw === true) {
    ok('flag milik Admin tetap true');
  } else {
    no('baris milik Admin ikut berubah', JSON.stringify(terlihat.rows[0]));
  }

  // Lalu dicek sebagai superuser, untuk memastikan nilainya benar-benar tidak
  // berubah di database - bukan sekadar tersembunyi oleh RLS.
  await c.query(`reset role`);
  const asli = await c.query(`select must_change_pw from public.profiles where id = $1`, [admin]);
  if (asli.rows[0] && asli.rows[0].must_change_pw === true) {
    ok('di database: flag Admin tetap true');
  } else {
    no('di database: flag Admin ikut turun', JSON.stringify(asli.rows[0]));
  }
  await c.query(`set role authenticated`);

  console.log('\n' + '='.repeat(62));
  console.log('4. Peran anon tidak boleh memanggil fungsi itu');
  console.log('='.repeat(62));
  await c.query(`reset role`);
  await c.query(`set role anon`);
  try {
    await c.query(`select public.complete_password_change()`);
    no('anon seharusnya DITOLAK', 'tapi berhasil');
  } catch (e) {
    ok('anon ditolak', e.message.split('\n')[0]);
  }
  await c.query(`reset role`);

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
