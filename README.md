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
4. Jalankan fungsi `setupSheet` satu kali dan izinkan akses.
5. Jalankan juga fungsi `setupHimbauanSheet` satu kali untuk menyiapkan tabel himbauan.
6. Pilih **Deploy → New deployment → Web app**.
7. Atur **Execute as: Me** dan **Who has access: Anyone**.
8. Salin URL Web App hasil deployment.
9. Tempel URL tersebut pada nilai `APPS_SCRIPT_URL` di `config.js`.

### 2. Jalankan portal

Buka `login.html` melalui web server lokal/hosting. Login dapat menggunakan User ID atau email pada spreadsheet.

Struktur kolom yang digunakan:

`User ID | Nama Lengkap | Email | No HP | Role ID | Wilayah ID | Status | Password Hash | Login Terakhir | Tanggal Dibuat`

Struktur tabel himbauan:

`ID | JUDUL | KATEGORI | GAMBAR | STATUS`

Gambar himbauan disimpan ke folder Drive yang dikonfigurasi di `HIMBAUAN_DRIVE_FOLDER_ID`, lalu kolom `GAMBAR` diisi formula hyperlink ke file tersebut.

> Untuk akun pada spreadsheet lama, password teks biasa akan otomatis diganti menjadi hash SHA-256 setelah login pertama berhasil.
