// Simulasi langkah "pastikan tidak ada kunci service_role" dari workflow.
//
// Polanya sengaja DISUSUN dari potongan-potongan kecil. Kalau polanya ditulis
// utuh di file ini, pemindai akan mencocokkan dirinya sendiri dan selalu
// melaporkan "bocor" - persis seperti yang terjadi saat pola ditulis langsung
// di berkas workflow.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Path dihitung relatif ke file ini, bukan ditulis mati. Kalau ditulis mati
// dengan "D:/...", skrip ini hanya jalan di komputer itu saja - tidak akan
// jalan di GitHub Actions, yang memakai Linux.
const DI_SINI = path.dirname(fileURLToPath(import.meta.url));

// Default: repo tempat skrip ini berada. Tambahan path bisa diberikan sebagai
// argumen, tapi di CI hanya repo itu yang ada - jadi jangan bergantung pada
// repo lain yang mungkin tidak terunduh.
const roots = process.argv.length > 2
  ? process.argv.slice(2)
  : [path.resolve(DI_SINI, '..', '..')];

const lewati = new Set(['node_modules', '.git', 'pgdata', 'out', '.github']);
const lewatiFile = new Set(['cek-rahasia.mjs']);

const pola = [
  new RegExp('sb' + '_secret_[A-Za-z0-9]'),
  new RegExp('service' + '_role.{0,40}' + 'eyJ'),
  new RegExp('SUPABASE' + '_SERVICE_ROLE_KEY\\s*=\\s*["\']?[A-Za-z0-9_.-]{40,}'),
];

/**
 * Periksa isi (payload) setiap token JWT yang ditemukan.
 *
 * Kunci `anon` dan `service_role` sama-sama berbentuk JWT yang diawali
 * "eyJ", jadi bentuknya tidak bisa membedakan keduanya. Yang membedakan
 * adalah payload-nya: "role":"anon" untuk yang boleh publik, dan
 * "role":"service_role" untuk yang memberi akses penuh ke database.
 *
 * Tanpa pemeriksaan ini, kunci yang ditulis tanpa nama variabel di
 * symbahnya - misalnya disalin mentah ke dalam catatan - bisa lolos.
 */
const jwt = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

function payloadJwt(token) {
  try {
    const bagian = token.split('.')[1];
    return Buffer.from(bagian, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function periksaToken(teks) {
  const temuan = [];
  for (const m of teks.match(jwt) || []) {
    const muatan = payloadJwt(m);
    if (/service_role/.test(muatan)) temuan.push('JWT dengan role service_role');
    else if (!/anon/.test(muatan)) temuan.push('JWT dengan role tidak dikenali: ' + muatan.slice(0, 80));
  }
  return temuan;
}

let bocor = 0;
let diperiksa = 0;

function telusuri(dir) {
  // Path yang tidak ada harus diabaikan, bukan membuat skrip berhenti. Di CI
  // hanya satu repo yang terunduh, jadi path repo lain yang disebut sebagai
  // argumen tidak akan ada.
  if (!fs.existsSync(dir)) {
    console.log('  dilewati (tidak ada): ' + dir);
    return;
  }
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (lewati.has(e.name)) continue;
      telusuri(path.join(dir, e.name));
      continue;
    }
    // `.gs` ikut dipindai. Code.gs yang memuat kunci service_role akan
    // ikut ter-*push* ke repository publik, sama seperti berkas HTML.
    //
    // Yang DICARI adalah nilai kuncinya, bukan nama variabelnya. Code.gs
    // deserve memuat teks 'SUPABASE_SERVICE_ROLE_KEY' sebagai nama Script
    // Property - itu bukan kebocoran.
    if (!/\.(js|mjs|gs|html|json|yml|md|sql)$/i.test(e.name)) continue;
    if (e.name === '.env.example') continue;
    if (lewatiFile.has(e.name)) continue;
    const p = path.join(dir, e.name);
    const teks = fs.readFileSync(p, 'utf8');
    diperiksa++;
    let masalah = [];
    for (const r of pola) if (r.test(teks)) masalah.push('pola kunci service_role');
    masalah = masalah.concat(periksaToken(teks));
    if (masalah.length) {
      console.log('  BOCOR : ' + p.replace(/^D:.*RW[\\/]/, '') + '  [' + [...new Set(masalah)].join('; ') + ']');
      bocor++;
    }
  }
}

console.log('Memindai ' + roots.length + ' repository...');
for (const r of roots) telusuri(r);
console.log('  berkas diperiksa : ' + diperiksa);
console.log(bocor ? '  HASIL: ADA KUNCI BOCOR (' + bocor + ')' : '  HASIL: aman, tidak ada kunci service_role');
process.exit(bocor ? 1 : 0);
