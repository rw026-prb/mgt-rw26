-- ============================================================================
--  0002b_lockdown.sql  —  Pencabutan hak akses langsung (pertahanan lapis kedua)
-- ============================================================================
--  Jalankan SESUDAH 0002_rls.sql.
--
--  KEADAAN SEBELUM FILE INI
--  -----------------------
--  0002_rls.sql memasang RLS, tapi TIDAK mencabut hak SELECT default yang
--  Supabase berikan otomatis ke peran `anon` untuk setiap tabel baru.
--
--  Akibatnya: peran `anon` secara teknis boleh menjalankan
--  `SELECT * FROM kas`. Query-nya tidak error, hanya mengembalikan 0 baris
--  karena RLS menyaring semuanya. Kondisi yang berbahaya, karena terlihat
--  "aman" - padahal keamanannya hanya bergantung pada RLS.
--
--  Kalau suatu saat RLS tidak sengaja dimatikan, seluruh buku kas langsung
--  terbuka tanpa peringatan.
--
--  YANG KITA LAKUKAN DI SINI
--  -------------------------
--  Mencabut hak akses langsung dari peran `anon` pada tabel sensitif, sehingga
--  meski RLS mati, GRANT tetap menolak. Dua lapis, bukan satu.
--
--  Catatan: peran `anon` di Postgres memang punya hak SELECT default dari
--  Supabase karena `alter default privileges`. Kita cabut di sini secara
--  eksplisit. Buku kas tetap bisa dibaca publik — lewat fungsi laporan
--  (kas_report / kas_cash_flow) yang dibuat di 0003_functions.sql, bukan lewat
--  akses tabel.
--
--  File ini aman dijalankan berulang kali.
-- ============================================================================

begin;

-- Buku kas, daftar user, dan log aktivitas: anon tidak boleh punya akses apa pun.
revoke all on public.kas           from anon;
revoke all on public.profiles      from anon;
revoke all on public.activity_log  from anon;

-- Pengunjung boleh MENCATAT kunjungan, tidak boleh membacanya.
revoke select, update, delete on public.visitor_log from anon;
grant insert on public.visitor_log to anon;

-- Tabel konten publik tetap boleh dibaca anon (himbauan, pengumuman, fasum,
-- organisasi, statistik) — itu memang isi website. Tidak disentuh di sini.

commit;
