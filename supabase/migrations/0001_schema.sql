-- ============================================================================
--  0001_schema.sql  —  Struktur tabel Portal RW 026
-- ============================================================================
--  Sumber data: Google Sheets (dibaca lewat tools/migrate-sheets-to-supabase.mjs)
--
--  Yang TIDAK ada di file ini (sengaja, ikut migrasi di 0002_rls.sql):
--    - Row Level Security / policy
--    - Function laporan (kas_report, kas_cash_flow, ...)
--
--  Catatan penting untuk pembaca kode:
--    1. Kolom `grup` (bukan `group`) — "group" itu keyword reserved di PostgreSQL
--       dan bikin painful setiap kali harus di-kutip. Function laporan nanti
--       tetap mengembalikan field bernama `group` supaya Website-RW26 tidak berubah.
--    2. Semua tanggal TIDAK disimpan sebagai teks "DD/MM/YYYY" seperti di Sheets.
--       Sekarang jadi tipe `date` / `timestamptz` beneran, jadi bisa di-sort
--       dan di-filter di database.
--    3. Kolom `*_file_id` + `*_url` menggantikan formula =HYPERLINK(...) di
--       Sheets. Links ke foto tetap di Google Drive (tidak dipindah).
-- ============================================================================
--
--  CATATAN JALANKAN:
--  File ini dibungkus `begin; ... commit;`. Kalau ada satu baris yang gagal,
--  SELURUH file dibatalkan otomatis dan database tidak berubah sama sekali.
--  Aman untuk dijalankan berulang kali.
-- ============================================================================

begin;

-- Catatan: gen_random_uuid() sudah jadi bagian inti PostgreSQL 13+, jadi
-- tidak perlu `create extension pgcrypto` seperti di server lama.

-- ----------------------------------------------------------------------------
--  Helper: bikin ID gaya lama (BRT-001, INF-002, HIM-003, ...)
--  Sheets memakai penomoran urut berbasis prefix. Kita pertahankan supaya
--  admin tidak bingung melihat "BRT-018" mendadak jadi UUID.
--
--  `security definer` wajib di sini: fungsi ini menjalankan SELECT ke tabel
--  tujuan. Tanpa itu, trigger akan gagal begitu RLS diaktifkan di 0002_rls.sql
--  karena peran yang melakukan INSERT tidak punya hak baca.
-- ----------------------------------------------------------------------------
create or replace function public.next_prefixed_id(
  p_table  regclass,
  p_column text,
  p_prefix text,
  p_width  int default 3
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $func$
declare
  v_next integer;
begin
  execute format(
    $q$select coalesce(max(nullif(regexp_replace(%I, '\D', '', 'g'), '')::integer), 0) + 1
         from %s
        where %I like $1$q$,
    p_column, p_table, p_column
  )
  into v_next
  using p_prefix || '%';

  return p_prefix || lpad(v_next::text, greatest(p_width, 1), '0');
end;
$func$;

comment on function public.next_prefixed_id(regclass, text, text, int) is
  'Menghasilkan ID berikutnya dengan prefix, cth. BRT-004. Dipakai trigger BEFORE INSERT.';


-- Trigger generik: isi kolom `id` bila INSERT tidak menyertakan id.
create or replace function public.tg_fill_id()
returns trigger
language plpgsql
as $func$
begin
  if new.id is null or btrim(new.id) = '' then
    new.id := public.next_prefixed_id(
      tg_table_schema || '.' || tg_table_name, 'id', tg_argv[0], coalesce(tg_argv[1]::int, 3)
    );
  end if;
  return new;
end;
$func$;

-- Trigger generik: isi `legacy_id` (dipakai profiles, ID-nya RD-NNNN 4 digit).
create or replace function public.tg_fill_legacy_id()
returns trigger
language plpgsql
as $func$
begin
  if new.legacy_id is null or btrim(new.legacy_id) = '' then
    new.legacy_id := public.next_prefixed_id(
      tg_table_schema || '.' || tg_table_name, 'legacy_id', tg_argv[0], coalesce(tg_argv[1]::int, 4)
    );
  end if;
  return new;
end;
$func$;

-- Trigger generik: set updated_at = now() setiap UPDATE.
create or replace function public.tg_touch()
returns trigger
language plpgsql
as $func$
begin
  new.updated_at := now();
  return new;
end;
$func$;


-- ============================================================================
--  profiles  —  pengganti sheet `user` (spreadsheet 1MYvidwDFe…)
-- ============================================================================
--  Kolom `Password Hash` dari Sheets SENGAJA TIDAK dimigrasikan.
--  Password dikelola Supabase Auth (tabel auth.users), bukan tabel ini.
--  `nama` ikut disimpan karena beberapa modul menampilkan nama pembuat
--  transaksi tanpa perlu join (mis. daftar approve kas).
create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  legacy_id      text unique not null,
  nama           text not null check (btrim(nama) <> ''),
  no_hp          text,
  role           text not null default 'Editor'
                 check (role in ('Super Admin', 'Admin', 'Editor')),
  wilayah        text not null default 'RW026',
  status         text not null default 'Aktif'
                 check (status in ('Aktif', 'Nonaktif')),
  menu_access    text[] not null default '{}',
  must_change_pw boolean not null default true,
  login_terakhir timestamptz,
  tanggal_dibuat timestamptz not null default now()
);

