/**
 * Konfigurasi Portal Manajemen RW 26.
 *
 * Isi nilai-nilai ini setelah backend Google Apps Script dideploy, dan setelah
 * proyek Supabase dibuat.
 *
 * ---------------------------------------------------------------------------
 *  MENGAPA KUNCI ANON BOLEH PUBLIK
 * ---------------------------------------------------------------------------
 *  `SUPABASE_ANON_KEY` memang dirancang untuk dipakai di kode browser. Yang
 *  menjaga datanya BUKAN kunci itu, melainkan aturan Row Level Security di
 *  database. Tanpa aturan RLS, kunci ini termasuk bisa membaca seluruh isi
 *  database - jadi pastikan 0002_rls.sql dan 0002b_lockdown.sql sudah
 *  dijalankan sebelum membuka portal ini ke publik.
 *
 *  Kunci `service_role` TIDAK boleh pernah ada di file ini atau di mana pun
 *  yang dikirim ke browser. Kunci itu disimpan di Script Properties milik
 *  Google Apps Script.
 */

/** Alamat proyek Supabase. */
const SUPABASE_URL = 'https://puoahgfoaeuyaeerxbnt.supabase.co';

/**
 * Kunci "anon public". Boleh publik - inilah yang dipakai portal admin dan
 * website warga untuk membaca data yang memang terbuka.
 */
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1b2FoZ2ZvYWV1eWFlZXJ4Ym50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxMDgxMjAsImV4cCI6MjEwMjY4NDEyMH0.B4iw5kFsnmz-_i2UT7M7V9dh0_SxGXPD23vFdXfXucs';

/**
 * URL Web App hasil deployment Google Apps Script.
 *
 * Dipakai untuk: galeri foto, berita, video, dan unggah foto ke Google Drive.
 *
 * Buat deployment BARU setiap kali memperbarui Code.gs, lalu ganti nilai di
 * sini. URL deployment lama pernah ikut ter-commit ke repository publik, jadi
 * tidak boleh dipakai lagi.
 */
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx-jZ6Q8SfUblW0oDW7JokjorLll0Jd9xKzvPPcg-LtdharV2_KE4bGfwNOJGchwwcU/exec';

window.RW26_CONFIG = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  APPS_SCRIPT_URL
};
