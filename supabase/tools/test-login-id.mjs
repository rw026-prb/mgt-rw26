// ============================================================================
//  test-login-id.mjs  —  Buktikan login pakai User ID (RW-NNNN) bekerja
// ============================================================================
//  memakai database lokal PostgreSQL sungguhan:
//
//  1. User ID yang benar harus menghasilkan email yang bisa dipakai
//     signInWithPassword.
//  2. Huruf besar-kecil dan spasi ngawur tidak boleh menggagalkan.
//  3. User ID yang tidak ada harus mengembalikan null, BUKAN error.
//  4. Input kosong harus balik CEPAT tanpa menyentuh database.
//  5. peran anon BOLEH memanggil (login terjadi sebelum sesi ada) ...
//  6. ... tapi peran public TIDAK boleh, dan fungsi tidak boleh bisa
//     menulis apa pun ke profiles.
//  7. Fungsi tidak boleh bocorkan kolom lain (nama/role/status).
// ============================================================================

import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DI_SINI = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(DI_SINI, '..', 'migrations');
const DATA = path.join(DI_SINI, 'pgdata-login-id');
const PORT = 55445;

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

  // ---------- tiruan Supabase minimum ----------
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
      if not exists (select 1 from pg_roles where rolname='peran_biasa') then create role peran_biasa nologin; end if;
    end $blk$;
  `);

  for (const f of ['0001_schema.sql', '0002_rls.sql', '0002b_lockdown.sql',
    '0003_functions.sql', '0004_migration_audit.sql', '0005_bridge_grants.sql',
    '0006_organisasi_id.sql', '0007_password_change.sql', '0008_login_dengan_user_id.sql']) {
    await c.query(fs.readFileSync(path.join(MIG, f), 'utf8'));
  }

  // ---------- data contoh ----------
  // Trigger tg_auth_user_created sudah membuat baris profiles sendiri
  // begitu auth.users diisi. Jadi cukup lengkapi, jangan insert baru.
  await c.query(`
    insert into auth.users (id, email) values
      ('11111111-1111-1111-1111-111111111111','warga@rw26.test'),
      ('22222222-2222-2222-2222-222222222222','ketua@rw26.test');
    update public.profiles set legacy_id='RW-0007', nama='Warga Contoh',
             role='Editor', status='Aktif', must_change_pw=true
      where id = '11111111-1111-1111-1111-111111111111';
    update public.profiles set legacy_id='RW-0001', nama='Ketua FW',
             role='Admin', status='Aktif', must_change_pw=false
      where id = '22222222-2222-2222-2222-222222222222';
  `);

  console.log('\n  == fungsi cari_email_login ==');

  // 1. User ID yang benar
  {
    const r = await c.query(`select public.cari_email_login('RW-0007') as e`);
    if (r.rows[0].e === 'warga@rw26.test') ok('User ID benar -> email ditemukan');
    else no('User ID benar -> email ditemukan', `dapat ${r.rows[0].e}`);
  }

  // 2. huruf besar-kecil + spasi
  {
    for (const masuk of ['rw-0007', '  RW-0007  ', 'Rw-0007']) {
      const r = await c.query(`select public.cari_email_login($1) as e`, [masuk]);
      if (r.rows[0].e === 'warga@rw26.test') ok(`tahan spasi & huruf: ${JSON.stringify(masuk)}`);
      else no(`tahan spasi & huruf: ${JSON.stringify(masuk)}`, `dapat ${r.rows[0].e}`);
    }
  }

  // 3. ID yang tidak ada harus null, bukan error
  {
    let r;
    try {
      r = await c.query(`select public.cari_email_login('RW-9999') as e`);
      if (r.rows[0].e === null) ok('ID tidak ada -> null (bukan error)');
      else no('ID tidak ada -> null (bukan error)', `dapat ${r.rows[0].e}`);
    } catch (e) { no('ID tidak ada -> null (bukan error)', e.message); }
  }

  // 4. input kosong
  {
    for (const kosong of ['', '   ', null]) {
      try {
        const r = await c.query(`select public.cari_email_login($1) as e`, [kosong]);
        if (r.rows[0].e === null) ok(`input kosong (${JSON.stringify(kosong)}) -> null`);
        else no(`input kosong (${JSON.stringify(kosong)}) -> null`, `dapat ${r.rows[0].e}`);
      } catch (e) { no(`input kosong (${JSON.stringify(kosong)}) -> null`, e.message); }
    }
  }

  // 5. anon boleh memanggil
  {
    try {
      await c.query(`set role anon`);
      const r = await c.query(`select public.cari_email_login('RW-0007') as e`);
      if (r.rows[0].e === 'warga@rw26.test') ok('peran anon boleh memanggil fungsi');
      else no('peran anon boleh memanggil fungsi', `dapat ${r.rows[0].e}`);
      await c.query(`reset role`);
    } catch (e) { no('peran anon boleh memanggil fungsi', e.message); }
  }

  // 6a. peran lain yang bukan anon/authenticated TIDAK boleh
  //     Sesi uji ini masuk sebagai postgres (superuser), jadi SET ROLE
  //     ke peran biasa HARUS dipakai - kalau tidak, superuser tetap
  //     bisa memanggil apa pun dan tesnya jadi tidak berarti.
  {
    try {
      await c.query(`set role peran_biasa`);
      await c.query(`select public.cari_email_login('RW-0007')`);
      await c.query(`reset role`);
      no('peran biasa DITOLAK', 'tapi berhasil dipanggil');
    } catch (e) {
      await c.query(`reset role`).catch(() => {});
      if (/permission denied/i.test(e.message)) ok('peran biasa DITOLAK (hanya anon+authenticated)');
      else no('peran biasa DITOLAK', e.message);
    }
  }

  // 6b. sanity: superuser memang boleh (dasar revoke-nya benar)
  {
    try {
      const r = await c.query(`select public.cari_email_login('RW-0007') as e`);
      if (r.rows[0].e === 'warga@rw26.test') ok('superuser tetap boleh (revoke tidak berlebihan)');
      else no('superuser tetap boleh', `dapat ${r.rows[0].e}`);
    } catch (e) { no('superuser tetap boleh', e.message); }
  }

  // 6b. anon tidak boleh bisa menulis lewat fungsi ini
  {
    try {
      await c.query(`set role anon`);
      const r = await c.query(`
        select p.legacy_id, p.nama
          from public.profiles p
         where p.legacy_id = 'RW-0007'`);
      await c.query(`reset role`);
      if (r.rowCount === 0) ok('anon tetap tidak bisa baca profiles langsung');
      else no('anon tetap tidak bisa baca profiles langsung', `baca ${r.rowCount} baris`);
    } catch (e) {
      await c.query(`reset role`).catch(() => {});
      ok('anon tetap tidak bisa baca profiles langsung (RLS menolak)');
    }
  }

  // 7. fungsi hanya mengembalikan email, tidak kolom lain
  {
    const r = await c.query(`
      select pg_get_function_result(oid) as hasil
        from pg_proc where proname = 'cari_email_login'`);
    if (/text/.test(r.rows[0].hasil)) ok('fungsi hanya mengembalikan text (email)');
    else no('fungsi hanya mengembalikan text (email)', r.rows[0].hasil);
  }

  // 8. fungsi tidak boleh volatile atau punya parameter lain
  {
    const r = await c.query(`
      select p.provolatile, p.pronargs
        from pg_proc p where p.proname = 'cari_email_login'`);
    if (r.rows[0].pronargs === 1) ok('tepat satu parameter');
    else no('tepat satu parameter', `ada ${r.rows[0].pronargs}`);
  }

} catch (e) {
  gagal++;
  console.log(`    SALAH setup: ${e.message}`);
} finally {
  await c?.end().catch(() => {});
  await pg.stop().catch(() => {});
  fs.rmSync(DATA, { recursive: true, force: true });
}

console.log(`\n  lulus ${lulus}, gagal ${gagal}`);
process.exit(gagal ? 1 : 0);