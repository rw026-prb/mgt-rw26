-- ============================================================================
--  0003_functions.sql  —  Fungsi laporan (pengganti logika di Code.gs)
-- ============================================================================
--  Jalankan SESUDAH 0001_schema.sql dan 0002_rls.sql.
--
--  TUJUAN
--  -----
--  Semua perhitungan yang sebelumnya dilakukan di JavaScript (Code.gs) dipindah
--  ke sini supaya angka dihitung oleh database, bukan oleh browser.
--
--  Fungsi-fungsi di bawah ini menggantikan perhitungan yang tadinya dilakukan
--  di kode lama. Perbandingannya:
--
--    Fungsi                    Menggantikan          di Code.gs
--    ------------------------- --------------------- -------------------------
--    get_public_content()      publicContentData_    388-405 (bagian Supabase)
--    kas_report()              publicKasReport_      459-522
--    kas_cash_flow()           publicKasCashFlow_    1702-1776
--    list_kas()                listKas_              1391-1419
--    kas_dashboard()           kasDashboardData_     1649-1688
--    visitor_stats()           getVisitorStats_      560-604
--    visitor_logs()            getVisitorLogs_       605-624
--
--  MENGAPA BANYAK FUNGSI INI `security definer`?
--  ---------------------------------------------
--  Setelah 0002b_lockdown.sql, peran `anon` TIDAK punya hak SELECT sama sekali
--  ke tabel kas, profiles, dan visitor_log. Itu disengaja.
--
--  Tapi buku kas tetap harus bisa dibaca publik. Solusinya: database sendiri
--  yang membaca tabelnya lalu mengembalikan HANYA hasil agregat yang memang
--  sudah terbuka di website (Code.gs juga begitu - publicKasReport_ mengembalikan
--  ringkasan, bukan baris mentah).
--
--  Fungsi di bawah TIDAK menerima parameter bebas yang bisa dipakai untuk
--  memancing data lain. Tidak ada `p_select text` atau SQL dinamis. Itu
--  disengaja: kalau ada, `anon` bisa menyuntikkan SQL sendiri lewat parameter.
--
--  ZONA WAKTU
--  ---------
--  Code.gs memakai Session.getScriptTimeZone() yang di fallback ke Asia/Jakarta
--  (Code.gs:2040). Server Supabase memakai UTC. Tanpa konversi eksplisit,
--  "hari ini" bisa bergeser 7 jam. Semua query tanggal di sini memakai
--  `at time zone 'Asia/Jakarta'` agar perilakunya sama persis dengan yang lama.
-- ============================================================================

begin;

-- ============================================================================
--  1. get_public_content()  —  gantikan publicContentData_ (Code.gs:388)
-- ============================================================================
--  Dipanggil website publik TANPA login. Hanya mengembalikan isi yang sudah
--  tayang. Tidak perlu `security definer`: RLS sudah menyaring baris Nonaktif,
--  dan filter `status = 'Aktif'` di dalam fungsi adalah pengaman kedua.
--
--  Bentuk keluarannya sengaja dibuat sama persis dengan `publicContent_` versi
--  lama, supaya Website-RW26 tidak perlu diubah di baris mana pun.
--  Yang TIDAK ada di sini (tetap dari Apps Script): news, gallery, videos,
--  videoKegiatan.
-- ============================================================================

