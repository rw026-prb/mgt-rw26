// ============================================================================
//  validate-migrations.cjs
// ============================================================================
//  Menjalankan seluruh file di supabase/migrations/ pada PostgreSQL sungguhan
//  di komputer lokal, lalu menguji perilakunya. Tujuannya: menangkap error
//  SQL dan bug perhitungan TANPA perlu paste manual ke Supabase SQL Editor.
//
//  Database yang dipakai adalah embedded-postgres, yaitu binary PostgreSQL
//  asli (bukan tiruan). Skema `auth` dan peran `anon` / `authenticated`
//  dibuat tiruan supaya file migrasi bisa jalan di luar Supabase.
//
//  CARA MENJALANKAN
//    cd supabase/tools
//    npm install embedded-postgres pg
//    node validate-migrations.cjs
//
//  SYARAT NODE 18+ (butuh fetch bawaan untuk mengunduh binary PostgreSQL).
//
//  CATATAN: folder node_modules/ dan pgdata/ yang dibuat di sini jangan
//  di-commit ke git.
// ============================================================================

const EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIG_DIR = path.join(__dirname, '..', 'migrations');
const FILES = ['0001_schema.sql', '0002_rls.sql', '0002b_lockdown.sql', '0003_functions.sql', '0004_migration_audit.sql', '0005_bridge_grants.sql'];

const MOCK_SUPABASE = `
create schema if not exists auth;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text,
  raw_user_meta_data  jsonb,
  raw_app_meta_data   jsonb
);

create or replace function auth.uid() returns uuid
language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;

do $blk$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$blk$;
`;

