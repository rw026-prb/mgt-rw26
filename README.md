# Portal Manajemen RW 26

Portal administrasi untuk RW 26 Pengasinan, Rawalumbu.

> **STATUS: seluruh migrasi ke Supabase sudah selesai di sisi kode.**
> Semua data ada di PostgreSQL, `Code.gs` sudah ditipiskan, dan kedua portal
> sudah mengarah ke Supabase. Yang tersisa adalah pengujian menyeluruh, deployment, dan pengaturan domain.

## Arsitektur

| Lapisan | Isi | Tempat |
|---|---|---|
| Data | Himbauan, pengumuman, fasum, organisasi, statistik, kas, user, log | **Supabase (PostgreSQL)** |
| Media | Foto galeri, foto berita, foto modul lain | **Google Drive** |
| Media metadata | Album, `berita`, `video`, `video_kegiatan` | **Google Sheets** (4 tab) |
| Galeri, berita, video | Diproses oleh | **Apps Script** (`Code.gs`, 996 dari 2.042 baris) |
| Unggah foto modul Supabase | Lewat aksi `uploadDriveImage` | **Apps Script → Drive** |

Skema database ada di `supabase/migrations/`. Alat migrasi dan pengujian ada di
`supabase/tools/` (lihat README-nya di sana).

## Langkah menjalankan

### 1. Database

Jalankan file di `supabase/migrations/` **berurutan** lewat Supabase SQL Editor:

```
0001_schema.sql            9 tabel
0002_rls.sql               Row Level Security + fungsi bantu
0002b_lockdown.sql         cabut hak akses langsung untuk peran anon
0003_functions.sql         7 fungsi laporan (kas, konten, pengunjung)
0004_migration_audit.sql   jejak migrasi
0005_bridge_grants.sql     izin service_role untuk Apps Script
0006_organisasi_id.sql     ID otomatis untuk tabel organisasi
```

Setiap file dibungkus `begin; ... commit;`, jadi kalau ada baris yang gagal
seluruh file dibatalkan dan database tidak berubah. Aman dijalankan berulang kali.

Sebelum menempelkan ke Supabase, jalankan pengujian di PostgreSQL lokal:

```powershell
cd supabase/tools
npm install
npm run test:sql
```

### 2. Apps Script

1. Salin isi `Code.gs` ke editor Apps Script (ganti seluruh isi).
2. Jalankan `setupSupabaseConfig_(url, anonKey, serviceRoleKey)` **sekali**.
   Nilai disimpan di Script Properties — bukan di dalam `Code.gs`, karena file ini
   ikut ter-*commit* ke repository publik.
3. Jalankan `installWarmTrigger` sekali.
4. **Deploy → New deployment → Web app**, **Execute as: Me**, **Who has access:
   Anyone**.

### 3. Halaman

| File | Isi nilai |
|---|---|
| `config.js` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `APPS_SCRIPT_URL` |
| `Website-RW26/config.js` | Nilai yang sama |

> `SUPABASE_ANON_KEY` memang dirancang untuk publik. Yang melindungi data adalah
> aturan RLS di database. `service_role` **tidak boleh** muncul di file mana pun
> yang dikirim ke browser.

## Peran pengguna

| Peran | Kemampuan |
|---|---|
| `Super Admin` | Semua menu. Satu-satunya yang boleh menambah dan menghapus pengguna. |
| `Admin` | Semua menu kecuali menambah/menghapus pengguna. |
| `Editor` | Hanya menu yang tercantum di `profiles.menu_access`. |

Kas punya aturan tambahan: hanya `Admin`/`Super Admin` yang bisa menyetujui atau
menolak transaksi, dan `Editor` hanya bisa mengubah transaksinya sendiri yang
belum disetujui. Aturan ini ditegakkan di database (`0002_rls.sql`), bukan di
browser.

## Aksi yang dilayani Apps Script

Galeri (6), Berita (5), Video Sambutan (7), Video Kegiatan (5), `uploadDriveImage`
(1), dan manajemen pengguna (3: `createUser`, `updateUser`, `deleteUser`).

Tiga aksi terakhir wajib lewat Apps Script karena memakai kunci `service_role`
yang tidak boleh ada di browser.

Baca publik: `publicContent` (hanya `news`, `gallery`, `videos`,
`videoKegiatan`) dan `publicGalleryPhotos`.

## Catatan performa

- `publicContent` dilayani dari cache `public_content` yang disusun dari cache
  per-modul.
- `warmCache` (tiap 10 menit) mengisi cache halaman publik dan album galeri.
- Laporan kas tidak lagi di-cache di Apps Script - dihitung oleh PostgreSQL.
- Website warga menggabungkan dua sumber (Apps Script + Supabase) secara
  terpisah, sehingga kegagalan satu sisi tidak membuat halaman kosong seluruhnya.
