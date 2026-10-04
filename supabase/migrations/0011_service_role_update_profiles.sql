-- ============================================================================
--  0011_service_role_update_profiles.sql  -  Izin tulis profiles untuk Apps Script
-- ============================================================================
--  Jalankan SESUDAH 0010_list_users_dengan_email.sql.
--
--  MASALAH
--  -------
--  Menu Manajemen User gagal menyimpan perubahan menu akses Editor. Galat dari
--  server: "permission denied for table profiles".
--
--  Penyebabnya ada di 0005_bridge_grants.sql:40
--
--      revoke insert, update, delete on public.profiles from service_role;
--
--  Dasarnya waktu itu benar: ketika file itu ditulis, Code.gs hanya mengurus
--  galeri, video, dan berita - dan untuk ketiganya profiles hanya dibaca
--  (requireSupabaseUser_()), tidak pernah ditulis.
--
--  since itu manajemen pengguna dipindahkan ke Code.gs:
--
--    - createSupabaseUser_()  -> PATCH /rest/v1/profiles  (Code.gs:333)
--    - updateSupabaseUser_()  -> PATCH /rest/v1/profiles  (Code.gs:375)
--    - resetPassword_()       -> PATCH /rest/v1/profiles  (Code.gs:977)
--
--  Ketiganya butuh UPDATE, dan hak itu sudah dicabut. Revoke di 0005 tidak
--  diubah ketika tanggung jawabnya berpindah - jadi managemengguna rusak
--  tanpa ada yang mengubah kode-nya.
--
--  Kenapa createUser tampak "berhasil" padahal tidak
--  -----------------------------------------------
--  PATCH di dalam createSupabaseUser_ dibungkus try/catch yang hanya menulis
--  ke console.warn (Code.gs:342-344). Jadi permintaan Auth BERHASIL, profil
--  terisi sebagian, tapi menu_access, role, dan status TIDAK tersimpan - dan
--  admin tetap melihat "Pengguna berhasil ditambahkan".
--
--  Keadaan itu lebih berbahaya daripada error yang jelas: akun terlihat benar
--  padahal haknya salah. updateUser tidak memakai pembungkus seperti itu, jadi
--  di situ error-nya muncul apa adanya.
--
--  SOLUSI
--  ------
--  Kembalikan UPDATE untuk service_role. Hanya UPDATE - bukan INSERT dan DELETE:
--
--    - INSERT tidak perlu. Baris profiles dibuat oleh trigger
--      tg_auth_user_created, yang sudah `security definer`, jadi trigger itu
--      menulis dengan hak miliknya sendiri_payload pemanggil. Grant INSERT
--      ke service_role hanya menambah hak yang tidak pernah dipakai.
--    - DELETE juga tidak perlu. deleteSupabaseUser_ menghapus lewat
--      /auth/v1/admin/users, dan baris profiles ikut hilang karena kolomnya
--      memakai ON DELETE CASCADE - yang dijalankan sebagai pemilik tabel.
--
--  Keamanan
--  --------
--  service_role melewati RLS, jadi grant ini memang berarti Code.gs bebas
--  menulis kolom mana pun di profiles. Itu memang condición yang sudah
--  diterima proyek ini - keyservice_role ada di Script Properties, tidak pernah
--  di repository, dan requireSupabaseUser_() memeriksa identitasSuper Admin
--  sebelum createSupabaseUser_/deleteSupabaseUser_ boleh jalan.
--
--  Yang TIDAK berubah: peran anon tetap tidak bisa apa-apa. 0002b_lockdown
--  mencabut seluruh hak profiles darinya, dan revoke di 0005 sudah tetap
--  berlaku untuk INSERT dan DELETE.
--
--  Perlu dijalankan lewat SQL Editor, bukan dari browser.
-- ============================================================================

begin;

grant update on public.profiles to service_role;

-- Penjaga: kalau grant ini pernah hilang lagi tanpa disadari, migrasi ini
-- masih aman dijalankan ulang dan memulihkannya.
grant select on public.profiles to service_role;

-- Tegaskan lagi hak yang TIDAK diberikan, supaya tidak terbalik oleh
-- `grant all` di migrasi lain yang dijalankan setelah ini.
revoke insert on public.profiles from service_role;
revoke delete on public.profiles from service_role;

-- anon tetap tidak boleh apa-apa. Diulang di sini supaya file ini berdiri
-- sendiri dan tidak bergantung pada urutan migrasi.
revoke all on public.profiles from anon;

commit;