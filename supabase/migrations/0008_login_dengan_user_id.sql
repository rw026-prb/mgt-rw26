-- ============================================================================
--  0008_login_dengan_user_id.sql  —  Login pakai User ID (RW-NNNN) atau email
-- ============================================================================
--  Jalankan SESUDAH 0007_password_change.sql.
--
--  MASALAH
--  -------
--  Portal ini memberi pengguna User ID seperti "RW-0007" supaya mudah
--  diingat, tapi Supabase Auth hanya menerima EMAIL saat login:
--
--      supabase.auth.signInWithPassword({ email, password })
--
--  Dulu form login menerima keduanya. Lalu dibatasi jadi email saja, dan
--  muncul pesan "Masukkan EMAIL, bukan User ID". Ternyata banyak warga
--  tetap mengetik User ID seperti seharusnya.
--
--  Kenapa tidak bisa diselesaikan di sisi peramban?
--  ---------------------------------------------
--  Email disimpan di auth.users, sedangkan "RW-NNNN" ada di
--  profiles.legacy_id. Satu-satunya jalan adalah join keduanya - dan RLS
--  menutup profiles untuk peran anon (sudah diuji: HTTP 401). Jadi
--  pencarian harus lewat fungsi yang dijalankan dengan security definer.
--
--  CATATAN KEAMANAN - BACA DULU
--  ---------------------------
--  Fungsi ini bisa dipanggil siapa saja, karena anon key ada di HTML
--  portal. Artinya siapa pun bisa memakai RW-NNNN untuk mencari email
--  pemilik akun. Ini konsekuensi langsung dari permintaan "login pakai
--  User ID" - tidak ada cara lain, karena email harus sampai ke
--  signInWithPassword di peramban.
--
--  Yang dikupas sekecil mungkin:
--    - fungsi hanya mengembalikan EMAIL. Tidak nama, role, status, atau
--      kolom lain. Peta User ID -> nama sudah terbuka lewat halaman
--  - password tetap jadi gerbang. Fungsi ini tidak pernah menerima
--      password dan tidak memverifikasi apa pun soal akses.
--    - input dikembalikan apa adanya kalau tidak cocok, sehingga pesan
--      di peramban tidak bisa dipakai menebak-nebak email.
--
--  Kalau nanti ini jadi terasa berisiko, jalankan penutup ini:
--
--      revoke execute on function public.cari_email_login(text) from anon;
--
--  lalu login User ID dimatikan dan hanya email yang berlaku.
-- ============================================================================

begin;

create or replace function public.cari_email_login(p_identifier text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $func$
declare
  v_key text := lower(btrim(coalesce(p_identifier, '')));
begin
  -- Input kosong tidak mungkin menghasilkan apa pun yang berguna, dan
  -- membiarkan query jalan untuk input kosong hanya membuang sumber daya.
  if v_key = '' then
    return null;
  end if;

  -- legacy_id dicocokkan tanpa memperhatikan huruf besar-kecil, karena
  -- "rw-0007" dan "RW-0007"pasti orang yang sama.
  --
  -- Kolom id (uuid) sengaja TIDAK ikut dicocokkan: UUID-nya 36 karakter
  -- dan tidak pernah ditampilkan ke pengguna, jadi menambahkannya hanya
  -- memperlebar permukaan serangan tanpa guna.
  return (
    select u.email
      from public.profiles p
      join auth.users u on u.id = p.id
     where lower(p.legacy_id) = v_key
     limit 1
  );
end;
$func$;

comment on function public.cari_email_login(text) is
  'Mencari email berdasarkan profiles.legacy_id (RW-NNNN), untuk memungkinkan login pakai User ID. Mengembalikan email saja, atau null bila ID tidak ada.';

-- Login terjadi sebelum sesi dibuat, jadi peran anon WAJIB boleh memanggil.
-- Postgres memberi EXECUTE ke public secara default untuk fungsi baru,
-- jadi hak itu harus dicabut lebih dulu sebelum diberikan hanya ke dua
-- peran yang memang butuh.
revoke execute on function public.cari_email_login(text) from public;
grant execute on function public.cari_email_login(text) to anon, authenticated;

commit;