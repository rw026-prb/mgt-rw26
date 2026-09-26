# Portal Manajemen RW 26

Portal administrasi responsif untuk RW 26 Pengasinan, Rawalumbu. Dibangun dengan Bootstrap 5 dan dapat langsung dibuka melalui `index.html`.

## Fitur

- Dashboard ringkasan data warga
- Himbauan dan papan pengumuman
- Berita dan informasi lingkungan
- Data fasilitas umum
- Struktur organisasi pengurus
- Manajemen pengguna dan hak akses
- Mode terang/gelap serta navigasi responsif

## Menjalankan

### 1. Siapkan backend Google Sheet

1. Buka spreadsheet RW 26.
2. Pilih **Extensions → Apps Script**.
3. Salin isi `Code.gs` proyek ini ke editor Apps Script.
4. Jalankan fungsi `setupAllSheets` satu kali dan izinkan akses. Fungsi ini membuat seluruh sheet yang dibutuhkan (user, himbauan, informasi, berita, fasum, organisasi, album, video, video_kegiatan, statistik_warga, visitor_log, activity_log) beserta header-nya.
5. Jalankan `installWarmTrigger` satu kali. Fungsi ini memasang trigger yang mengisi cache setiap 10 menit agar pengunjung tidak pernah menunggu proses baca spreadsheet.
6. Pilih **Deploy → New deployment → Web app**.
7. Atur **Execute as: Me** dan **Who has access: Anyone**.
8. Salin URL Web App hasil deployment.
9. Tempel URL tersebut pada nilai `APPS_SCRIPT_URL` di `config.js`.

> Setelah memperbarui `Code.gs`, jalankan `setupAllSheets` satu kali lagi setiap kali ada sheet baru yang ditambahkan. Pembacaan sudah tidak membuat sheet otomatis, sehingga salah konfigurasi langsung terlihat sebagai pesan error, bukan diam-diam.

### 2b. Portal warga

Portal warga berada di repo terpisah dan memakai endpoint `publicKasCashFlow` untuk tab Arus Kas. Setelah `Code.gs` diperbarui, deploy ulang versi portal warga agar tidak lagi mengirim satu request per bulan.

### 2. Jalankan portal

Buka `login.html` melalui web server lokal/hosting. Login dapat menggunakan User ID atau email pada spreadsheet.

Struktur kolom yang digunakan:

`User ID | Nama Lengkap | Email | No HP | Role ID | Wilayah ID | Status | Password Hash | Login Terakhir | Tanggal Dibuat`

Struktur tabel himbauan:

`ID | JUDUL | KATEGORI | GAMBAR | STATUS`

Gambar himbauan disimpan ke folder Drive yang dikonfigurasi di `HIMBAUAN_DRIVE_FOLDER_ID`, lalu kolom `GAMBAR` diisi formula hyperlink ke file tersebut.

> Untuk akun pada spreadsheet lama, password teks biasa akan otomatis diganti menjadi hash SHA-256 setelah login pertama berhasil. Password baru disimpan sebagai PBKDF2.

## Catatan performa

- Halaman publik memakai satu cache `public_content` yang disusun ulang dari cache per-modul, sehingga pembacaan spreadsheet hanya terjadi saat cache kosong.
- `warmCache` (dipicu tiap 10 menit) mengisi cache halaman publik, arus kas, dan laporan kas 3 bulan terakhir. Jalankan `warmCache` secara manual dari editor setelah pembaruan besar.
- Saat cache sedang dihitung dan kunci sedang dipakai, pembacaan lain dilayani dari salinan last-known-good, bukan menghitung ulang. Ini mencegah lonjakan saat banyak pengunjung datang bersamaan.
