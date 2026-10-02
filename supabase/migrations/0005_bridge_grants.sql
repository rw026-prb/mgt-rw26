-- ============================================================================
--  0005_bridge_grants.sql  —  Izin untuk Apps Script yang sudah ditipiskan
-- ============================================================================
--  Jalankan SESUDAH 0004_migration_audit.sql.
--
--  LATAR BELAKANG
--  ---------------
--  Setelah migrasi, Code.gs hanya mengurus galeri, video, dan berita. Tapi
--  modul-modul di Supabase (himbauan, fasum, organisasi, kas) masih menyimpan
--  fotonya di Google Drive, dan satu-satunya cara menulis ke Drive adalah lewat
--  Apps Script.
--
--  Code.gs sekarang memanggil dua endpoint Supabase:
--
--    1. GET /rest/v1/profiles  - untuk membaca role dan hak modul pengguna.
--       Dipakai oleh requireSupabaseUser_(). Butuh service_role, karena peran
--       RLS 'anon' tidak boleh membaca tabel profiles.
--
--    2. POST /rest/v1/activity_log - untuk mencatat jejak perubahan.
--       Dipakai oleh logActivity_().
--
--  Keduanya memakai kunci service_role yang disimpan di Script Properties
--  (bukan di dalam file, karena file ikut ter-commit ke repository publik).
--
--  Grants di file ini ditulis eksplisit supaya tidak bergantung pada default
--  Supabase. Peran service_role adalah satu-satunya yang bisa menulis ke
--  activity_log: policy RLS-nya mengharuskan actor = auth.uid(), sedangkan
--  permintaan dari Apps Script tidak punya JWT pengguna - dan memang tidak
--  perlu, karena token pengirim sudah divalidasi lebih dulu oleh
--  requireSupabaseUser_().
-- ============================================================================

begin;

grant select on public.profiles to service_role;
grant insert on public.activity_log to service_role;

-- profiles dibaca oleh Code.gs untuk setiap permintaan tulis yang dia tangani.
-- SELECT saja yang dibutuhkan - Code.gs tidak pernah mengubah tabel ini.
revoke insert, update, delete on public.profiles from service_role;

comment on table public.activity_log is
  'Jejak perubahan. Ditulis dari portal admin (Supabase) maupun dari Code.gs lewat service_role.';

commit;
