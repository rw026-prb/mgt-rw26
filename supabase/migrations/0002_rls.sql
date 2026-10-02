-- ============================================================================
--  0002_rls.sql  —  Hak akses data (Row Level Security)
-- ============================================================================
--  Dijalankan SETELAH 0001_schema.sql. Urutan penting: 0001 membuat trigger
--  yang butuh `security definer`; RLS di file ini yang mengunci tabelnya.
--
--  PEMAHAMAN SINGKAT
--  -----------------
--  Row Level Security = aturan yang dipasang di dalam database. Setiap query
--  dari browser dicek terhadap aturan ini sebelum data dikirim. Aturan di
--  JavaScriptfrontend bisa dilewati (F12 + edit request); aturan di database
--  tidak.
--
--  Dua peran yang berperan di sini:
--    anon         = pengunjung website yang tidak login. Tidak punya identitas.
--    authenticated= admin yang sudah login. Identitas terbaca dari token JWT
--                   lewat fungsi auth.uid().
--
--  hiérarchi wewenang (meniru Code.gs:1921 hasMenuAccess_):
--    Super Admin / Admin -> boleh semua menu
--    Editor              -> hanya menu yang tercantum di profiles.menu_access
--    status = 'Nonaktif' -> ditolak di semua menu
--
--  CATATAN PENTING SOAL KAS
--  ------------------------
--  Buku kas tetap bisa dibaca publik lewat fungsi laporan (kas_report /
--  kas_cash_flow, dibuat di 0003_functions.sql) — sama seperti sekarang.
--  Tapi peran `anon` TIDAK diberi hak SELECT langsung ke tabel `kas`, supaya
--  siapa pun tidak bisa menarik seluruh baris mentah-mentah lewat PostgREST.
--  Yang bisa dibaca publik hanya ringkasan bulanan, persis seperti dulu.
--
--  CATATAN: sengaja hanya memakai ENABLE, bukan FORCE ROW LEVEL SECURITY.
--  FORCE membuat aturan ikut berlaku untuk pemilik tabel. Padahal beberapa
--  trigger di bawah adalah SECURITY DEFINER milik postgres dan HARUS bisa
--  melewati RLS (mis. membuat baris profiles saat admin dibuat). Pakai ENABLE
--  saja sudah cukup: semua akses dari browser berperan sebagai anon atau
--  authenticated, dan keduanya bukan pemilik tabel.
-- ============================================================================

begin;

-- Supabase memberi hak CREATE pada schema public ke semua peran secara default.
-- Ini berbahaya untuk fungsi bertipe SECURITY DEFINER: pengguna bisa membuat
-- tabel dengan nama yang sama dan meniru objek yang dipakai fungsi.
revoke create on schema public from public;
revoke all on all functions in schema public from public;


-- ============================================================================
--  1. FUNGSI PEMBANTU
-- ============================================================================
--  Semua fungsi di sini `security definer`, artinya dijalankan dengan hak
--  pemilik (postgres) yang menembus RLS.
--
--  Kenapa wajib? Karena policies untuk tabel `profiles` perlu membaca
--  `profiles` untuk tahu "siapa yang sedang login dan apa role-nya". Kalau
--  policy itu membaca tabelnya sendiri secara normal, PostgreSQL akan
--  memanggil RLS lagi -> berulang -> error "infinite recursion detected".
--  SECURITY DEFINER memutus putaran itu.
-- ============================================================================

-- Profil user yang sedang login, atau NULL kalau belum login / nonaktif.
create or replace function public.current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public
as $func$
  select p.*
    from public.profiles p
   where p.id = auth.uid()
     and p.status = 'Aktif'
$func$;

comment on function public.current_profile() is
  'Profil user yang sedang login. NULL bila belum login atau berstatus Nonaktif.';


create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $func$
  select p.role from public.profiles p where p.id = auth.uid() and p.status = 'Aktif'
$func$;


