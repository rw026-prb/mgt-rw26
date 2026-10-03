-- ============================================================================
--  0009_reset_password_sendiri.sql  -  Token reset password yang dikelola sendiri
-- ============================================================================
--  Jalankan SESUDAH 0008_login_dengan_user_id.sql.
--
--  MASALAH
--  -------
--  Link reset password milik Supabase tidak bisa dibuka. Email itu dikirim
--  lewat penyedia bawaan Supabase, dan tautannya diarahkan ke Site URL
--  proyek - yang di repo ini masih http://127.0.0.1:3000 (config.toml:160).
--  Akibatnya penerima mendarat di localhost, dan email dari domain Supabase
--  juga sering dianggap spam.
--
--  SOLUSI
--  ------
--  Link dibuat sendiri oleh Code.gs dan dikirim lewat MailApp (Gmail milik
--  pemilik proyek Apps Script). Supabase Auth tetap menjadi penyimpan
--  password - yang diganti HANYA cara link dibuat dan dikirim.
--
--  Isi file ini:
--    1. Tabel password_reset_tokens - satu baris per permintaan reset.
--    2. Fungsi cari_user_id_by_email - memetakan email ke user_id.
--
--  Kenapa perlu fungsi, bukan SELECT biasa?
--  ---------------------------------------
--  Email disimpan di auth.users, sedangkan tabel profiles tidak punya kolom
--  email. Join keduanya harus dilakukan dengan security definer, sama
--  seperti yang sudah dilakukan cari_email_login di 0008. Bedanya arahnya:
--  cari_email_login memakai legacy_id -> email (untuk login), sedangkan fungsi
--  di sini memakai email -> user_id (untuk reset password).
--
--  CATATAN KEAMANAN - BACA DULU
--  ---------------------------
--  Fungsi ini LEBIH SENSITIF dari cari_email_login, dan karena itu haknya
--  hanya untuk service_role - bukan untuk anon:
--
--    1. Menembak langsung ke auth.users. Mengembalikan user_id berarti
--       membocorkan identifier yang bisa dipakai mencari email orang lain.
--    2. Tidak ada penyaringan, jadi bisa dipakai memetakan email mana saja
--       yang punya akun.
--
--  Yang memanggil fungsi ini hanya Code.gs, memakai kunci service_role yang
--  disimpan di Script Properties dan tidak pernah masuk ke browser.
--  Peramban hanya menerima jawaban "dikirim" atau "tidak dikirim" - keduanya
--  dibedakan oleh frontend, bukan oleh database.
--
--  Jangan pernah menambah 'anon' atau 'authenticated' ke grant di bawah.
--  Bandingkan 0008:88-89 yang grant-nya justru ke anon - untuk reset
--  password, arahnya harus dibalik.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
--  1. Tabel token
-- ---------------------------------------------------------------------------
--  Yang disimpan HANYA hash token, bukan tokennya sendiri.
--
--  Alasannya kebocoran. Kalau tabel ini sampai terbaca - mis. ada yang
--  salah GRANT, atau salinan database bocor - isinya cuma hash yang tidak
--  bisa dibalik jadi link. Token aslinya hanya pernah ada di email penerima
--  dan di memori Apps Script sebentar.
--
--  Kolom tanggal_dipakai diisi saat token dipakai. Baris tidak dihapus
--  supaya jejaknya masih ada - dan supaya token yang sudah dipakai tidak
--  bisa dipakai lagi walau barisnya masih ada di tabel.
create table public.password_reset_tokens (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  token_hash          text not null unique,
  tanggal_dibuat      timestamptz not null default now(),
  tanggal_kedaluwarsa timestamptz not null,
  tanggal_dipakai     timestamptz
);

comment on table public.password_reset_tokens is
  'Token reset password yang dibuat Code.gs. Hanya menyimpan hash SHA-256, bukan token aslinya. Dibuat dan dipakai hanya oleh Code.gs lewat service_role.';

