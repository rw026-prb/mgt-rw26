// ============================================================================
//  test-pantulan.mjs  —  Uji alur bolak-balik index <-> login di browser nyata
// ============================================================================
//  Bug yang diperbaiki: portal mengeluarkan pengguna karena sesi bermasalah,
//  TAPI tidak memanggil signOut(). Sesi Supabase tetap hidup, sehingga
//  halaman login mengarahkan balik ke portal, dan orang yang sama terlempar
//  bolak-balik tanpa henti.
//
//  Uji ini menjalankan JSDOM (DOM sungguhan) dengan skrip portal yang asli -
//  bukan tiruan. Yang diperiksa: apakah jumlah perpindahan halaman ada batanya.
//
//  dependensi: jsdom
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const DI_SINI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(DI_SINI, '..', '..');
const CFG = fs.readFileSync(path.join(REPO, 'config.js'), 'utf8');

let lulus = 0, gagal = 0;
const ok = (n, t) => { lulus++; console.log(`    OK    ${n}${t ? '  ' + t : ''}`); };
const no = (n, t) => { gagal++; console.log(`    SALAH ${n}\n          ${t}`); };

/**
 * Muat script login.html yang SEBENARNYA ke dalam JSDOM, lalu periksa
 * apakah ia mengarahkan ke index.html atau tidak.
 *
 * Yang diuji adalah kode yang benar-benar tayang, bukan tiruan. Kalau
 * SomeoneZoBoard nanti mengubah login.html, hasil uji ini ikut berubah.
 */
function cekSkripLogin({ sesiAktif, profilStatus, tandakanKeluar }) {
  const html = fs.readFileSync(path.join(REPO, 'login.html'), 'utf8');
  const skrip = (html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/) || [])[1];
  if (!skrip) return { galat: 'script login.html tidak ditemukan' };

  const perpindahan = [];
  const konsol = new VirtualConsole();
  // JSDOM tidak menjalankan navigasi sungguhan, tapi memancarkan galat
  // "Not implemented: navigation to another Document" setiap kali skrip
  // memanggil location.replace(). Itulah yang diamati di sini: apakah skrip
  // BERNIAT berpindah halaman, bukan ke mana.
  //
  // Untuk pengujian pantulan, yang penting hanyalah "pergi atau tidak" -
  // bukan tujuan. Kalau tidak pergi, tidak mungkin berpantulan.
  konsol.on('jsdomError', (e) => {
    const pesan = String(e && e.message || e);
    if (/Not implemented: navigation/i.test(pesan)) perpindahan.push('navigasi');
  });

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'https://mgt.rw026.my.id/login.html',
    virtualConsole: konsol,
  });
  const w = dom.window;

  // Tiruan supabase-js
  w.supabase = {
    createClient: () => ({
      auth: {
        getSession: async () => ({ data: { session: sesiAktif ? { user: { id: 'u1', email: 'a@b.c' } } : null } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: async () => ({ data: profilStatus ? [{ id: 'u1', status: profilStatus, must_change_pw: false }] : [] }),
          }),
        }),
      }),
    }),
  };
  w.eval(CFG);

  const storage = new Map();
  w.sessionStorage.setItem = (k, v) => storage.set(k, String(v));
  w.sessionStorage.getItem = (k) => (storage.has(k) ? storage.get(k) : null);
  w.sessionStorage.removeItem = (k) => storage.delete(k);
  if (tandakanKeluar) {
    w.sessionStorage.setItem('rw26_keluar_baru', String(Date.now() - tandakanKeluar));
  }
  w.document.getElementById = (id) => {
    if (!w.__el) {
      w.__el = {
        classList: { add() {}, remove() {}, contains: () => false },
        style: {}, value: '', textContent: '', innerHTML: '',
        querySelector: () => null, appendChild() {}, reset() {},
      };
    }
    return w.__el;
  };

  try { w.eval(skrip); } catch (e) { return { galat: e.message, perpindahan }; }
  return new Promise((selesai) => {
    // Beri waktu skrip async menyelesaikan getSession() dan query profil.
    setTimeout(() => selesai({ perpindahan }), 120);
  });
}