-- Apakah user yang sedang login punya akses ke sebuah modul?
create or replace function public.has_menu(p_menu text)
returns boolean
language sql
stable
security definer
set search_path = public
as $func$
  select exists (
    select 1
      from public.profiles p
     where p.id = auth.uid()
       and p.status = 'Aktif'
       and ( p.role in ('Super Admin', 'Admin')
             or p_menu = any (p.menu_access) )
  )
$func$;

comment on function public.has_menu(text) is
  'true bila user login boleh memakai modul tersebut. Menggantikan hasMenuAccess_ di Code.gs.';


-- Sinkronisasi auth.users <-> profiles.
--
-- Wajib: kalau tabel ini tidak ada, begitu admin login, RLS selalu menolak
-- semua query (karena profiles kosong) dan portal tidak bisa dipakai sama sekali.
create or replace function public.tg_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  insert into public.profiles (id, nama, legacy_id, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nama', split_part(new.email, '@', 1), 'Tanpa Nama'),
    null,                                    -- diisi trigger legacy_id
    coalesce(new.raw_app_meta_data ->> 'role', 'Editor')
  )
  on conflict (id) do nothing;
  return new;
end;
$func$;

create trigger auth_user_created
  after insert on auth.users
  for each row execute function public.tg_auth_user_created();


-- ============================================================================
--  2. TABEL KONTEN — himbauan, pengumuman, fasum, organisasi, statistik
-- ============================================================================
--  Paket aturan:
--    anon         -> SELECT, dan hanya baris berstatus 'Aktif'
--    authenticated-> SELECT semua baris (supaya admin bisa menghidupkan
--                     kembali konten yang Nonaktif), INSERT/UPDATE/DELETE
--                     sesuai modulnya masing-masing
-- ============================================================================

-- ---------------------------------------------------------------- himbauan --
alter table public.himbauan enable row level security;

create policy himbauan_read_anon on public.himbauan
  for select to anon using (status = 'Aktif');

create policy himbauan_admin_all on public.himbauan
  for all to authenticated
  using      (public.has_menu('himbauan'))
  with check (public.has_menu('himbauan'));

-- ------------------------------------------------------------- pengumuman --
alter table public.pengumuman enable row level security;

create policy pengumuman_read_anon on public.pengumuman
  for select to anon using (status = 'Aktif');

create policy pengumuman_admin_all on public.pengumuman
  for all to authenticated
  using      (public.has_menu('pengumuman'))
  with check (public.has_menu('pengumuman'));

-- ------------------------------------------------------------------- fasum --
-- Tanpa kolom status (meniru sheet aslinya), jadi semua baris terbaca publik.
alter table public.fasum enable row level security;

create policy fasum_read_anon on public.fasum
  for select to anon using (true);

create policy fasum_admin_all on public.fasum
  for all to authenticated
  using      (public.has_menu('fasilitas'))
  with check (public.has_menu('fasilitas'));

-- -------------------------------------------------------------- organisasi --
alter table public.organisasi enable row level security;

create policy organisasi_read_anon on public.organisasi
  for select to anon using (true);

create policy organisasi_admin_all on public.organisasi
  for all to authenticated
  using      (public.has_menu('organisasi'))
  with check (public.has_menu('organisasi'));

-- ---------------------------------------------------------- statistik_warga --
alter table public.statistik_warga enable row level security;

create policy statistik_read_anon on public.statistik_warga
  for select to anon using (true);

create policy statistik_admin_all on public.statistik_warga
  for all to authenticated
  using      (public.has_menu('statistik'))
  with check (public.has_menu('statistik'));


-- ============================================================================
--  3. TABEL KAS
-- ============================================================================
--  Tidak ada policy SELECT untuk anon. Pembacaan publik hanya lewat RPC.
--
--  Dua aturan asli Code.gs ikut dipertahankan lewat trigger di bawah:
--    a) Transaksi baru SELALU berstatus 'Menunggu' (Code.gs:1473)
--    b) Hanya Admin/Super Admin yang boleh menyetujui atau menolak (Code.gs:1592,1608)
--    c) Editor hanya boleh mengubah/menghapus transaksi miliknya sendiri
--       yang statusnya 'Menunggu' atau 'Ditolak' (Code.gs:1486,1554)
-- ============================================================================

