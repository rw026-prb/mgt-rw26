# Alat migrasi Google Sheets ke Supabase

Folder ini berisi skrip yang memindahkan isi spreadsheet ke database Supabase,
serta alat untuk mengujinya.

| File | Isi |
|---|---|
| `migrate.mjs` | Skrip utama. Membaca Sheets, menulis ke Supabase. |
| `lib.mjs` | Klien Google Sheets + Supabase, dan fungsi parsing. |
| `.env.example` | Daftar variabel yang perlu diisi. Salin jadi `.env`. |
| `test-lib.mjs` | 36 pengujian fungsi tanggal dan parsing. Jalankan sebelum migrasi. |
| `test-migrate.mjs` | 27 pengujian kasus sulit dari data Sheets. |
| `validate-migrations.cjs` | Menjalankan seluruh file SQL di PostgreSQL lokal. |
| `smoke.mjs` | Menguji jalur publik di Supabase produksi memakai kunci `anon`. |
| `cek-aksi.mjs` | Mencocokkan aksi yang dipanggil portal dengan yang ditangani jembatan dan `Code.gs`. |
| `split-codegs.mjs` | Memotong `Code.gs` menjadi bagian galeri/media saja. |

Migrasi (`migrate.mjs`) tidak butuh dependency npm. Yang dibutuhkan hanya
**Node.js 18+**.

Alat pengujian SQL (`validate-migrations.cjs`) memakai `embedded-postgres` yang
mengunduh PostgreSQL asli, jadi hasilnya jauh lebih dapat diandalkan daripada
sekadar pemeriksaan ejaan. Instalasi sekali di awal:

```powershell
npm install
```

---

## 1. Isi `.env`

```powershell
Copy-Item .env.example .env
notepad .env
```

Isi tiga nilai dari Supabase (⚙ Project Settings → API):

| Nilai | Yang dipakai |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | Kunci `anon public` |
| `SUPABASE_SERVICE_ROLE_KEY` | Kunci `service_role` |

> Kunci `service_role` memberi akses penuh ke database dan melewati semua Row
> Level Security. Jangan pernah menempelkannya di file HTML atau JavaScript.
> Kalau bocor, langsung regenerate di Project Settings → API.

---

## 2. Buat service account Google

Skrip membaca spreadsheet lewat Google Sheets API, jadi butuh
akun layanan (service account), lalu 7 spreadsheet itu harus dibagikan ke
akun tersebut.

### 2a. Buat service account

1. Buka https://console.cloud.google.com/
2. Pilih atau buat project Google Cloud
3. Menu **APIs & Services** → **Library** → cari **Google Sheets API** → **Enable**
4. Menu **IAM & Admin** → **Service Accounts** → **Create service account**
   - Nama: `rw026-migrasi`
   - Lewati langkah "Grant access to project"
   - Klik **Create key** → pilih **JSON** → unduh
5. Buka file JSON itu di Notepad. Anda akan butuh `client_email` dan `private_key`.

### 2b. Bagikan 7 spreadsheet ke service account

Setiap spreadsheet harus dibagikan ke email service account. Buka masing-masing,
klik tombol **Share** di kanan atas, paste `client_email`, pilih role
**Viewer** (cukup baca, tidak perlu edit).

| Tab | Link |
|---|---|
| USER | https://docs.google.com/spreadsheets/d/1MYvidwDFe65xCsZz9AP2zAGpv3SHXE9QRxulqULXxGY/edit |
| KAS | https://docs.google.com/spreadsheets/d/1Vq4movo3TW_A8rB0yy4unwowAQm0lAPerJaOMWe2vTuU/edit |
| HIMBAUAN | https://docs.google.com/spreadsheets/d/1CnjK2IQ2bAAIMuQ3C8liNDsz9RP3gy1Ls_Ud6Y9zqdE/edit |
| INFO | https://docs.google.com/spreadsheets/d/15qG8a0brYTc0KjeMof077LcT0rfIxQ9TFRmAkzcpEJs/edit |
| FASUM | https://docs.google.com/spreadsheets/d/1omrKdc4ozp066NqijEOB5gmp0u7U8hIB-0Fb_ccKmJY/edit |
| ORG | https://docs.google.com/spreadsheets/d/1gkMOBSVkBPuLFphl9yggbmWo7uzGcV7QIamwgnBB9X8/edit |
| GALLERY | https://docs.google.com/spreadsheets/d/1oLjA8Ak_dyQ1d6bjnNf4xKrxaLqgd8fk7LYux0UDKUY/edit |