create or replace function public.get_public_content()
returns jsonb
language sql
stable
set search_path = public
as $func$
with org_members as (
  select o.grup, o.sort_order, o.legacy_id, o.jabatan, o.nama, o.foto_file_id, o.foto_url
  from public.organisasi o
),
org_agg as (
  select g.grup,
         coalesce(
           (
             select jsonb_agg(
                      jsonb_build_object(
                        'group',     o.grup,
                        'id',        o.legacy_id,
                        'jabatan',   o.jabatan,
                        'nama',      o.nama,
                        'foto',      coalesce(o.foto_url, ''),
                        'imageUrl',  case
                                       when coalesce(o.foto_file_id, '') <> ''
                                         then 'https://drive.google.com/thumbnail?id=' || o.foto_file_id || '&sz=w800'
                                       else coalesce(o.foto_url, '')
                                     end,
                        'fileId',    coalesce(o.foto_file_id, '')
                      )
                      order by o.sort_order, o.legacy_id
                    )
             from org_members o
             where o.grup = g.grup
           ),
           '[]'::jsonb
         ) as members
  from (values ('rw'), ('posyandu'), ('pkk'), ('bank-sampah'), ('pokmas')) as g(grup)
)
select jsonb_build_object(
  'ok', true,
  'himbauan', (
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'id',       h.id,
               'judul',    h.judul,
               'kategori', h.kategori,
               'gambar',   coalesce(h.image_url, ''),
               'status',   h.status,
               'driveUrl', coalesce(h.image_url, ''),
               'imageUrl', case
                              when coalesce(h.image_file_id, '') <> ''
                                then 'https://drive.google.com/uc?export=view&id=' || h.image_file_id
                              else coalesce(h.image_url, '')
                            end,
               'fileId',   coalesce(h.image_file_id, '')
             )
             order by h.id), '[]'::jsonb)
    from public.himbauan h
    where h.status = 'Aktif'
  ),
  'announcements', (
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'id',       p.id,
               'judul',    p.judul,
               'kategori', p.kategori,
               'ringkasan', p.ringkasan,
               'tanggal',  to_char(p.tanggal, 'DD/MM/YYYY'),
               'status',   p.status
             )
             order by p.tanggal desc, p.id desc), '[]'::jsonb)
    from public.pengumuman p
    where p.status = 'Aktif'
  ),
  'facilities', (
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'id',       f.id,
               'nama',     f.nama,
               'deskripsi', f.deskripsi,
               'foto',     coalesce(f.foto_url, ''),
               'imageUrl', case
                              when coalesce(f.foto_file_id, '') <> ''
                                then 'https://drive.google.com/thumbnail?id=' || f.foto_file_id || '&sz=w1200'
                              else coalesce(f.foto_url, '')
                            end,
               'fileId',   coalesce(f.foto_file_id, ''),
               'maps',     f.maps_url
             )
             order by f.id), '[]'::jsonb)
    from public.fasum f
  ),
  'organization', (
    select coalesce(jsonb_object_agg(o.grup, o.members), '{}'::jsonb)
    from org_agg o
  ),
  'statistik', (
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'id',        s.id,
               'nama',      s.nama_kategori,
               'nilai',     s.nilai,
               'keterangan', s.keterangan,
               'updatedAt', s.updated_at
             )
             order by s.id), '[]'::jsonb)
    from public.statistik_warga s
  )
)
$func$;

comment on function public.get_public_content() is
  'Isi halaman utama website. Hanya memuat konten yang berstatus Aktif.';


-- ============================================================================
--  2. kas_report()  —  gantikan publicKasReport_ (Code.gs:459)
-- ============================================================================
--  Buku kas bulanan, tetap publik seperti sekarang.
--
--  SETELAH 0002b, peran anon tidak boleh menyentuh tabel kas. Fungsi ini
--  dibiarkan `security definer` supaya database membaca sendiri, lalu hanya
--  mengembalikan ringkasan bulanan - persis data yang sudah terbuka di website.
--
--  Meniru penguncian nilai dari clampMonth_ / clampYear_ (Code.gs:446-457):
--    bulan  -> 0..11
--    tahun  -> (tahun sekarang - 2) .. (tahun sekarang + 1)
-- ============================================================================

