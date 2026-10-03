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
3. Jalankan `setupSupabaseConfig_(null, null, null, publicBaseUrl)` atau isi
   Script Property `PUBLIC_BASE_URL` lewat UI. Dipakai untuk menyusun tautan
   reset password — lihat bagian "Reset password mandiri".
4. Jalankan `installWarmTrigger` sekali.
5. **Deploy → New deployment → Web app**, **Execute as: Me**, **Who has access:
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
(1), manajemen pengguna (3: `createUser`, `updateUser`, `deleteUser`), dan reset
password (3: `requestPasswordReset`, `checkPasswordResetToken`,
`resetPassword`).

Tiga aksi manajemen pengguna wajib lewat Apps Script karena memakai kunci
`service_role` yang tidak boleh ada di browser. Tiga aksi reset password lewat
Apps Script karena alasan lain: tidak ada sesi saat link diminta, dan email-nya
dikirim dari Gmail pemilik proyek.

Baca publik: `publicContent` (hanya `news`, `gallery`, `videos`,
`videoKegiatan`) dan `publicGalleryPhotos`.

## Handler inline harus diekspor ke `window`

`index.html` membungkus seluruh skripnya dalam `(async () => { ... })()`.
Setiap `function` di dalam IIFE itu **hanya hidup selama IIFE berjalan** - dia
tidak menjadi properti `window`.

Tapi atribut inline dieksekusi browser sebagai kode global:

```html
<button onclick="bukaFormKas('masuk')">
```

Kalau nama yang dipanggil tidak ada di `window`, browser melempar
`ReferenceError` dan handler itu **tidak pernah jalan**. Tidak ada yang terlihat
rusak di layar: markup-nya masih utuh, tidak ada error yang muncul, errornya
cuma di konsol.

Gejalanya yang paling membingungkan: `<select>` bulan dan tahun di tab Laporan
Kas dan Arus Kas **ada** di markup tapi **kosong**, karena `<option>`-nya dibuat
oleh fungsi yang tidak pernah terpanggil. Terlihat seperti "filter tidak
muncul", padahal masalahnya di lingkup skrip.

Karena itu setiap fungsi yang dipanggil dari atribut `onclick` harus disalin ke
`window`. Daftar ada di blok "EKSPOR KE window" pada `index.html`, dikelompokkan
per menu.

Pemeriksa yang menjaganya: `node supabase/tools/cek-handler.mjs`. Skrip itu
mencari setiap handler inline di seluruh `.html` dan memastikan namanya benar-benar
ada di lingkup global. Ia juga memeriksa `window.x = x` yang menunjuk fungsi yang
tidak ada - bentuk itu melempar `ReferenceError` dan membuat portal tidak bisa
dimuat sama sekali.

Navigasi sidebar tidak terpengaruh: itu memakai delegasi `data-page` /
`data-navigate` dengan satu `addEventListener`, bukan `onclick`.

## Reset password mandiri

Tautan reset password tidak lagi dibuat dan dikirim oleh Supabase. Yang
mengirimnya adalah Google Apps Script lewat `MailApp`, memakai Gmail pemilik
proyek. Supabase Auth tetap menyimpan passwordnya.

Alasannya: tautan bawaan Supabase mengarah ke **Site URL** proyek. Kalau Site
URL itu tidak sesuai domain yang dipakai, tautannya mendarat di `localhost` dan
tidak bisa dibuka - persis keluhan yang terjadi. Email dari domain Supabase juga
sering masuk spam.

```
login.html ──POST requestPasswordReset──▶ Code.gs
                                          ├─ token acak 256 bit
                                          ├─ hash SHA-256 → public.password_reset_tokens
                                          └─ MailApp → tautan ?token=...

update-password.html ──POST checkPasswordResetToken──▶ validasi, tampilkan formulir
                     ──POST resetPassword───────────▶ set password, hanguskan token
```

Yang perlu dipasang:

1. Jalankan `supabase/migrations/0009_reset_password_sendiri.sql` di SQL Editor.
2. Script Property `PUBLIC_BASE_URL` = `https://mgt.rw026.my.id`. **Wajib** —
   ini alamat yang disisipkan ke tautan dalam email. Kalau kosong, `Code.gs`
   memakai domain produksi sebagai cadangan.
