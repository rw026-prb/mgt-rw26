// ============================================================================
//  test-pantulan.mjs  —  Bukti bahwa portal tidak bisa terlempar bolak-balik
// ============================================================================
//  BUG YANG DIUJI
//  --------------
//  Portal mengeluarkan pengguna karena sesinya bermasalah, TETAPI tidak
//  memanggil signOut(). Sesi Supabase tetap hidup, sehingga halaman login
//  melihat sesi itu masih sah lalu mengarahkan balik ke portal. Permintaan
//  yang sama gagal lagi, keluar lagi - berulang tanpa henti.
//
//  CARA MENGUJI
//  ------------
//  Fungsi penjaga di login.html DIAMBIL dari berkas itu sendiri, lalu
//  dijalankan di ruang lingkup terkontrol. Yang diuji adalah kode yang
//  benar-benar tayang, bukan tiruan.
//
//  Versi pertama memakai JSDOM untuk memuat seluruh halaman. Itu rapuh:
//  bergantung pada lingkungan dan tenggat waktu, sehingga gagal di runner CI
//  yang lambat. Di sini tidak ada DOM dan tidak ada penantian - hasilnya
//  sama di komputer mana pun, secepat apa pun mesinnya.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DI_SINI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(DI_SINI, '..', '..');
const baca = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

const loginSrc = baca('login.html');
const indexSrc = baca('index.html');
const bridgeSrc = baca(path.join('assets', 'js', 'rw26-api.js'));

let lulus = 0, gagal = 0;
const ok = (n, t) => { lulus++; console.log(`    OK    ${n}${t ? '  ' + t : ''}`); };
const no = (n, t) => { gagal++; console.log(`    SALAH ${n}\n          ${t}`); };

/**
 * Susun ulang penjaga dari login.html, lalu uji di ruang lingkup sendiri.
 * Parameter sessionStorage dan Date sengaja dinamai begitu, supaya penjaga
 * diuji dengan nilai yang sama seperti saat dijalankan di browser sungguhan.
 */
/**
 * Ambil fungsi penjaga dari login.html dengan menghitung kurung kurawal.
 *
 * Regex non-greka bel，香港六 inadequate: fungsi ini punya blok try/catch, jadi
 * pola seperti /function x\(\)\{[\s\S]*?\n\s*\}/ berhenti di kurung penutup
 * blok try - meninggalkan potongan kode yang tidak seimbang dan gagal
 * diparse.
 */