alter table public.kas enable row level security;

create policy kas_admin_all on public.kas
  for all to authenticated
  using      (public.has_menu('kas'))
  with check (public.has_menu('kas'));


-- Mengisi otomatis saat INSERT: created_by, created_by_name, dan status.
create or replace function public.tg_kas_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid  uuid := auth.uid();
  v_nama text;
begin
  -- auth.uid() NULL = skrip migrasi / service_role. Biarkan data apa adanya.
  if v_uid is null then
    return new;
  end if;

  select p.nama into v_nama
    from public.profiles p
   where p.id = v_uid and p.status = 'Aktif';

  if v_nama is null then
    raise exception 'Profil tidak ditemukan atau berstatus Nonaktif.'
      using errcode = '42501';
  end if;

  new.created_by      := v_uid;
  new.created_by_name := v_nama;
  new.status          := 'Menunggu';
  new.approved_by      := null;
  new.approved_by_name := null;
  new.alasan_ditolak   := null;
  return new;
end;
$func$;

create trigger kas_before_insert
  before insert on public.kas
  for each row execute function public.tg_kas_before_insert();


create or replace function public.tg_kas_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid      uuid := auth.uid();
  v_nama     text;
  v_is_admin boolean;
begin
  if v_uid is null then
    return new;
  end if;

  select p.nama, (p.role in ('Super Admin', 'Admin'))
    into v_nama, v_is_admin
    from public.profiles p
   where p.id = v_uid and p.status = 'Aktif';

  if v_nama is null then
    raise exception 'Profil tidak ditemukan atau berstatus Nonaktif.'
      using errcode = '42501';
  end if;

  if v_is_admin then
    -- Admin boleh mengubah apa saja; mencatat siapa yang menyetujui/menolak.
    if new.status = 'Disetujui' and old.status is distinct from 'Disetujui' then
      new.approved_by      := v_uid;
      new.approved_by_name := v_nama;
      new.alasan_ditolak   := null;
    elsif new.status = 'Ditolak' and old.status is distinct from 'Ditolak' then
      new.approved_by      := v_uid;
      new.approved_by_name := v_nama;
    end if;
    return new;
  end if;

  --Editor: batasi ke transaksi sendiri yang belum final.
  if new.created_by is distinct from v_uid then
    raise exception 'Anda hanya dapat mengubah transaksi yang Anda buat sendiri.'
      using errcode = '42501';
  end if;

  if old.status not in ('Menunggu', 'Ditolak') then
    raise exception 'Transaksi yang sudah disetujui tidak dapat diubah.'
      using errcode = '42501';
  end if;

  if new.status <> 'Menunggu' then
    raise exception 'Hanya Admin atau Super Admin yang dapat menyetujui atau menolak transaksi.'
      using errcode = '42501';
  end if;

  new.approved_by      := null;
  new.approved_by_name := null;
  new.alasan_ditolak   := null;
  return new;
end;
$func$;

create trigger kas_before_update
  before update on public.kas
  for each row execute function public.tg_kas_before_update();


-- ============================================================================
--  4. TABEL PROFIL (user)
-- ============================================================================
--  Admin melihat semua user. User biasa hanya boleh melihat dirinya sendiri.
--  Mengubah role/status TIDAK boleh dilakukan oleh user yang login -- hanya
--  lewat RPC update_my_profile() di bawah, yang tidak menyentuh kolom role.
-- ============================================================================

alter table public.profiles enable row level security;

create policy profiles_read on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.current_role() in ('Super Admin', 'Admin'));

create policy profiles_admin_write on public.profiles
  for all to authenticated
  using      (public.current_role() in ('Super Admin', 'Admin'))
  with check (public.current_role() in ('Super Admin', 'Admin'));