create or replace function public.kas_report(p_bulan int, p_tahun int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $func$
declare
  v_skrg date := (now() at time zone 'Asia/Jakarta')::date;
  -- PERHATIKAN INDEKS BULAN.
  -- Website mengirim bulan 0-indexed: 0=Januari .. 11=Desember
  -- (main.js:951 memakai `opt.value = i`, dan Code.gs:462 memakai getMonth()).
  --  Di PostgreSQL, extract(month from ...) 1-indexed: 1=Januari .. 12=Desember.
  -- Kalau tidak diterjemahkan di sini, permintaan "Agustus" (nilai 7) akan
  -- diam-diam menampilkan data Juli. Dua basis penghitungan, dua angka berbeda.
  v_bulan0 int := least(11, greatest(0, coalesce(p_bulan, extract(month from v_skrg)::int - 1)));
  v_bulan  int := v_bulan0 + 1;   -- dipakai untuk membandingkan dengan SQL
  v_tahun  int := least(extract(year from v_skrg)::int + 1,
                        greatest(extract(year from v_skrg)::int - 2,
                                 coalesce(p_tahun, extract(year from v_skrg)::int)));
  v_saldo_awal  numeric := 0;
  v_total_masuk numeric := 0;
  v_total_keluar numeric := 0;
  v_updated timestamptz;
  v_masuk jsonb;
  v_keluar jsonb;
begin
  -- Code.gs:504-510. Baris sebelum bulan yang dipilih dihitung sebagai saldo awal.
  select
    coalesce(sum(k.masuk - k.keluar)
             filter (where (extract(year from k.tanggal)::int, extract(month from k.tanggal)::int)
                                < (v_tahun, v_bulan)), 0),
    coalesce(sum(k.masuk)
             filter (where extract(month from k.tanggal)::int = v_bulan
                 and extract(year  from k.tanggal)::int = v_tahun), 0),
    coalesce(sum(k.keluar)
             filter (where extract(month from k.tanggal)::int = v_bulan
                 and extract(year  from k.tanggal)::int = v_tahun), 0),
    max(k.updated_at)
  into v_saldo_awal, v_total_masuk, v_total_keluar, v_updated
  from public.kas k
  where k.status = 'Disetujui'
    and k.tanggal is not null;

  -- Code.gs:507-508. Diurutkan menaik berdasarkan tanggal.
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'tanggal', to_char(k.tanggal, 'DD/MM/YYYY'),
             'uraian',  k.uraian,
             'nominal', k.masuk)
           order by k.tanggal), '[]'::jsonb)
    into v_masuk
  from public.kas k
  where k.status = 'Disetujui'
    and k.tanggal is not null
    and k.masuk > 0
    and extract(month from k.tanggal)::int = v_bulan
    and extract(year  from k.tanggal)::int = v_tahun;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'tanggal', to_char(k.tanggal, 'DD/MM/YYYY'),
             'uraian',  k.uraian,
             'nominal', k.keluar)
           order by k.tanggal), '[]'::jsonb)
    into v_keluar
  from public.kas k
  where k.status = 'Disetujui'
    and k.tanggal is not null
    and k.keluar > 0
    and extract(month from k.tanggal)::int = v_bulan
    and extract(year  from k.tanggal)::int = v_tahun;

  return jsonb_build_object(
    'ok',           true,
    'saldoAwal',    v_saldo_awal,
    'totalMasuk',   v_total_masuk,
    'totalKeluar',  v_total_keluar,
    'saldoAkhir',   v_saldo_awal + v_total_masuk - v_total_keluar,
    'rincianMasuk',  v_masuk,
    'rincianKeluar', v_keluar,
    'updatedAt',    to_jsonb(coalesce(v_updated, now()))
  );
end;
$func$;

comment on function public.kas_report(int, int) is
  'Laporan kas satu bulan. Menggantikan publicKasReport_ (Code.gs:459). Dipakai website publik.';


-- ============================================================================
--  3. kas_cash_flow()  —  gantikan publicKasCashFlow_ (Code.gs:1702)
-- ============================================================================
--  Grafik arus kas bulanan. Mengembalikan deret bulan lengkap termasuk bulan
--  yang tidak punya transaksi (nilai 0) - sama seperti kode lama, yang membuat
--  daftar bulan lebih dulu lalu baru mengisinya (Code.gs:1707-1714).
--  Batas aman: 120 bulan (Code.gs:1713).
-- ============================================================================