> GALLERY tidak ikut dimigrasi, tapi tetap perlu dibagikan kalau nanti kelihatan
> perlu ikut dicek.

### 2c. Tulis ke `.env`

Salin `client_email` ke `GOOGLE_CLIENT_EMAIL`.

Untuk `GOOGLE_PRIVATE_KEY`, private key di file JSON berupa beberapa baris
dengan baris baru di antaranya. Dalam `.env` harus ditulis dalam **satu baris**
dengan `\n` di setiap pergantian baris:

```
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg...\nOT...\n-----END PRIVATE KEY-----\n"
```

Langkah termudah: buka `.env` di Notepad, klik kanan di dalam tanda kutip,
lalu Paste. Setelah itu hapus semua baris kosong di antara baris yang diawali
`-----`. Penting: jangan menghapus karakter `\n` itu sendiri.

---

## 3. Jalankan

Selalu mulai dari dry-run. Mode ini membaca semua spreadsheet dan menghitung
apa yang akan ditulis, tapi **tidak menyentuh database sama sekali**.

```powershell
node test-lib.mjs              # 36 pengujian fungsi parsing
node migrate.mjs --dry-run     # lihat apa yang akan dimigrasi
```

Baca output dry-run dengan teliti. Perhatikan bagian `MASALAH ditemukan` —
itulah baris yang tidak bisa dimigrasi dengan aman. Setiap masalah dicatat
di tabel `migration_issue` supaya bisa diperiksa manual.

Kalau hasilnya sesuai:

```powershell
node migrate.mjs               # tulis ke database
node migrate.mjs --verify      # atau sekaligus dengan verifikasi
```

### Pilihan

| Flag | Arti |
|---|---|
| `--dry-run` | Jangan menulis apa pun ke database |
| `--verify` | Setelah menulis, cocokkan angka kas dengan logika lama |
| `--force` | Izinkan menimpa tabel `kas` yang sudah berisi data |
| `--skip-visitor` | Lewati `visitor_log` (cenderung besar) |
| `--visitor-days N` | Hanya ambil N hari terakhir log pengunjung (bawaan 90) |

### Urutan eksekusi yang aman

1. `--dry-run`, periksa output
2. Tanpa flag, tulis datanya
3. Cek password admin yang tersimpan di `out/`
4. `--verify` untuk memastikan angka kas tidak berubah

---

## Yang TIDAK dimigrasi

Empat tab ini tetap di Google Apps Script dan file fotonya tetap di Google
Drive. Yang masuk ke Supabase hanya ID file-nya.

- `berita`
- `video` (Video Sambutan)
- `album` (Galeri Foto)
- `video_kegiatan` (Video Kegiatan)

---

## Kalau ada masalah

**`GOOGLE_CLIENT_EMAIL atau GOOGLE_PRIVATE_KEY belum diisi`**
Isi keduanya di `.env`. Pastikan `GOOGLE_PRIVATE_KEY` diapit tanda kutip dan
mengandung `\n` di setiap baris baru.

**`Sheets API error ... 404`**
Spreadsheet belum dibagikan ke service account, atau ID-nya salah.

**`Gagal ambil token Google: {"error":"invalid_grant"}`**
Jam di komputer berbeda lebih dari satu menit, atau private key rusak karena
newline tidak ditulis sebagai `\n`.

**`Tabel kas sudah berisi data`**
Tabel kas sengaja tidak ditulis ulang tanpa persetujuan, karena skrip akan
menghapus isinya dulu. Kalau memang itu yang mau: `node migrate.mjs --force`.

**`new row for relation "kas" violates check constraint`**
Ada baris dengan nominal nol semua, atau metode di luar `Tunai`/`Transfer`.
Skrip sebenarnya sudah menyaringnya sebelum menulis; kalau muncul, berarti
masih ada baris lain yang belum tertangkap. Lihat `migration_issue`.

---

## Menguji perubahan SQL tanpa Supabase

Kalau mengubah file di `../migrations/`, jangan langsung paste ke Supabase.
Jalankan lebih dulu di PostgreSQL lokal:

```powershell
npm install embedded-postgres pg
node validate-migrations.cjs
```

Perintah ini menjalankan seluruh file migrasi pada PostgreSQL sungguhan,
lalu menguji perilakunya. Kalau semuanya `OK` di sini, hampir pasti bisa
lolos juga di Supabase.