-- Pemakaian: supabase.rpc('update_my_profile', { p_nama, p_no_hp })
create or replace function public.update_my_profile(p_nama text, p_no_hp text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid uuid := auth.uid();
  v_row public.profiles;
begin
  if v_uid is null then
    raise exception 'Belum login.' using errcode = '42501';
  end if;

  update public.profiles
     set nama           = coalesce(nullif(btrim(p_nama), ''), nama),
         no_hp          = coalesce(p_no_hp, no_hp),
         login_terakhir = now()
   where id = v_uid and status = 'Aktif'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Profil tidak ditemukan atau berstatus Nonaktif.' using errcode = '42501';
  end if;

  return v_row;
end;
$func$;

comment on function public.update_my_profile(text, text) is
  'Admin mengubah profilnya sendiri. Hanya nama, no HP, dan jam login.';


-- ============================================================================
--  5. TABEL LOG
-- ============================================================================
--  visitor_log  : boleh ditulis oleh siapa pun (tanpa login) — itu memang
--                 tujuannya, mencatat kunjungan. Hanya Super Admin yang boleh
--                 membaca. Perilaku ini sama seperti logVisitor di Code.gs.
--  activity_log : semua admin boleh menulis, hanya Super Admin yang membaca.
-- ============================================================================

alter table public.visitor_log enable row level security;

create policy visitor_log_write_anon on public.visitor_log
  for insert to anon with check (true);

create policy visitor_log_read_admin on public.visitor_log
  for select to authenticated
  using (public.current_role() = 'Super Admin');

alter table public.activity_log enable row level security;

create policy activity_log_write on public.activity_log
  for insert to authenticated
  with check (actor = auth.uid());

create policy activity_log_read on public.activity_log
  for select to authenticated
  using (public.current_role() = 'Super Admin');


-- ============================================================================
--  6. HAK AKSOS (GRANT)
-- ============================================================================
--  RLS menentukan "baris mana yang terlihat". GRANT menentukan "operasi apa
--  yang boleh dijalankan". Dua-duanya perlu. Tanpa GRANT, policy sehebat apa
--  pun tidak akan dieksekusi.
--
--  Semua GRANT ditulis eksplisit — bukan mengandalkan default Supabase —
--  supaya tidak ada operasi yang kebetulan lolos.
-- ============================================================================

grant usage on schema public to anon, authenticated;

-- Publik: hanya baca konten yang sudah tayang.
grant select on
  public.himbauan,
  public.pengumuman,
  public.fasum,
  public.organisasi,
  public.statistik_warga
  to anon;

-- Publik: boleh mencatat kunjungan, tidak boleh membaca apa pun.
grant insert on public.visitor_log to anon;

-- Admin: penuh pada modul konten + kas.
grant select, insert, update, delete on
  public.himbauan,
  public.pengumuman,
  public.fasum,
  public.organisasi,
  public.statistik_warga,
  public.kas
  to authenticated;

-- profiles: GRANT-nya penuh untuk semua admin, yang menyaring adalah RLS
-- (policy profiles_read) — bukan GRANT.
grant select, insert, update, delete on public.profiles to authenticated;

-- visitor_log: INSERT diberikan ke semua admin (mis. impor data), SELECT hanya
-- benar-benar dipakai Super Admin karena policy-nya menyaring.
grant insert, select on public.visitor_log to authenticated;

grant insert, select on public.activity_log to authenticated;

-- Kolom identitas (identity) butuh hak atas sequence-nya.
grant usage, select on all sequences in schema public to anon, authenticated;

-- Fungsi pembantu.
--   -_has_menu/current_profile/current_role/update_my_profile_ hanya untuk admin.
grant execute on function
  public.current_profile(),
  public.current_role(),
  public.has_menu(text),
  public.update_my_profile(text, text)
  to authenticated;

-- Fungsi trigger dari 0001_schema.sql. Wajib ada di sini karena baris pertama
-- file ini melakukan `revoke all on all functions ... from public`. Tanpa grant
-- ini, setiap INSERT/INSERT-UPDATE dari browser ditolak trigger.
grant execute on function
  public.next_prefixed_id(regclass, text, text, int),
  public.tg_fill_id(),
  public.tg_fill_legacy_id(),
  public.tg_touch()
  to authenticated;

commit;
