# Portal Manajemen RW 26

Portal administrasi untuk RW 26 Pengasinan, Rawalumbu.

> **STATUS: sedang migrasi ke Supabase.**
> Data sudah dipindahkan. `Code.gs` sudah ditipiskan. Portal admin
> (`index.html`) dan portal warga (`Website-RW26`) belum diarahkan ke
> Supabase - selama itu belum selesai, keduanya masih membaca dari Apps
> Script seperti biasa.

## Arsitektur sekarang

| Lapisan | Isi | Tempat |
|---|---|---|
| Data | Himbauan, pengumuman, fasum, organisasi, statistik, kas, user, log | **Supabase (PostgreSQL)** |
| Media | Foto galeri, foto berita, foto modul lain | **Google Drive** (tetap) |
| Media metadata | Album, `video`, `video_kegiatan`, `berita` | **Google Sheets** (tetap, hanya 4 tab) |
| Galeri, video, berita | Diproses oleh | **Google Apps Script** (`Code.gs`, sudah tipis dari 2.042 jadi 996 baris) |
| Foto modul Supabase | Diunggah lewat aksi `uploadDriveImage` | **Apps Script → Drive** |

Yang **tidak lagi** ditangani `Code.gs`: autentikasi, sesi, pengguna, kas,
statistik, organisasi, fasilitas, pengumuman, himbauan, log pengunjung, dan log
aktivitas. Semuanya dipindah ke Supabase.

Detail skema database ada di `supabase/migrations/`. Alat migrasi dan pengujian
ada di `supabase/tools/` (lihat README-nya di sana).

## Menjalankan

### 1. Siapkan backend Apps Script

1. Buka spreadsheet RW 26 → **Extensions → Apps Script**.
2. Salin isi `Code.gs` proyek ini ke editor Apps Script (ganti seluruh isi).
3. **Pasang kredensial Supabase** — jalankan fungsi `setupSupabaseConfig_` satu
   kali dari editor, dengan ketiga nilai dari Supabase → Project Settings → API:

   ```javascript
   setupSupabaseConfig_(
     'https://xxxxxxxx.supabase.co',
     'kunci-anon-public',
     'kunci-service-role'
   );
   ```

   Nilai disimpan di **Script Properties**, bukan di dalam `Code.gs` - file ini
   ikut ter-*commit* ke repository publik, jadi tidak boleh memuat kredensial.

4. Jalankan `setupGallerySheet`, `setupVideoSheet`, dan `setupVideoKegiatanSheet`
   satu kali (hanya perlu kalau tab-nya belum ada).
5. Jalankan `installWarmTrigger` satu kali. Trigger ini mengisi cache tiap 10
   menit agar pengunjung tidak menunggu pembacaan spreadsheet.
6. **Deploy → New deployment → Web app**, dengan **Execute as: Me** dan
   **Who has access: Anyone**.
7. Salin URL Web App, tempel ke `APPS_SCRIPT_URL` di `config.js`.

> **Rotasi URL.** `config.js` versi lama (yang masih ada di riwayat git)
> memuat URL deployment yang sekarang sudah tidak dipakai. Buat **deployment
> baru**, jangan memakai URL lama.

### 2. Jalankan portal

Buka `login.html` lewat web server lokal atau hosting.

> Login masih memakai alur `login` versi lama dan **akan berhenti bekerja** begitu
> portal diarahkan ke Supabase Auth (Fase 6). Sampai saat itu, jangan
> Montessori data baru lewat portal -$data baru masuk ke Sheets, bukan
> PostgreSQL.

## Aksi yang dilayani Apps Script

| Modul | Aksi |
|---|---|
| Galeri Foto | `listGalleryAlbums`, `createGalleryAlbum`, `deleteGalleryAlbum`, `listGalleryPhotos`, `uploadGalleryPhoto`, `deleteGalleryPhoto` |
| Berita | `listNews`, `createNews`, `updateNews`, `toggleNews`, `deleteNews` |
| Video Sambutan | `listVideos`, `createVideo`, `updateVideo`, `toggleVideo`, `setVideoAutoplay`, `clearVideoAutoplay`, `deleteVideo` |
| Video Kegiatan | `listVideoKegiatan`, `createVideoKegiatan`, `updateVideoKegiatan`, `toggleVideoKegiatan`, `deleteVideoKegiatan` |
| Jembatan | `uploadDriveImage` |

Aksi baca publik: `publicContent` (kini hanya `news`, `gallery`, `videos`,
`videoKegiatan`) dan `publicGalleryPhotos`.

## Keamanan

Web App dideploy dengan akses **Anyone**, jadi endpoint-nya bisa dipanggil siapa
saja. Setiap aksi tulis memanggil `requireSupabaseUser_` +
`requireMenuAccess_` lebih dulu. Aksi `uploadDriveImage` punya tiga lapis
perlindungan: modul harus terdaftar di `DRIVE_FOLDER_BY_MODULE`, hak akses
modul diperiksa, dan tipe MIME dibatasi.

Kunci `service_role` memberi akses penuh ke database. Jangan pernah menaruhnya
di `index.html`, `config.js`, atau `Code.gs`.

## Catatan performa

- `publicContent` dilayani dari cache `public_content` yang disusun dari cache
  per-modul; pembacaan Sheets hanya terjadi saat cache kosong.
- `warmCache` (tiap 10 menit) mengisi cache halaman publik dan album galeri.
  Jalankan manual dari editor setelah pembaruan besar.
- Saat cache sedang dihitung dan kunci sedang dipakai, pembacaan lain dilayani
  dari salinan last-known-good. Mencegah lonjakan saat banyak pengunjung datang
  bersamaan.
- Laporan kas tidak lagi di-cache di sini - dihitung oleh PostgreSQL.