(async () => {
  const pg = new EmbeddedPostgres({
    databaseDir: path.join(__dirname, 'pgdata'),
    user: 'postgres',
    password: 'postgres',
    port: 55432,
    persistent: false,
  });

  let client;
  try {
    await pg.initialise();
    await pg.start();
    client = new Client({ host: '127.0.0.1', port: 55432, user: 'postgres', password: 'postgres', database: 'postgres' });
    await client.connect();

    await client.query(MOCK_SUPABASE);
    console.log('mock auth.* + peran anon/authenticated siap\n');

    let failed = 0;
    for (const f of FILES) {
      const sql = fs.readFileSync(path.join(MIG_DIR, f), 'utf8');
      try {
        await client.query(sql);
        console.log(`OK    ${f}`);
      } catch (e) {
        failed++;
        console.log(`GAGAL ${f}`);
        console.log('  ' + e.message.split('\n').join('\n  '));
      }
    }

    if (failed) {
      console.log(`\n${failed} file gagal. Test query dilewati.`);
      await client.end();
      await pg.stop();
      process.exit(1);
    }

    // ---------- test query (identik dengan yanginstructions user) ----------
    const tests = [
      {
        nama: 'kas_report(7, 2026)  -> harus AGUSTUS',
        sql: `begin;
              insert into public.kas (tanggal, uraian, masuk, keluar, status, created_by_name) values
                ('2026-07-15', 'Iuran Juli 2026',     500000,     0, 'Disetujui', 'Bendahara'),
                ('2026-08-02', 'Iuran Agustus 2026',  600000,     0, 'Disetujui', 'Bendahara'),
                ('2026-08-10', 'Bayar listrik',            0, 150000, 'Disetujui', 'Bendahara'),
                ('2026-08-15', 'Bantuan warna-warni',750000,     0, 'Disetujui', 'Bendahara'),
                ('2026-08-20', 'Belum disetujui',      300000,     0, 'Menunggu',  'Editor'),
                ('2026-08-25', 'Ditolak',              200000,     0, 'Ditolak',   'Editor');
              select public.kas_report(7, 2026) as hasil;
              rollback;`
      },
      {
        nama: 'kas_cash_flow(6..7, 2026) -> Juli s.d. Agustus',
        sql: `begin;
              insert into public.kas (tanggal, uraian, masuk, keluar, status, created_by_name) values
                ('2026-07-15', 'Iuran Juli 2026',     500000,     0, 'Disetujui', 'Bendahara'),
                ('2026-08-02', 'Iuran Agustus 2026',  600000,     0, 'Disetujui', 'Bendahara'),
                ('2026-08-10', 'Bayar listrik',            0, 150000, 'Disetujui', 'Bendahara'),
                ('2026-08-15', 'Bantuan warna-warni',750000,     0, 'Disetujui', 'Bendahara'),
                ('2026-08-20', 'Belum disetujui',      300000,     0, 'Menunggu',  'Editor'),
                ('2026-08-25', 'Ditolak',              200000,     0, 'Ditolak',   'Editor');
              select public.kas_cash_flow(6, 2026, 7, 2026) as hasil;
              rollback;`
      },
      {
        nama: 'get_public_content() -> bentuk JSON',
        sql: `begin;
              insert into public.himbauan (id, judul, status) values
                ('HIM-001','Slide aktif','Aktif'), ('HIM-002','Slide mati','Nonaktif');
              insert into public.pengumuman (id, judul, tanggal, status) values
                ('INF-001','Pengumuman test','2026-08-01','Aktif');
              insert into public.fasum (id, nama) values ('FAS-001','Balai RW');
              insert into public.organisasi (grup, legacy_id, jabatan, nama, sort_order)
                values ('rw','ORG-001','Ketua','Bapak Sutrisno', 1);
              insert into public.statistik_warga (id, nama_kategori, nilai) values ('STT-001','Total Warga',1175);
              select public.get_public_content() as hasil;
              rollback;`
      },
      {
        nama: 'anon TIDAK boleh punya GRANT select di kas (harus=false)',
        sql: `select has_table_privilege('anon','public.kas','select') as anon_boleh_select_kas,
                      has_table_privilege('anon','public.profiles','select') as anon_boleh_select_profiles,
                      has_table_privilege('anon','public.visitor_log','insert') as anon_boleh_catat,
                      has_table_privilege('anon','public.himbauan','select') as anon_boleh_baca_himbauan;`
      },
      {
        nama: 'RLS himbauan: anon hanya melihat status Aktif',
        sql: `begin;
              insert into public.himbauan (id, judul, status) values
                ('HIM-001','Aktif','Aktif'), ('HIM-002','Nonaktif','Nonaktif');
              set local role anon;
              select count(*) as anon_melihat from public.himbauan;
              reset role;
              select count(*) as admin_melihat from public.himbauan;
              rollback;`
      },
      {
        nama: 'trigger id otomatis (himbauan tanpa id)',
        sql: `begin;
              insert into public.himbauan (judul, status) values ('Tanpa id','Aktif');
              select id, judul from public.himbauan where judul = 'Tanpa id';
              rollback;`
      },
      {
        nama: 'visitor_stats harus DITOLAK saat tidak login sebagai Super Admin',
        sql: `select public.visitor_stats();`
      },
      {
        nama: 'list_kas harus DITOLAK saat tidak login',
        sql: `select public.list_kas();`
      },
      {
        nama: 'kas_cash_flow rentang terbalik -> array kosong',
        sql: `select public.kas_cash_flow(7, 2026, 6, 2026) as hasil;`
      },
      {
        nama: 'kas_cash_flow bulan tanpa transaksi tetap muncul (nilai 0)',
        sql: `begin;
              insert into public.kas (tanggal, uraian, masuk, status, created_by_name)
                values ('2026-05-10','Iuran Mei',100000,'Disetujui','X');
              select public.kas_cash_flow(3, 2026, 6, 2026) as hasil;
              rollback;`
      },
      {
        nama: 'kas_cash_flow 6 bulan termasuk bulan kosong',
        sql: `select public.kas_cash_flow(0, 2026, 5, 2026) as hasil;`
      },
      {
        nama: 'update_month_index: kas_report(0,2026)=Januari vs kas_report(6,2026)=Juli',
        sql: `begin;
              insert into public.kas (tanggal, uraian, masuk, status, created_by_name) values
                ('2026-01-05','Januari',111,'Disetujui','X'),
                ('2026-07-05','Juli',777,'Disetujui','X');
              select public.kas_report(0, 2026) -> 'rincianMasuk' as januari,
                     public.kas_report(6, 2026) -> 'rincianMasuk' as juli;
              rollback;`
      },
      {
        nama: 'himbauan tanpa id -> trigger mengisi HIM-002',
        sql: `begin;
              insert into public.himbauan (id, judul, status) values ('HIM-001','A','Aktif');
              insert into public.himbauan (judul, status) values ('Tanpa id','Aktif');
              select id, judul from public.himbauan order by id;
              rollback;`
      },
      {
        nama: 'kas masuk=0 keluar=0 harus DITOLAK (CHECK constraint)',
        sql: `insert into public.kas (tanggal, uraian, masuk, keluar, status, created_by_name)
              values (current_date, 'Nol', 0, 0, 'Menunggu', 'X');`
      },
      {
        nama: 'kas metode tidak valid harus DITOLAK',
        sql: `insert into public.kas (tanggal, uraian, masuk, metode, status, created_by_name)
              values (current_date, 'Uji', 1000, 'Transfer Bank', 'Menunggu', 'X');`
      },
      {
        nama: 'organisasi: grup + legacy_id harus unik',
        sql: `begin;
              insert into public.organisasi (grup, legacy_id, jabatan, nama) values ('rw','ORG-001','A','A');
              insert into public.organisasi (grup, legacy_id, jabatan, nama) values ('rw','ORG-001','B','B');
              rollback;`
      },
      {
        nama: 'organisasi: ORG-001 boleh sama di grup berbeda',
        sql: `begin;
              insert into public.organisasi (grup, legacy_id, jabatan, nama) values ('rw','ORG-001','A','A');
              insert into public.organisasi (grup, legacy_id, jabatan, nama) values ('pkk','ORG-001','B','B');
              select grup, legacy_id, nama from public.organisasi order by grup;
              rollback;`
      },
      {
        nama: 'auth.users membuat otomatis baris profiles + legacy_id RW-0001',
        sql: `begin;
              insert into auth.users (email, raw_user_meta_data)
                values ('budi@rw026.id', '{"nama":"Budi Santoso"}');
              select p.legacy_id, p.nama, p.role, p.status, p.must_change_pw
                from public.profiles p join auth.users a on a.id = p.id;
              rollback;`
      },
      {
        nama: 'RLS profiles: authenticated tanpa login tidak boleh apa-apa',
        sql: `set local role authenticated;
              select count(*) as profiles_terlihat from public.profiles;`
      }
    ];

    for (const t of tests) {
      try {
        const raw = await client.query(t.sql);
        // pg mengembalikan object tunggal untuk satu pernyataan,
        // dan array untuk beberapa pernyataan.
        const r = Array.isArray(raw) ? raw : [raw];
        console.log(`\n=== ${t.nama} ===`);
        let printed = 0;
        for (const row of r) {
          if (row && row.rows && row.rows.length) {
            for (const data of row.rows) console.log(JSON.stringify(data, null, 2));
            printed++;
          }
        }
        if (!printed) console.log('(tidak ada baris hasil)');
      } catch (e) {
        // Transaksi jadi abort setelah error. HARUS di-rollback supaya test
        // berikutnya tidak ikut gagal.
        try { await client.query('rollback'); } catch (_) {}
        console.log(`\n=== ${t.nama} ===`);
        console.log('  ' + e.message.split('\n')[0]);
      }
    }

    await client.end();
    await pg.stop();
  } catch (e) {
    console.error('FATAL: ' + e.message);
    try { if (client) await client.end(); } catch (_) {}
    try { await pg.stop(); } catch (_) {}
    process.exit(1);
  }
})();