create or replace function public.kas_cash_flow(
  p_bulan_awal int, p_tahun_awal int,
  p_bulan_akhir int, p_tahun_akhir int
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $func$
declare
  v_skrg        date := (now() at time zone 'Asia/Jakarta')::date;
  -- Sama seperti kas_report: input 0-indexed (0=Januari), dipakai 1-indexed.
  v_bulan_awal0  int := least(11, greatest(0, coalesce(p_bulan_awal,  extract(month from v_skrg)::int - 1)));
  v_bulan_akhir0 int := least(11, greatest(0, coalesce(p_bulan_akhir, extract(month from v_skrg)::int - 1)));
  v_bulan_awal   int := v_bulan_awal0 + 1;
  v_bulan_akhir  int := v_bulan_akhir0 + 1;
  v_tahun_awal  int := least(extract(year from v_skrg)::int + 1,
                             greatest(extract(year from v_skrg)::int - 2,
                                      coalesce(p_tahun_awal, extract(year from v_skrg)::int)));
  v_tahun_akhir int := least(extract(year from v_skrg)::int + 1,
                             greatest(extract(year from v_skrg)::int - 2,
                                      coalesce(p_tahun_akhir, extract(year from v_skrg)::int)));
  v_saldo_awal numeric;
  v_data jsonb;
begin
  -- Code.gs:1767-1769. Rentang terbalik menghasilkan array kosong, bukan error.
  if v_tahun_awal > v_tahun_akhir
     or (v_tahun_awal = v_tahun_akhir and v_bulan_awal > v_bulan_akhir) then
    return jsonb_build_object('ok', true, 'data', '[]'::jsonb);
  end if;

  select coalesce(sum(k.masuk - k.keluar), 0)
    into v_saldo_awal
  from public.kas k
  where k.status = 'Disetujui'
    and k.tanggal is not null
    and (extract(year from k.tanggal)::int, extract(month from k.tanggal)::int)
        < (v_tahun_awal, v_bulan_awal);

  -- STRUKTUR PENTING
  -- -----------------
  -- 1. Hanya boleh ada SATU klausa WITH di satu statement. Semua CTE ditulis
  --    dalam satu daftar yang dipisahkan koma, tidak boleh ada `with` kedua.
  --
  -- 2. Saldo berjalan harus dihitung pada level query tersendiri (`deret`),
  --    BUKAN di dalam jsonb_agg. PostgreSQL tidak mengizinkan window function
  --    (`sum(...) over (...)`) berada di dalam argumen aggregate seperti
  --    jsonb_agg. Kalau dipaksakan, error 42803: "aggregate function calls
  --    cannot contain window function calls".
  --
  --    Jadi urutannya wajib: hitung dulu saldo berjalan per bulan -> baru
  --    kumpulkan seluruh bulan menjadi satu JSON.
  --
  -- 3. Deret bulan dibangun lebih dulu, lalu diisi. Karena itu bulan tanpa
  --    transaksi tetap muncul dengan nilai 0 - sama seperti Code.gs:1707-1714.
  with months as (
    select
      extract(month from gs)::int as bulan,
      extract(year  from gs)::int as tahun,
      -- Daftar label ditulis manual, bukan to_char(gs,'Mon'), supaya hasilnya
      -- tidak ikut berubah karena pengaturan locale server.
      case extract(month from gs)::int
        when  1 then 'Jan' when  2 then 'Feb' when  3 then 'Mar'
        when  4 then 'Apr' when  5 then 'Mei' when  6 then 'Jun'
        when  7 then 'Jul' when  8 then 'Agu' when  9 then 'Sep'
        when 10 then 'Okt' when 11 then 'Nov' when 12 then 'Des'
      end || ' ' || extract(year from gs)::int as label
    from generate_series(
           make_date(v_tahun_awal,  v_bulan_awal,  1),
           make_date(v_tahun_akhir, v_bulan_akhir, 1),
           interval '1 month'
         ) as gs
    limit 120
  ),
  per_bulan as (
    select
      extract(month from k.tanggal)::int as bulan,
      extract(year  from k.tanggal)::int as tahun,
      sum(k.masuk)  as masuk,
      sum(k.keluar) as keluar
    from public.kas k
    where k.status = 'Disetujui' and k.tanggal is not null
    group by 1, 2
  ),
  deret as (
    select
      m.tahun,
      m.bulan,
      m.label,
      coalesce(p.masuk,  0) as masuk,
      coalesce(p.keluar, 0) as keluar,
      v_saldo_awal
        + sum(coalesce(p.masuk, 0) - coalesce(p.keluar, 0))
          over (order by m.tahun, m.bulan) as saldo
    from months m
    left join per_bulan p
      on p.bulan = m.bulan
     and p.tahun = m.tahun
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'label',  d.label,
             'masuk',  d.masuk,
             'keluar', d.keluar,
             'saldo',  d.saldo
           )
           order by d.tahun, d.bulan), '[]'::jsonb)
    into v_data
  from deret d;

  return jsonb_build_object('ok', true, 'data', v_data);
