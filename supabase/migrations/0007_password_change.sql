-- ============================================================================
--  0007_password_change.sql  —  Penanda ganti password untuk akun sendiri
-- ============================================================================
--  Jalankan SESUDAH 0002_rls.sql.
--
--  MASALAH
--  -------
--  Saat migrasi, setiap akun diberi password acak dan flag must_change_pw
--  diaktifkan. Portal mengarahkan pengguna ke update-password.html sampai
--  flag itu turun.
--
--  Halaman itu sebelumnya menurunkan flag dengan:
--
--      update public.profiles set must_change_pw = false where id = ...
--
--  dari browser. Itu HANYA berhasil untuk Super Admin dan Admin, karena
--  policy profiles_admin_write mensyaratkan role tersebut.
--
--  Akibatnya akun ber-role Editor akan:
--    1. diarahkan ke update-password.html
--    2. mengganti password dengan sukses
--    3. gagal menurunkan flag
--    4. diarahkan kembali ke update-password.html
--    -> berulang tanpa henti. Pengguna tidak pernah bisa masuk portal.
--
--  SOLUSI
--  ------
--  Fungsi di bawah turunkan flag HANYA untuk akun yang sedang login, dan
--  tidak menyentuh kolom lain. Dipanggil dengan security definer supaya
--  tidak terhalang policy RLS.
--
--  Fungsi ini sengaja tidak bisa dipakai untuk mengubah role, status, atau
--  kolom lain - itu tetap hak Admin lewat jalur yang sudah ada.
-- ============================================================================

begin;

create or replace function public.complete_password_change()
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $func$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Belum login.' using errcode = '42501';
  end if;

  update public.profiles
     set must_change_pw = false,
         login_terakhir  = now()
   where id = v_uid;

  return found;
end;
$func$;

comment on function public.complete_password_change() is
  'Menurunkan flag must_change_pw milik akun yang sedang login. Dipanggil setelah penggantian password berhasil.';

-- Hanya untuk peran yang sudah login. Bukan untuk anon.
grant execute on function public.complete_password_change() to authenticated;
revoke execute on function public.complete_password_change() from anon, public;

commit;
