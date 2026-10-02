-- ============================================================================
--  0006_organisasi_id.sql  —  ID otomatis untuk tabel organisasi
-- ============================================================================
--  Jalankan SESUDAH 0001_schema.sql.
--
--  Tabel `organisasi` menggabungkan lima tab sheet (rw, posyandu, pkk,
--  bank-sampah, pokmas). Di tiap tab, penomoran dimulai ulang dari ORG-001,
--  jadi `legacy_id` tidak unik secara global. Karena itu primary key memakai
--  UUID, dan `legacy_id` dijaga dengan UNIQUE (grup, legacy_id).
--
--  Modul lain (himbauan, pengumuman, fasum, statistik_warga) sudah punya
--  trigger pengisi ID di 0001_schema.sql. Tabel organisasi belum, dan kolom
--  `legacy_id`-nya NOT NULL - jadi INSERT tanpa ID akan gagal.
--
--  Portal admin mengirim `id` yang mungkin kosong saat menambah anggota baru.
--  Daripada menghitung nomor urut di JavaScript (yang rawan bentrok saat dua
--  orang menyimpan bersamaan), penomoran diserahkan ke database.
-- ============================================================================

begin;

-- Fungsi generik: panggil next_prefixed_id() yang sudah dibuat di 0001.
create or replace function public.tg_fill_organisasi_id()
returns trigger
language plpgsql
volatile
security definer
set search_path = public
as $func$
begin
  if new.legacy_id is null or btrim(new.legacy_id) = '' then
    new.legacy_id := public.next_prefixed_id(
      'public.organisasi', 'legacy_id', 'ORG-', 3
    );
  end if;
  -- sort_order diisi berurutan bila tidak diisi dari sisi klien.
  if new.sort_order = 0 then
    select coalesce(max(o.sort_order), 0) + 1
      into new.sort_order
      from public.organisasi o
     where o.grup = new.grup;
  end if;
  return new;
end;
$func$;

create trigger organisasi_id
  before insert on public.organisasi
  for each row execute function public.tg_fill_organisasi_id();

commit;