3. Deploy ulang Web App. `Code.gs` berubah, deployment lama tidak ikut.

Catatan operasional:

- **Kuota `MailApp`** sekitar 100 email/hari untuk akun `@gmail.com` biasa,
  1500/hari untuk Google Workspace. Ada cooldown 60 detik per email.
- **Pengirim terkunci** ke Gmail pemilik proyek Apps Script. `MailApp` dan
  `GmailApp` sama-sama mengirim sebagai akun itu; yang bisa diubah hanya nama
  tampilan.
- **Jangan** tambahkan `anon` atau `authenticated` ke grant tabel
  `password_reset_tokens` atau ke fungsi `cari_user_id_by_email`. Keduanya
  hanya untuk `service_role`. Alasannya di kepala migrasi 0009.
- Tautan berlaku 60 menit dan hanya bisa dipakai sekali.

##_dropdown tahun kas mengikuti batas SQL

`kas_report()` dan `kas_cash_flow()` di `0003_functions.sql` membatasi tahun ke
rentang `(tahun_sekarang - 2) .. (tahun_sekarang + 1)`. Tahun di luar itu tidak
ditolak - **diam-diam diganti ke batas terdekat**.

Jadi dropdown tahun di Laporan Kas dan Arus Kas sengaja dibuat memakai rentang
yang sama, lewat `kasTahunBounds()`. Kalau dropdown menawarkan tahun yang tidak
bakal dibaca database, orang memilih "2028", melihat data 2027, dan tidak ada
satu pun pesan yang memberi tahu. Itu lebih buruk daripada tidak menawarkannya.

Kalau suatu saat rentangnya mau diperlebar, ubah di SQL dulu, baru di
`index.html`.

## Pemeriksaan isi berkas

`npm test` di `supabase/tools` menjalankan rangkaian pemeriksaan yang sebagian
hanya mungkin dilakukan karena `index.html` adalah satu berkas 200 KB lebih.
Semuanya keluar dengan kode bukan nol kalau menemukan masalah.

| Skrip | Yang dicari |
|---|---|
| `cek-inline.mjs` | Sintaks skrip inline di dalam `.html`. Langkah `node --check` di CI hanya mencari `*.js` dan `*.mjs`, jadi isi `<script>` di HTML tidak pernah diperiksa - padahal ada ratusan baris di sana. |
| `cek-asing.mjs` | Karakter dari aksara lain (Han, Cyrillic) yang menyusup ke dalam kata Indonesia. |
| `cek-kontrol.mjs` | Karakter kontrol tersembunyi, mis. U+0008 BACKSPACE di tengah kata. TAB, LF, dan CR dikecualikan. |
| `cek-mojibake.mjs` | Teks UTF-8 yang salah dibaca jadi cp1252. `—` jadi tiga karakter, `·` jadi dua. Sintaks tetap sah, tampilannya rusak. |
| `cek-handler.mjs` | Handler `onclick` yang tidak ada di lingkup global, dan `window.x = x` yang menunjuk fungsi tidak ada. |
| `cek-id.mjs` | `getElementById()` yang menunjuk id yang tidak ada di markup. Mengembalikan `null`, bukan error. |
| `samakan-akhir-baris.mjs` | Berkas yang bercampur CRLF dan LF. |
| `cek-aksi.mjs` | Nama aksi `apiRequest()` yang tidak ada di jembatan atau `Code.gs`. |
| `cek-rahasia.mjs` | Kunci `service_role` di berkas yang dipublikasikan. |

Dua skrip memperbaiki, bukan hanya melaporkan:

```powershell
npm run perbaiki:mojibake -- index.html
npm run perbaiki:akhir-baris
```

## Catatan performa

- `publicContent` dilayani dari cache `public_content` yang disusun dari cache
  per-modul.
- `warmCache` (tiap 10 menit) mengisi cache halaman publik dan album galeri.
- Laporan kas tidak lagi di-cache di Apps Script - dihitung oleh PostgreSQL.
- Website warga menggabungkan dua sumber (Apps Script + Supabase) secara
  terpisah, sehingga kegagalan satu sisi tidak membuat halaman kosong seluruhnya.