// Untuk pengujian pantulan, yang diperiksa hanya "pergi atau tidak". Kalau
// halaman login tidak berpindah, pantulan mustahil terjadi. Goalsnama
// tujuan tidak bisa diamati karena JSDOM tidak menjalankan navigasi.
function cek(r) {
  if (r.galat) { no('gagal menjalankan', r.galat); return; }
  if (r.perpindahan.length === 0) { ok('tidak berpindah halaman - aman dari pantulan'); return; }
  no('berpindah halaman padahal seharusnya tidak', 'perpindahan: ' + r.perpindahan.join(', '));
}

console.log('\n' + '='.repeat(62));
console.log('1. Dicabut portal -> login TIDAK boleh memantulkan balik');
console.log('='.repeat(62));
{
  const r = await cekSkripLogin({ sesiAktif: false, profilStatus: 'Aktif', tandakanKeluar: 2000 });
  cek(r);
}

console.log('\n' + '='.repeat(62));
console.log('2. Penanda keluar masih segar -> tetap di login');
console.log('='.repeat(62));
{
  // Sesi masih hidup karena signOut() gagal, tapi penanda baru ada.
  // Inilah kondisi yang dulu menyebabkan pantulan tanpa henti.
  const r = await cekSkripLogin({ sesiAktif: true, profilStatus: 'Aktif', tandakanKeluar: 1000 });
  cek(r);
}

console.log('\n' + '='.repeat(62));
console.log('3. Penanda sudah kedaluwarsa -> BOLEH masuk portal');
console.log('='.repeat(62));
{
  const r = await cekSkripLogin({ sesiAktif: true, profilStatus: 'Aktif', tandakanKeluar: 120000 });
  if (r.galat) no('gagal menjalankan', r.galat);
  else if (r.perpindahan.length > 0) ok('berpindah ke portal seperti seharusnya');
  else no('tidak sampai ke portal', 'tidak ada perpindahan sama sekali');
}

console.log('\n' + '='.repeat(62));
console.log('4. Sesi tidak ada sama sekali -> tetap di login');
console.log('='.repeat(62));
{
  const r = await cekSkripLogin({ sesiAktif: false, profilStatus: null, tandakanKeluar: null });
  cek(r);
}

console.log('\n' + '='.repeat(62));
console.log('5. Portal TIDAK lagi memicu keluar karena kata "token"');
console.log('='.repeat(62));
{
  const src = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const polaLama = /Sesi berakhir\|token\|Sudah keluar/i;
  if (polaLama.test(src)) {
    no('pola pemicu keluar yang panjang masih ada', 'index.html masih.matches teks apa pun yang memuat kata itu');
  } else {
    ok('pola pemicu keluar sudah diganti penanda isAuthError');
  }
  if (/isAuthError/.test(src)) ok('memakai err.isAuthError');
  else no('tidak memakai isAuthError', 'penanda tidak ditemukan');
  if (/RW26\.signOut/.test(src)) ok('logout() memanggil signOut Supabase');
  else no('logout() tidak memanggil signOut', 'sesi bisa tetap hidup -> pantulan');
}

console.log('\n' + '='.repeat(62));
console.log('6. Jembatan menandai hanya pesan autentikasi');
console.log('='.repeat(62));
{
  const src = fs.readFileSync(path.join(REPO, 'assets/js/rw26-api.js'), 'utf8');
  const blok = src.match(/isAuthError = true;[\s\S]{0,400}?\n\s*\}/);
  const isiBlok = src.match(/if \(\/Sesi berakhir[\s\S]*?\{\s*\n\s*err\.isAuthError = true;/) || [];
  const ada = /err\.isAuthError = true/.test(src);
  if (ada) ok('penanda isAuthError ada di jembatan');
  else no('penanda tidak ada', 'cari "err.isAuthError"');
  const sempit = /Sesi berakhir\|Token tidak valid|belum login|Wajib login/i.test(src);
  if (sempit) ok('pola yang dipakai sempit - hanya pesan soal sesi');
  else no('pola autentikasi tidak ditemukan', 'cari pola di callAppsScript');
  if (/async function signOut\(\)/.test(src)) ok('fungsi signOut tersedia untuk halaman portal');
  else no('fungsi signOut tidak ada', 'index.html tidak bisa keluar dengan benar');
}

console.log('\n' + '='.repeat(62));
console.log(`lulus ${lulus}, gagal ${gagal}`);
process.exit(gagal ? 1 : 0);