create trigger profiles_legacy_id
  before insert on public.profiles
  for each row execute function public.tg_fill_legacy_id('RW-', '4');

create index profiles_role_idx   on public.profiles (role);
create index profiles_status_idx on public.profiles (status);


-- ============================================================================
--  himbauan  —  sheet `himbauan` (spreadsheet 1CnjK2IQ2bAA…)
-- ============================================================================
--  Sheets: ID, JUDUL, KATEGORI, GAMBAR (=HYPERLINK), STATUS
--  Kolom GAMBAR dipecah jadi image_file_id + image_url.
--  ID di Sheets polos angka ("1".."5"); dinormalisasi jadi "HIM-001".
create table public.himbauan (
  id            text primary key,
  judul         text not null check (btrim(judul) <> ''),
  kategori      text not null default 'Informasi',
  image_file_id text,
  image_url     text,
  status        text not null default 'Aktif' check (status in ('Aktif', 'Nonaktif')),
  updated_at    timestamptz not null default now()
);

create trigger himbauan_id
  before insert on public.himbauan
  for each row execute function public.tg_fill_id('HIM-', '3');

create trigger himbauan_touch
  before update on public.himbauan
  for each row execute function public.tg_touch();

create index himbauan_status_idx on public.himbauan (status);


-- ============================================================================
--  pengumuman  —  sheet `informasi` (spreadsheet 15qG8a0brYTc…)
-- ============================================================================
--  Sheets: ID, Judul, Kategori, Ringkasan, Tanggal, Status
--  `ringkasan` berisi HTML yang sudah disanitasi. Sanitasi BERHENTI di client +
--  fungsi JS; database hanya menyimpan apa adanya.
create table public.pengumuman (
  id         text primary key,
  judul      text not null check (btrim(judul) <> ''),
  kategori   text not null default 'Informasi',
  ringkasan  text not null default '',
  tanggal    date not null default current_date,
  status     text not null default 'Aktif' check (status in ('Aktif', 'Nonaktif')),
  updated_at timestamptz not null default now()
);

create trigger pengumuman_id
  before insert on public.pengumuman
  for each row execute function public.tg_fill_id('INF-', '3');

create trigger pengumuman_touch
  before update on public.pengumuman
  for each row execute function public.tg_touch();

create index pengumuman_status_idx  on public.pengumuman (status);
create index pengumuman_tanggal_idx on public.pengumuman (tanggal desc);