-- Code.gs sering menanyakan "token aktif milik user ini" - misalnya untuk
-- membatalkan token lama sebelum menerbitkan yang baru, dan untuk membatasi
-- jumlah token aktif per orang. Index parsial supaya baris yang sudah
-- terpakai tidak ikut terindeks.
create index password_reset_tokens_aktif_idx
  on public.password_reset_tokens (user_id, tanggal_kedaluwarsa)
  where tanggal_dipakai is null;

-- Dipakai untuk memangkas baris lama. Tanpa index ini, penghapusan token
-- yang sudah lama akan menyisir seluruh tabel.
create index password_reset_tokens_dibuat_idx
  on public.password_reset_tokens (tanggal_dibuat);

-- ---------------------------------------------------------------------------
--  2. RLS dan GRANT
-- ---------------------------------------------------------------------------
--  Tabel ini TIDAK punya policy apa pun. RLS dihidupkan supaya konsisten
--  dengan tabel lain, tapi tanpa policy berarti semua baris tersembunyi dari
--  siapa pun yang bukan service_role (service_role punya BYPASSRLS).
--
--  Dilindungi dua lapis, persis seperti pola 0002b_lockdown.sql: GRANT
--  menolak lebih dulu, RLS akan menyaring kalau GRANT-nya keliru.
alter table public.password_reset_tokens enable row level security;

-- Tanpa policy. Sengaja. Peran anon dan authenticated tidak boleh punya
-- akses apa pun - termasuk SELECT. Driver reset password memakai akun ini.
revoke all on public.password_reset_tokens from anon, authenticated;

-- Code.gs butuh operasi lengkap: SELECT untuk validasi token, INSERT untuk
-- menerbitkan, UPDATE untuk klaim dipakai dan membatalkan klaim yang gagal.
grant select, insert, update, delete on public.password_reset_tokens to service_role;

-- ---------------------------------------------------------------------------
--  3. Pemetaan email -> user_id
-- ---------------------------------------------------------------------------
--  Hanya mengembalikan id, dan hanya untuk akun yang masih AKTIF. Akun
--  nonaktif sengaja tidak mendapat hasil: reset password untuk akun yang
--  dinonaktifkan harus ditolak, supaya "nonaktif" berarti tidak bisa
--  diakses sama sekali - bukan sekadar tidak bisa masuk.
--
--  Status ikut dibaca dari public.profiles (bukan dari auth.users), karena
--  status aktivitas di portal ini dikelola di profiles - lihat CHECK di
--  0001_schema.sql:130.
create or replace function public.cari_user_id_by_email(p_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, auth
as $func$
declare
  v_key text := lower(btrim(coalesce(p_email, '')));
begin
  -- Email kosong tidak mungkin menghasilkan apa pun yang berguna, dan
  -- membiarkan query jalan untuk input kosong hanya membuang sumber daya.
  if v_key = '' then
    return null;
  end if;

  return (
    select u.id
      from public.profiles p
      join auth.users u on u.id = p.id
     where lower(u.email) = v_key
       and lower(coalesce(p.status, 'aktif')) = 'aktif'
     limit 1
  );
end;
$func$;

comment on function public.cari_user_id_by_email(text) is
  'Memetakan email ke user_id untuk penerbitan token reset password. Hanya boleh dipanggil service_role (Code.gs). Mengembalikan null bila email tidak terdaftar atau akunnya nonaktif.';

-- Postgres memberi EXECUTE ke public secara default untuk fungsi baru,
-- jadi hak itu harus dicabut lebih dulu sebelum diberikan hanya ke satu
-- peran. Lihat catatan di kepala file: menambahkan anon di sini akan
-- membuka penebakan email untuk siapa saja.
revoke execute on function public.cari_user_id_by_email(text) from public;
grant execute on function public.cari_user_id_by_email(text) to service_role;

commit;