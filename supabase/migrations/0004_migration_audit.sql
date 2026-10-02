-- ============================================================================
--  0004_migration_audit.sql  —  Jejak proses migrasi Sheets -> Supabase
-- ============================================================================
--  Jalankan SESUDAH 0003_functions.sql.
--
--  Tujuannya sederhana: setelah migrasi selesai, harus ada bukti angka-angka
--  yang masuk cocok dengan yang keluar. Sheet Google tidak punya riwayat
--  versi, jadi kalau ada yang salah, satu-satunya cara bekannt adalah
--  membandingkan jumlah dan nilainya. Tabel ini yang mencatatnya.
-- ============================================================================

begin;

create table public.migration_run (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  source      text not null,          -- nama tab Google Sheets
  target      text not null,          -- nama tabel Supabase
  rows_read   int not null default 0,
  rows_written int not null default 0,
  rows_skipped int not null default 0,
  status      text not null default 'berjalan'
              check (status in ('berjalan', 'sukses', 'gagal', 'dilewati')),
  detail      jsonb not null default '{}'::jsonb
);

comment on table public.migration_run is
  'Jejak satu kali eksekusi skrip migrasi per tab. Dipakai untuk pembanding angka setelah cutover.';

create table public.migration_issue (
  id         bigint generated always as identity primary key,
  run_id     bigint references public.migration_run (id) on delete cascade,
  created_at timestamptz not null default now(),
  source     text not null,
  row_key    text not null,
  -- Namanya "kolom", bukan "column": COLUMN itu keyword reserved di SQL dan
  -- harus diapit tanda kutip di setiap penyebutan. Menghindarinya lebih rapi.
  kolom      text,
  problem    text not null,
  raw_value  text
);

comment on table public.migration_issue is
  'Baris yang bermasalah saat migrasi, TIDAK dihapus agar bisa diperiksa manual.';

create index migration_run_started_idx on public.migration_run (started_at desc);

-- Hanya Super Admin yang boleh melihat jejak migrasi.
alter table public.migration_run  enable row level security;
alter table public.migration_issue enable row level security;

create policy migration_run_read on public.migration_run
  for select to authenticated
  using (public.current_role() = 'Super Admin');

create policy migration_issue_read on public.migration_issue
  for select to authenticated
  using (public.current_role() = 'Super Admin');

grant select on public.migration_run, public.migration_issue to authenticated;

commit;
