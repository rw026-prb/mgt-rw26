// ============================================================================
//  test-pantulan-lambat.mjs  —  Pastikan pengujian tidak balapan
// ============================================================================
//  Pengujian pantulan pernah gagal di CI karena menunggu tepat 120 ms. Di
//  runner yang lambat, rantai async belum selesai dalam 120 ms, dan kasus yang
//  seharusnya berpindah halaman terbaca sebagai "tidak berpindah".
//
//  Pengujian ini memaksa environment JSDOM melambat 20 kali lipat, lalu
//  menjalankan skrip login.html yang sungguhan. Kalau pengujian masih
//  withstands, berarti waktu tunggunya sudah cukup.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const DI_SINI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(DI_SINI, '..', '..');
const CFG = fs.readFileSync(path.join(REPO, 'config.js'), 'utf8');
const HTML = fs.readFileSync(path.join(REPO, 'login.html'), 'utf8');
const SKRIP = (HTML.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/) || [])[1] || '';

// Perlambat setTimeout 20 kali lipat supaya meniru runner yang lambat.
const PERLAMBAT = 20;
const asliSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => asliSetTimeout(fn, ms * PERLAMBAT, ...args);

let lulus = 0, gagal = 0;
const ok = (n) => { lulus++; console.log(`    OK    ${n}`); };
const no = (n, t) => { gagal++; console.log(`    SALAH ${n}\n          ${t}`); };

function jalankan({ sesiAktif, tandakanKeluar }) {
  const perpindahan = [];
  const konsol = new VirtualConsole();
  konsol.on('jsdomError', (e) => {
    if (/Not implemented: navigation/i.test(String(e && e.message || e))) perpindahan.push('navigasi');
  });
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only', pretendToBeVisual: true,
    url: 'https://mgt.rw026.my.id/login.html', virtualConsole: konsol,
  });
  const w = dom.window;
  w.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: sesiAktif ? { user: { id: 'u1' } } : null } }) },
      from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: 'u1', status: 'Aktif', must_change_pw: false }] }) }) }) }),
    }),
  };
  w.eval(CFG);
  const store = new Map();
  w.sessionStorage.setItem = (k, v) => store.set(k, String(v));
  w.sessionStorage.getItem = (k) => (store.has(k) ? store.get(k) : null);
  w.sessionStorage.removeItem = (k) => store.delete(k);
  if (tandakanKeluar) w.sessionStorage.setItem('rw26_keluar_baru', String(Date.now() - tandakanKeluar));
  w.document.getElementById = () => ({
    classList: { add() {}, remove() {}, contains: () => false },
    style: {}, value: '', textContent: '', innerHTML: '',
    querySelector: () => null, appendChild() {}, reset() {},
  });
  try { w.eval(SKRIP); } catch (e) { return { galat: e.message, perpindahan }; }

  // Batas waktuNELAmpi 10 detik setelah diperlambat 20x (= 500 ms aslinya).
  return new Promise((selesai) => {
    const mulai = Date.now();
    const cek = () => {
      if (perpindahan.length) return selesai({ perpindahan });
      if (Date.now() - mulai > 10000) return selesai({ perpindahan, balasan: true });
      setTimeout(cek, 25);
    };
    setTimeout(cek, 25);
  });
}

console.log('\n' + '='.repeat(62));
console.log(`JSDOM diperlambat ${PERLAMBAT}x - meniru runner CI yang lambat`);
console.log('='.repeat(62));

{
  const r = await jalankan({ sesiAktif: true, tandakanKeluar: 1000 });
  if (r.galat) no('gagal menjalankan', r.galat);
  else if (r.perpindahan.length === 0) ok('penanda keluar tetap menahan pantulan');
  else no('memantulkan balik', 'perpindahan: ' + r.perpindahan.join(', '));
}

{
  const r = await jalankan({ sesiAktif: true, tandakanKeluar: 120000 });
  if (r.galat) no('gagal menjalankan', r.galat);
  else if (r.perpindahan.length > 0) ok('tetap terdeteksi berpindah, meski lambat');
  else if (r.balasan) no('waktu habis sebelum perpindahan terdeteksi', 'batas 10 detik terlampaui');
  else no('tidak berpindah', 'tidak ada navigasi sama sekali');
}

globalThis.setTimeout = asliSetTimeout;

console.log('\n' + '='.repeat(62));
console.log(`lulus ${lulus}, gagal ${gagal}`);
process.exit(gagal ? 1 : 0);