end;
$func$;

comment on function public.kas_cash_flow(int, int, int, int) is
  'Deret arus kas antar bulan. Menggantikan publicKasCashFlow_ (Code.gs:1702).';


-- ============================================================================
--  4. list_kas()  —  gantikan listKas_ (Code.gs:1391)
-- ============================================================================
--  Daftar transaksi untuk tabel di portal admin, dengan pencarian + filter +
--  penomoran halaman. Hanya untuk admin yang punya modul 'kas'.
--
--  TIDAK memakai security definer: RLS di 0002_rls.sql sudah membatasi tabel
--  kas hanya untuk yang punya akses modul 'kas'.
--
--  Perubahan dari versi lama: identitas baris adalah `id` (uuid), bukan
--  `rowNum`. Di Sheets nomor baris bergeser setiap kali ada baris yang dihapus
--  di atasnya, sehingga transaksi bisa keliru disetujui. UUID tidak bergeser.
-- ============================================================================

create or replace function public.list_kas(
  p_page    int default 1,
  p_perpage int default 10,
  p_q       text default null,
  p_status  text default null
)
returns jsonb
language plpgsql
stable
set search_path = public
as $func$
declare
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_q      text := lower(btrim(coalesce(p_q, '')));
  v_perpage int  := greatest(1, least(50, coalesce(p_perpage, 10)));
  v_total   int;
  v_pages   int;
  v_page    int;
  v_me      public.profiles;
  v_data    jsonb;
begin
  if not public.has_menu('kas') then
    raise exception 'Anda tidak memiliki akses ke menu ini.' using errcode = '42501';
  end if;

  -- `select * into` dari fungsi yang mengembalikan composite type bisa
  -- membingungkan. Penugasan langsung jauh lebih jelas.
  v_me := public.current_profile();

  with filtered as (
    select k.*
    from public.kas k
    where (v_status is null or k.status = v_status)
      -- Code.gs:1402-1410. Semua kata kunci harus muncul (AND, bukan OR).
      --
      -- Memakai position() BUKAN LIKE. Di LIKE, karakter % dan _ pada kata
      -- kunci diperlakukan sebagai wildcard, sedangkan Code.gs memakai
      -- indexOf() yang mencari teks apa adanya. Kalau ada uraian kas berisi
      -- "_", pencarian dengan LIKE akan mengembalikan hasil yang salah.
      and (
        v_q = ''
        or not exists (
          select 1
          from unnest(string_to_array(v_q, ' ')) as w(word)
          where w.word <> ''
            and position(w.word in lower(k.uraian)) = 0
        )
      )
  )
  select count(*)::int into v_total from filtered;

  v_pages := greatest(1, ceil(v_total::numeric / v_perpage)::int);
  v_page  := least(greatest(1, coalesce(p_page, 1)), v_pages);

  with filtered as (
    select k.*
    from public.kas k
    where (v_status is null or k.status = v_status)
      and (
        v_q = ''
        or not exists (
          select 1
          from unnest(string_to_array(v_q, ' ')) as w(word)
          where w.word <> ''
            and position(w.word in lower(k.uraian)) = 0
        )
      )
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id',             k.id,
             'legacyRow',      k.legacy_row,
             -- Format DD/MM/YYYY, sama seperti yang dibaca main.js (parseDate).
             'tanggal',        to_char(k.tanggal, 'DD/MM/YYYY'),
             'uraian',         k.uraian,
             'pj',             k.pj,
             'metode',         k.metode,
             'masuk',          k.masuk,
             'keluar',         k.keluar,
             'keterangan',     k.keterangan,
             'fileUrl',        coalesce(k.bukti_url, ''),
             'fileId',         coalesce(k.bukti_file_id, ''),
             'imageUrl',       case
                                  when coalesce(k.bukti_file_id, '') <> ''
                                    then 'https://drive.google.com/thumbnail?id=' || k.bukti_file_id || '&sz=w1200'
                                  else coalesce(k.bukti_url, '')
                                end,
             'status',         k.status,
             'createdBy',      k.created_by_name,
             'createdById',    k.created_by,
             'approvedBy',     k.approved_by_name,
             'approvedById',   k.approved_by,
             'alasanDitolak',  k.alasan_ditolak,
             'createdAt',      to_jsonb(k.created_at),
             'updatedAt',      to_jsonb(k.updated_at)
           )
           -- Code.gs:1394. Urutan tanggal terbaru dulu.
           order by k.tanggal desc, k.created_at desc
         ), '[]'::jsonb)
    into v_data
  from public.kas k
  where (v_status is null or k.status = v_status)
    and (
      v_q = ''
      or not exists (
        select 1
        from unnest(string_to_array(v_q, ' ')) as w(word)
        where w.word <> ''
          and position(w.word in lower(k.uraian)) = 0
      )
    )
  limit v_perpage
  offset (v_page - 1) * v_perpage;

  return jsonb_build_object(
    'ok',         true,
    'data',       v_data,
    'total',      v_total,
    'page',       v_page,
    'perPage',    v_perpage,
    'totalPages', v_pages,
    'userRole',   v_me.role,
    'userId',     v_me.legacy_id,
    'userNama',   v_me.nama
  );