function ambilFungsiBalok(src, nama) {
  const awal = src.indexOf('function ' + nama);
  if (awal < 0) return '';
  const buka = src.indexOf('{', awal);
  if (buka < 0) return '';
  let depth = 0;
  let dalamKutip = '';
  for (let i = buka; i < src.length; i++) {
    const c = src[i];
    if (dalamKutip) {
      if (c === '\\') { i++; continue; }
      if (c === dalamKutip) dalamKutip = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { dalamKutip = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(awal, i + 1);
    }
  }
  return '';
}

function buatPenjaga(sessionStorage, Date) {
  const konstanta = loginSrc.match(/const KELUAR_BARU\s*=\s*[^;]+;/);
  const jeda = loginSrc.match(/const JEDA_KELUAR_MS\s*=\s*[^;]+;/);
  const fungsi = ambilFungsiBalok(loginSrc, 'baruSajaDikeluarkan');
  if (!konstanta || !jeda || !fungsi) {
    return { galat: 'blok penjaga tidak ditemukan di login.html' };
  }
  const badan = [konstanta[0], jeda[0], fungsi, 'return baruSajaDikeluarkan;'].join('\n');
  try {
    return { fn: new Function('sessionStorage', 'Date', badan)(sessionStorage, Date) };
  } catch (e) {
    return { galat: 'gagal menyusun penjaga: ' + e.message };
  }
}

function storageAwal(nilai) {
  const m = new Map();
  if (nilai) m.set(nilai.kunci, nilai.nilai);
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

const SEKARANG = 1_700_000_000_000;

console.log('\n' + '='.repeat(64));
console.log('1. Penanda keluar: keputusan benar di SELURUH rentang waktu');
console.log('='.repeat(64));
{
  const jeda = Number((loginSrc.match(/JEDA_KELUAR_MS\s*=\s*(\d+)/) || [])[1]);
  if (!jeda) {
    no('JEDA_KELUAR_MS tidak terbaca', 'login.html tidak punya konstanta itu');
  } else {
    let salah = 0;
    let contohSalah = '';
    // Setiap 100 ms selama 60 detik.
    for (let ms = 0; ms <= 60000; ms += 100) {
      const st = storageAwal({ kunci: 'rw26_keluar_baru', nilai: String(SEKARANG - ms) });
      const p = buatPenjaga(st, { now: () => SEKARANG });
      if (p.galat) { salah++; contohSalah = p.galat; break; }
      const harusTahan = ms < jeda;
      const dapat = p.fn();
      if (dapat !== harusTahan) {
        salah++;
        if (!contohSalah) contohSalah = `ms=${ms} harus=${harusTahan} didapat=${dapat}`;
      }
    }
    if (salah === 0) {
      ok('601 titik waktu, keputusan selalu benar', `menahan sampai ${jeda / 1000} detik, lalu melepas`);
    } else {
      no('ada titik waktu yang salah', contohSalah);
    }
  }
}

console.log('\n' + '='.repeat(64));
console.log('2. Tanpa penanda: penjaga tidak pernah menahan');
console.log('='.repeat(64));
{
  let salah = 0;
  for (let ms = 0; ms <= 60000; ms += 500) {
    const p = buatPenjaga(storageAwal(null), { now: () => SEKARANG });
    if (p.galat || p.fn() !== false) { salah++; break; }
  }
  if (salah === 0) ok('tanpa penanda, selalu mengizinkan masuk');
  else no('penjaga menahan tanpa alasan', 'seharusnya mengizinkan');
}

console.log('\n' + '='.repeat(64));
console.log('3. Penanda rusak: penjaga tidak boleh membuat halaman macet');
console.log('='.repeat(64));
{
  const rusak = ['abc', 'null', '0', '', '-1', 'NaN'];
  let salah = 0;
  let contoh = '';
  for (const v of rusak) {
    const p = buatPenjaga(storageAwal({ kunci: 'rw26_keluar_baru', nilai: v }), { now: () => SEKARANG });
    if (p.galat) { salah++; contoh = p.galat; break; }
    if (p.fn() !== false) { salah++; contoh = `nilai "${v}" menahan tanpa alasan`; break; }
  }
  if (salah === 0) ok('penanda rusak tidak membekukan halaman login');
  else no('penanda rusak menyebabkan masalah', contoh);
}

console.log('\n' + '='.repeat(64));
console.log('4. Portal TIDAK memicu keluar karena kata "token"');
console.log('='.repeat(64));
{
  const polaLama = /Sesi berakhir\|token\|Sudah keluar/i;
  if (polaLama.test(indexSrc)) {
    no('pola pemicu keluar yang panjang masih ada',
      'index.html masih mencocokkan teks apa pun yang memuat kata itu');
  } else {
    ok('pola pemicu keluar sudah diganti penanda isAuthError');
  }
  if (/err\.isAuthError/.test(indexSrc)) ok('memakai err.isAuthError');
  else no('tidak memakai isAuthError', 'penanda tidak ditemukan');
  if (/RW26\.signOut/.test(indexSrc)) ok('logout() memanggil signOut Supabase');
  else no('logout() tidak memanggil signOut', 'sesi bisa tetap hidup -> pantulan');
  if (/rw26_keluar_baru/.test(indexSrc)) ok('logout() memasang penanda keluar');
  else no('penanda keluar tidak dipasang', 'login.html tidak akan tahu');
}

console.log('\n' + '='.repeat(64));
console.log('5. Jembatan menandai HANYA pesan tentang sesi');
console.log('='.repeat(64));
{
  if (/err\.isAuthError = true/.test(bridgeSrc)) ok('penanda isAuthError ada di jembatan');
  else no('penanda tidak ada', 'cari "err.isAuthError"');

  const polaSempit = /Sesi berakhir|Token tidak valid|belum login|Wajib login/i;
  if (polaSempit.test(bridgeSrc)) ok('pola autentiknya sempit - hanya pesan soal sesi');
  else no('pola autentikasi tidak ditemukan', 'cari pola di callAppsScript');

  if (/async function signOut\(\)/.test(bridgeSrc)) ok('fungsi signOut tersedia untuk portal');
  else no('fungsi signOut tidak ada', 'index.html tidak bisa keluar dengan benar');

  // Pola yang terlalu longgar akan menandai pesan biasa sebagai kegagalan
  // sesi - dan itu yang dulu memicu pantulan tanpa henti.
  //
  // Polanya diambil dari rw26-api.js, bukan ditulis ulang di sini. Kalau
  // ditiru, pengujian ini bisa hijau sementara pintu yang diuji sudah berubah.
  const m = bridgeSrc.match(/\/\s*(Sesi berakhir[^/\n]*\/i)\s*\.test/);
  if (!m) {
    no('pola autentikasi tidak ditemukan', 'cari pola di callAppsScript');
  } else {
    const re = new RegExp(m[1].replace(/\/i$/, ''), 'i');
    // Pesan yang BENAR-BENAR dihasilkan Code.gs. Memakai pesan karangan
    // tidak ada gunanya: kalau kodenya tidak pernah menghasilkannya, gagal
    // atau tidaknya tidak berarti apa-apa.
    const harusDitandai = [
      'Sesi berakhir. Silakan login kembali.',
      'Token tidak valid.'
    ];
    const tidakHarusDitandai = [
      'Aksi API tidak dikenal.',
      'Konfigurasi Supabase belum dipasang. Jalankan setupSupabaseConfig_().',
      // Pesan di bawah ini adalah pemeriksaan PERAN, bukan pemeriksaan SESI.
      // Sesi-nya tetap sah; hanya hak aksesnya yang kurang. Mengeluarkan
      // pengguna karena hal ini akan membuang sesi yang masih berguna.
      'Hanya Super Admin yang dapat melakukan tindakan ini.',
      'Anda tidak memiliki akses ke menu ini.',
      'Anda tidak memiliki akses untuk tindakan ini.',
      'Hanya Super Admin yang dapat menambah pengguna.',
      'Hanya Super Admin yang dapat menghapus pengguna.',
      'Email wajib diisi dengan benar.',
      'Password minimal 8 karakter.',
      'Pengguna tidak ditemukan.',
      'Modul "xyz" tidak punya folder Drive.',
      'Server sedang sibuk, coba lagi beberapa saat.'
    ];
    const salahTanda = harusDitandai.filter((t) => !re.test(t));
    const salahLewat = tidakHarusDitandai.filter((t) => re.test(t));
    if (salahTanda.length === 0 && salahLewat.length === 0) {
      ok('hanya pesan tentang sesi yang ditandai',
        `${harusDitandai.length} harus ditandai, ${tidakHarusDitandai.length} tidak boleh`);
    } else {
      no('pola autentikasi salah', [
        salahTanda.length ? 'tidak ditandai seharusnya: ' + salahTanda.join(' | ') : '',
        salahLewat.length ? 'terlalu banyak ditandai: ' + salahLewat.join(' | ') : ''
      ].filter(Boolean).join(' / '));
    }
  }
}

console.log('\n' + '='.repeat(64));
console.log(`lulus ${lulus}, gagal ${gagal}`);
process.exit(gagal ? 1 : 0);
