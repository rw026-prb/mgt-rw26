-- ============================================================================
--  0010_list_users_dengan_email.sql  -  Daftar pengguna beserta email
-- ============================================================================
--  Jalankan SESUDAH 0009_reset_password_sendiri.sql.
--
--  MASALAH
--  -------
--  Di menu Manajemen User, kolom email selalu kosong - padahal data emailnya
--  ada. Di halaman Profil, email milik orang yang sedang login tampil dengan
--  benar. Bedanya hanya di sumber datanya.
--
--  Penyebabnya:
--
--    * Tabel profiles TIDAK punya kolom email. Yang menyimpannya adalah
--      auth.users. Lihat 0001_schema.sql:122 - tidak ada `email` di sana.
--    * auth.users tidak bisa dibaca dari browser memakai kunci anon.
--    * Bridge rw26-api.js(listUsers) karena itu SELALU mengembalikan email
--      kosong: tidak ada permintaan ke mana pun untuk mengambilnya, objek
--      email langsung diisi `{}`. Kolomnya kosong bukan karena datanya tidak
--      ada, tapi karena tidak pernah ditanyakan.
--
--  SOLUSI
--  ------
--  Fungsi ini menjoin profiles dengan auth.users di sisi database, lalu
--  mengembalikan email sebagai kolom biasa. Satu permintaan, bukan satu
--  permintaan per pengguna.
--
--  KENAPA security definer
--  ----------------------
--  auth.users tidak punya policy apa pun untuk peran anon/authenticated, jadi
--  tidak bisa dibaca langsung dari peramban. Tapi daftar pengguna sendiri
--  SUDAH terbuka - lihat list_users di 0003_functions.sql, yang bisa dibaca
--  semua admin. Jadi fungsi ini tidak membuka hal baru: yang ditambahkan hanya
--  email, dan hanya untuk yang memang sudah boleh melihat daftar pengguna.
--
--  Yang ditolak di sini: peran anon. Tanpa pemeriksaan itu, siapa pun yang
--  tidak login bisa memanggil fungsi ini lewat PostgREST dan mendapatkan
--  seluruh daftar email warga RW - yang sama sekali tidak perlu untuk portal
--  admin.
--
--  Perlu dijalankan lewat SQL Editor, bukan dari browser.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
--  1. list_users_dengan_email()
-- ---------------------------------------------------------------------------
--  Bentuk kembaliannya SENGAJA dibuat sama dengan hasil
--  supabase.from('profiles').select('*') PLUS satu kolom `email`. Dengan
--  begitu mapUser() di rw26-api.js tidak perlu tahu asal datanya, dan kalau
--  fungsi ini belum tersedia, bridge bisa jatuh kembali ke select biasa -
--  daftar tetap tampil, hanya emailnya kosong.
-- ---------------------------------------------------------------------------
create or replace function public.list_users_dengan_email()
returns setof jsonb
language sql
stable
security definer
set search_path = public, auth
as $func$
  select jsonb_build_object(
    'id',              p.id,
    'legacy_id',       p.legacy_id,
    'nama',            p.nama,
    -- Kolom email memang tidak ada di profiles; diambil dari auth.users.
    'email',           coalesce(u.email, ''),
    'no_hp',           p.no_hp,
    'role',            p.role,
    'wilayah',         p.wilayah,
    'status',          p.status,
    'menu_access',     p.menu_access,
    'must_change_pw',  p.must_change_pw,
    'login_terakhir',  p.login_terakhir,
    'tanggal_dibuat',  p.tanggal_dibuat
  )
  from public.profiles p
  join auth.users u on u.id = p.id
  order by p.legacy_id asc;
$func$;

comment on function public.list_users_dengan_email() is
  'Daftar profiles digabung dengan email dari auth.users. Dipakai rw26-api.js untuk menu Manajemen User. Hanya untuk peran yang sudah boleh melihat daftar pengguna.';

-- ---------------------------------------------------------------------------
--  2. Gerbang akses
-- ---------------------------------------------------------------------------
--  Postgres memberi EXECUTE ke public secara default untuk fungsi baru, jadi
--  haknya harus dicabut dulu sebelum diberikan. Kalau dibiarkan, peran anon
--  ikut bisa memanggil fungsi ini dan membaca semua email warga.
--
--  Pola dua langkah (revoke lebih dulu, baru grant) sama dipakai di
--  0002b_lockdown.sql dan 0009 - tujuannya supaya ada jaring pengaman kalau
--  GRANT lupa ditulis ulang.
--
--  Peran yang boleh memanggil:
--    - authenticated : admin yang sudah login dan sudah boleh melihat daftar
--                       pengguna. Super Admin dan Admin sudah bisa membaca
--                       tabel profiles, jadi menambahkan email tidak membuka
--                       apa yang belum terbuka.
--    - service_role  : Code.gs, kalau suatu saat memanggil lewat PostgREST.
-- ---------------------------------------------------------------------------
revoke execute on function public.list_users_dengan_email() from public;
revoke execute on function public.list_users_dengan_email() from anon;
grant execute on function public.list_users_dengan_email() to authenticated, service_role;

commit;