-- ============================================================================
--  fasum  —  sheet `fasum` (spreadsheet 1omrKdc4ozp0…)
-- ============================================================================
--  Sheets: ID, NAMA, DESKRIPSI, FOTO, MAPS lokasi
--  SENGAJA TIDAK ADA kolom `status` — sheet aslinya juga tidak punya, dan
--  portal publik menampilkan semua fasilitas tanpa penyaring (Code.gs:394).
create table public.fasum (
  id           text primary key,
  nama         text not null check (btrim(nama) <> ''),
  deskripsi    text not null default '',
  foto_file_id text,
  foto_url     text,
  maps_url     text not null default ''
);

create trigger fasum_id
  before insert on public.fasum
  for each row execute function public.tg_fill_id('FAS-', '3');


-- ============================================================================
--  organisasi  —  5 sheet digabung: rw, posyandu, pkk, bank-sampah, pokmas
--                 (spreadsheet 1gkMOBSVkBPu…)
-- ============================================================================
--  Sheets (semua sama): ID, JABATAN, NAMA, FOTO
--
--  Kenapa tidak pakai ID dari Sheets sebagai primary key?
--  Di tiap tab, penomoran mulai ulang dari ORG-001. Artinya "ORG-001" ada 5
--  kali dengan orang berbeda. Jadi ID asli tidak unik secara global — disimpan
--  di `legacy_id` dengan pengaman UNIQUE (group, legacy_id).
--
--  `sort_order` menyimpan urutan baris di Sheets. Sheets tidak punya kolom
--  urutan, tapi urutan tampil di portal publik mengikuti urutan baris.
create table public.organisasi (
  id           uuid primary key default gen_random_uuid(),
  grup         text not null
               check (grup in ('rw', 'posyandu', 'pkk', 'bank-sampah', 'pokmas')),
  legacy_id    text not null,
  jabatan      text not null default '',
  nama         text not null default '',
  foto_file_id text,
  foto_url     text,
  sort_order   int  not null default 0,
  unique (grup, legacy_id)
);

create index organisasi_grup_idx on public.organisasi (grup, sort_order);


-- ============================================================================
--  statistik_warga  —  sheet `statistik_warga` (spreadsheet 15qG8a0brYTc…)
-- ============================================================================
--  Sheets: ID, Nama Kategori, Nilai, Keterangan, Terakhir Diperbarui
create table public.statistik_warga (
  id            text primary key,
  nama_kategori text not null default '',
  nilai         bigint not null default 0,
  keterangan    text not null default '',
  updated_at    timestamptz not null default now()
);

create trigger statistik_id
  before insert on public.statistik_warga
  for each row execute function public.tg_fill_id('STT-', '3');

create trigger statistik_touch
  before update on public.statistik_warga
  for each row execute function public.tg_touch();