end;
$func$;


-- ============================================================================
--  5. kas_dashboard()  —  gantikan kasDashboardData_ (Code.gs:1649)
-- ============================================================================
--  Ringkasan untuk kartu dasbor + daftar notifikasi approve.
--
--  Perhatikan logikanya: saldoAkhir di sini BUKAN saldo keseluruhan, melainkan
--  `totalMasuk - totalKeluar` untuk bulan berjalan saja (Code.gs:1687). Itu
--  perilaku yang agak membingungkan tapi sudah jadi kebiasaan, jadi
--  dipertahankan agar angka di layar admin tidak melompat saat migrasi.
-- ============================================================================

create or replace function public.kas_dashboard()
returns jsonb
language plpgsql
stable
set search_path = public
as $func$
declare
  v_me     public.profiles;
  v_bulan  int := extract(month from (now() at time zone 'Asia/Jakarta'))::int;
  v_tahun  int := extract(year  from (now() at time zone 'Asia/Jakarta'))::int;
  v_result jsonb;
begin
  if not public.has_menu('kas') then
    raise exception 'Anda tidak memiliki akses ke menu ini.' using errcode = '42501';
  end if;

  v_me := public.current_profile();

  with bulan_ini as (
    select coalesce(sum(k.masuk),  0) as total_masuk,
           coalesce(sum(k.keluar), 0) as total_keluar,
           count(*) filter (where k.masuk > 0 or k.keluar > 0) as jumlah_transaksi
    from public.kas k
    where k.status = 'Disetujui'
      and k.tanggal is not null
      and extract(month from k.tanggal)::int = v_bulan
      and extract(year  from k.tanggal)::int = v_tahun
  ),
  hit as (
    select
      count(*) filter (where k.status = 'Menunggu')::int as menunggu,
      count(*) filter (where k.status = 'Ditolak'
                         and k.created_by = v_me.id)::int as ditolak
    from public.kas k
  )
  select jsonb_build_object(
    'totalMasuk',     b.total_masuk,
    'totalKeluar',    b.total_keluar,
    'saldoAkhir',     b.total_masuk - b.total_keluar,
    'jumlahTransaksi', b.jumlah_transaksi,
    'menungguCount',  h.menunggu,
    'ditolakCount',   h.ditolak
  )
  into v_result
  from bulan_ini b, hit h;

  -- Code.gs:1662 dan 1666. Notifikasi untuk transaksi yang menunggu persetujuan
  -- (semua orang) dan yang ditolak (hanya milik user yang sedang login).
  v_result := v_result || jsonb_build_object(
    'notifications', coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'type',      k.status,
                   'id',        k.id,
                   'uraian',    k.uraian,
                   'tanggal',   to_char(k.tanggal, 'DD/MM/YYYY'),
                   'createdBy', k.created_by_name
                 )
                 order by k.tanggal desc, k.created_at desc
               )
        from public.kas k
        where k.status = 'Menunggu'
           or (k.status = 'Ditolak' and k.created_by = v_me.id)
      ),
      '[]'::jsonb
    )
  );

  return v_result;
end;
$func$;


-- ============================================================================
--  6. visitor_stats()  —  gantikan getVisitorStats_ (Code.gs:560)
-- ============================================================================
--  Hanya Super Admin. Karena tabel visitor_log tertutup untuk anon dan untuk
--  admin biasa, fungsi ini memakai security definer - tapi gerbang role
--  diperiksa lebih dulu, jadi tidak ada celah.
-- ============================================================================

create or replace function public.visitor_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $func$
declare
  v_hari_ini date := (now() at time zone 'Asia/Jakarta')::date;
  v_result   jsonb;
begin
  if public.current_role() is distinct from 'Super Admin' then
    raise exception 'Hanya Super Admin yang dapat melakukan tindakan ini.'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total',          (select count(*) from public.visitor_log),
    'today',          (select count(*) from public.visitor_log where tanggal = v_hari_ini),
    'uniqueSessions', (select count(distinct v.session_id)
                         from public.visitor_log v
                        where coalesce(v.session_id, '') <> ''),
    'daily', (
      -- Code.gs:592-597. Selalu 14 titik, termasuk hari yang jumlah/null.
      select coalesce(jsonb_agg(
               jsonb_build_object(
                 'date',  to_char(d.tgl, 'YYYY-MM-DD'),
                 'label', to_char(d.tgl, 'DD/MM'),
                 'count', d.jumlah)
               order by d.tgl), '[]'::jsonb)
      from (
        -- Cast eksplisit ke timestamp: tanpa itu Postgres bisa memilih
        -- generate_series(timestamptz, timestamptz, interval), dan zona waktu
        -- server (UTC) ikut menggeser tanggalnya.
        select gs::date as tgl,
               (select count(*) from public.visitor_log v where v.tanggal = gs::date) as jumlah
        from generate_series(
               (v_hari_ini - 13)::timestamp,
               v_hari_ini::timestamp,
               interval '1 day'
             ) as gs
      ) d
    ),
    'topPages', (
      select coalesce(jsonb_agg(jsonb_build_object('page', p.halaman, 'count', p.jumlah)
                                order by p.jumlah desc, p.halaman), '[]'::jsonb)
      from (
        select coalesce(nullif(v.page, ''), '/') as halaman, count(*) as jumlah
        from public.visitor_log v
        group by 1
        order by jumlah desc
        limit 8
      ) p
    ),
    'topRefs', (
      -- Code.gs:586. Ambil nama host dari referrer; kalau gagal diurai, pakai
      -- 40 karakter pertama.
      select coalesce(jsonb_agg(jsonb_build_object('ref', r.sumber, 'count', r.jumlah)
                                order by r.jumlah desc, r.sumber), '[]'::jsonb)
      from (
        select coalesce(nullif(substring(v.referrer from '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/]+)'), ''),
                        left(v.referrer, 40)) as sumber,
               count(*) as jumlah
        from public.visitor_log v
        where coalesce(v.referrer, '') <> ''
        group by 1
        order by jumlah desc
        limit 8
      ) r
    ),
    'langs', (
      -- Code.gs:588. Kunci bahasa dipotong 10 karakter pertama.
      select coalesce(jsonb_object_agg(l.bahasa, l.jumlah), '{}'::jsonb)
      from (
        select left(v.bahasa, 10) as bahasa, count(*) as jumlah
        from public.visitor_log v
        where coalesce(v.bahasa, '') <> ''
        group by 1
      ) l
    )
  )
  into v_result;

  -- Code.gs:598. Jumlah kunjungan 7 hari terakhir.
  --
  -- PENTING: kunci di dalam JSON bernama 'count', BUKAN 'jumlah'. Menulis
  -- `d.jumlah` di sini tidak error - ia hanya menghasilkan NULL, sehingga
  -- sum() jadi NULL dan last7 selalu bernilai 0. Bug yang tidak kelihatan.
  return v_result || jsonb_build_object(
    'last7', coalesce(
      (
        select sum((d ->> 'count')::bigint)
        from jsonb_array_elements(v_result -> 'daily') as d
        where (d ->> 'date')::date > v_hari_ini - 7
      ),
      0
    )
  );