-- ============================================================================
--  kas  —  sheet `rincian detail` (spreadsheet 1Vq4movo3TW_…)
-- ============================================================================
--  Peta kolom Sheets (A..O) -> kolom di sini:
--
--    A  =ROW()-1            -> legacy_row        (nomor baris, bukan identitas)
--    B  <Date>              -> created_at        (diisi ulang tiap edit)
--    C  Tanggal             -> tanggal
--    D  Uraian             -> uraian
--    E  PJ                 -> pj
--    F  Metode             -> metode
--    G  Masuk              -> masuk
--    H  Keluar             -> keluar
--    I  Keterangan         -> keterangan
--    J  <rumus saldo>       -> TIDAK DISALIN
--    K  =HYPERLINK(bukti)   -> bukti_file_id + bukti_url
--    L  Status             -> status
--    M  <nama pembuat>     -> created_by + created_by_name
--    N  <nama penyetuju>   -> approved_by + approved_by_name
--    O  <alasan ditolak>   -> alasan_ditolak
--
--  Dua keputusan penting:
--
--  1. Kolom J (saldo berjalan) dibuang. Kolom itu murni tampilan — tidak
--     pernah dibaca kode mana pun; semua perhitungan ulang dilakukan di
--     JavaScript. Di Postgres cukup pakai window function saat dibutuhkan.
--
--  2. Kolom M/N menyimpan NAMA, bukan ID. Makanya ada dua kolom: uuid untuk
--     relasi, teks nama untuk ditampilkan. Kalau nama tidak ketemu saat
--     migrasi, uuid-nya NULL tapi nama tetap tersimpan.
--
--  3. `id` jadi UUID, bukan nomor baris. Di Sheets, `approveKas` memakai
--     nomor baris sebagai identitas (Code.gs:1597) — dan `deleteRow` membuat
--     semua nomor di bawahnya bergeser. UUID bebas dari masalah itu.
create table public.kas (
  id               uuid primary key default gen_random_uuid(),
  legacy_row       int,
  tanggal          date not null,
  uraian           text not null check (btrim(uraian) <> ''),
  pj               text,
  metode           text not null default 'Tunai' check (metode in ('Tunai', 'Transfer')),
  masuk            bigint not null default 0 check (masuk >= 0),
  keluar           bigint not null default 0 check (keluar >= 0),
  keterangan       text,
  bukti_file_id    text,
  bukti_url        text,
  status           text not null default 'Menunggu'
                   check (status in ('Menunggu', 'Disetujui', 'Ditolak')),
  created_by       uuid references public.profiles (id) on delete set null,
  created_by_name  text not null default '-',
  approved_by      uuid references public.profiles (id) on delete set null,
  approved_by_name text,
  alasan_ditolak   text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint kas_nilai_ada check (masuk > 0 or keluar > 0)
);

create trigger kas_touch
  before update on public.kas
  for each row execute function public.tg_touch();

create index kas_tanggal_approved_idx on public.kas (tanggal) where status = 'Disetujui';
create index kas_status_idx           on public.kas (status);
create index kas_created_by_name_idx  on public.kas (created_by_name);
create index kas_updated_at_idx       on public.kas (updated_at desc);


-- ============================================================================
--  visitor_log  —  sheet `visitor_log` (spreadsheet 1MYvidwDFe…)
-- ============================================================================
--  Sheets: Timestamp, Tanggal, Page, Referrer, UA, Bahasa, Screen, SessionId
--
--  Di Sheets, kolom `Tanggal` berupa teks "YYYY-MM-DD" dan penyaringan
--  tanggal memakai perbandingan teks. Di sini jadi tipe `date` beneran.
--  Dipakai juga oleh RPC visitor_stats (grafik 14 hari).
create table public.visitor_log (
  id         bigint generated always as identity primary key,
  tanggal    date not null,
  visited_at timestamptz not null default now(),
  page       text not null default '/',
  referrer   text not null default '',
  ua         text not null default '',
  bahasa     text not null default '',
  screen     text not null default '',
  session_id text not null default ''
);

create index visitor_log_tanggal_idx on public.visitor_log (tanggal desc);
create index visitor_log_session_idx on public.visitor_log (session_id);


-- ============================================================================
--  activity_log  —  sheet `activity_log` (spreadsheet 15qG8a0brYTc…)
-- ============================================================================
--  Sheets: Timestamp, Actor, Role, Action, Module, Description
--
--  Di Sheets tabel ini dipangkas jadi 101 baris terakhir (Code.gs:1850) karena
--  Apps Script kewalahan membacanya. Di Postgres tidak perlu dipangkas —
--  kalau nanti perlu, cukup satuScheduled job / pg_cron.
create table public.activity_log (
  id          bigint generated always as identity primary key,
  actor       uuid references public.profiles (id) on delete set null,
  actor_name  text not null default 'System',
  actor_role  text not null default '-',
  action      text not null default '',
  module      text not null default '',
  description text not null default '',
  created_at  timestamptz not null default now()
);

create index activity_log_created_at_idx on public.activity_log (created_at desc);

commit;