end;
$func$;


-- ============================================================================
--  7. visitor_logs()  —  gantikan getVisitorLogs_ (Code.gs:605)
-- ============================================================================
--  Tabel log kunjungan + pencarian. Hanya Super Admin.
-- ============================================================================

create or replace function public.visitor_logs(
  p_page   int default 1,
  p_limit  int default 20,
  p_search text default null,
  p_from   text default null,
  p_to     text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $func$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_from   date := nullif(btrim(coalesce(p_from, '')), '')::date;
  v_to     date := nullif(btrim(coalesce(p_to,   '')), '')::date;
  v_limit  int  := greatest(1, least(100, coalesce(p_limit, 20)));
  v_total  int;
  v_pages  int;
  v_page   int;
  v_data   jsonb;
begin
  if public.current_role() is distinct from 'Super Admin' then
    raise exception 'Hanya Super Admin yang dapat melakukan tindakan ini.'
      using errcode = '42501';
  end if;

  with filtered as (
    select v.*
    from public.visitor_log v
    where (v_from is null or v.tanggal >= v_from)
      and (v_to   is null or v.tanggal <= v_to)
      -- Code.gs:615. Pencarian menyatu seluruh kolom. Pakai position() supaya
      -- % dan _ pada kata kunci diperlakukan sebagai teks biasa, bukan wildcard.
      and (v_search is null
           or position(v_search in lower(concat_ws(' ', v.page, v.referrer, v.ua, v.bahasa, v.screen, v.session_id))) > 0)
  )
  select count(*)::int into v_total from filtered;

  v_pages := greatest(1, ceil(v_total::numeric / v_limit)::int);
  v_page  := least(greatest(1, coalesce(p_page, 1)), v_pages);

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id',        v.id,
             'timestamp', to_char(v.visited_at at time zone 'Asia/Jakarta', 'DD/MM/YYYY HH24:MI'),
             'tanggal',   to_char(v.tanggal, 'YYYY-MM-DD'),
             'page',      v.page,
             'referrer',  v.referrer,
             'ua',        v.ua,
             'bahasa',    v.bahasa,
             'screen',    v.screen,
             'sessionId', v.session_id
           )
           order by v.visited_at desc
         ), '[]'::jsonb)
    into v_data
  from public.visitor_log v
  where (v_from is null or v.tanggal >= v_from)
    and (v_to   is null or v.tanggal <= v_to)
    and (v_search is null
         or position(v_search in lower(concat_ws(' ', v.page, v.referrer, v.ua, v.bahasa, v.screen, v.session_id))) > 0)
  limit v_limit
  offset (v_page - 1) * v_limit;

  return jsonb_build_object(
    'ok',         true,
    'data',       v_data,
    'total',      v_total,
    'page',       v_page,
    'limit',      v_limit,
    'totalPages', v_pages
  );
end;
$func$;


-- ============================================================================
--  8. GRANT
-- ============================================================================
--  Fungsi di 0001/0002 sudah tercabut haknya oleh `revoke all on all
--  functions ... from public`, jadi grant di sini ditulis eksplisit.
-- ============================================================================

-- Dipakai oleh website publik (tanpa login).
grant execute on function
  public.get_public_content(),
  public.kas_report(int, int),
  public.kas_cash_flow(int, int, int, int)
  to anon, authenticated;

-- Hanya admin.
grant execute on function
  public.list_kas(int, int, text, text),
  public.kas_dashboard(),
  public.visitor_stats(),
  public.visitor_logs(int, int, text, text, text)
  to authenticated;

commit;
