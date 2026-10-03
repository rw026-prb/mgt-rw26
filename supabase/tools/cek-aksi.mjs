// Bandingkan semua aksi yang dipanggil index.html dengan yang ditangani
// jembatan (rw26-api.js) atau Code.gs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

// Path dihitung relatif ke file ini, bukan ditulis mati. Kalau ditulis mati
// dengan "D:/...", skrip ini hanya jalan di komputer itu saja - tidak akan
// jalan di GitHub Actions.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..') + path.sep;

// Semua aksi yang dipanggil portal
const html = fs.readFileSync(ROOT + 'index.html', 'utf8');
const called = new Set();
// KEDUA jenis kutip harus dipindai.
//
// Dulu hanya kutip tunggal yang dibaca, sehingga `apiRequest("getKasCashFlow", ...)`
// di muatArusKas() tidak pernah terlihat. Akibatnya nama aksi itu tidak
// diverifikasi terhadap Code.gs - dan kalau nanti salah ketik, tidak ada yang
// mengetahuinya. Ptrickle ini tidak boleh terulang: nama aksi yang salah ketik
// akan mengembalikan "Aksi API tidak dikenal." dari server, bukan error yang
// mudah dikenali.
for (const m of html.matchAll(/apiRequest\(\s*'([^']+)'/g)) called.add(m[1]);
for (const m of html.matchAll(/apiRequest\(\s*"([^"]+)"/g)) called.add(m[1]);
for (const m of html.matchAll(/apiRequest\(\s*[a-zA-Z_$?]+\s*\?\s*'([^']+)'\s*:\s*'([^']+)'/g)) {
  called.add(m[1]); called.add(m[2]);
}

// ---------------------------------------------------------------------------
//  Halaman di luar portal
// ---------------------------------------------------------------------------
//  Dulu skrip ini hanya memindai index.html. Itu celah: tiga aksi reset
//  password dipanggil dari login.html dan update-password.html, dan kalau
//  namanya salah ketik di sana, tidak ada yang mengetahuinya sampai warga
//  menekan tombol dan melihat "Server belum diperbarui".
//
//  Pola pemanggilannya berbeda dari portal - bukan `apiRequest('nama')` tapi
//  `appsScriptPublik_('nama', {...})` - jadi harus dibaca sendiri.
const HALAMAN_LAIN = ['login.html', 'update-password.html'];
const dipanggilLain = new Map();
for (const f of HALAMAN_LAIN) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  const sumber = fs.readFileSync(p, 'utf8');
  const ditemukan = new Set();
  for (const m of sumber.matchAll(/appsScriptPublik_\(\s*'([^']+)'/g)) ditemukan.add(m[1]);
  for (const m of sumber.matchAll(/appsScriptPublik_\(\s*"([^"]+)"/g)) ditemukan.add(m[1]);
  if (ditemukan.size) dipanggilLain.set(f, ditemukan);
}

// Aksi milik Apps Script (dari daftar di rw26-api.js)
const bridgeSrc = fs.readFileSync(ROOT + 'assets/js/rw26-api.js', 'utf8');
const m = bridgeSrc.match(/var APPS_SCRIPT_ACTIONS = new Set\(\[([\s\S]*?)\]\)/);
const appsScriptActions = new Set(
  [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
);

// Aksi ditangani bridge
const ast = acorn.parse(bridgeSrc, { ecmaVersion: 2022, sourceType: 'script' });
const bridgeActions = new Set();
// Handler ditulis dengan shorthand ES6 (`async listUsers() { ... }`).
// Di dalam object literal, acorn menandainya sebagai Property dengan
// method:true dan value berupa FunctionExpression - BUKAN MethodDefinition
// (yang hanya muncul di dalam class).
JSON.stringify(ast, (k, v) => {
  if (v && v.type === 'Property' && v.method === true
      && v.value && v.value.type === 'FunctionExpression' && v.value.async
      && v.key && v.key.name) {
    bridgeActions.add(v.key.name);
  }
  return v;
});

// Aksi yang benar-benar ada di Code.gs
const codeGs = fs.readFileSync(ROOT + 'Code.gs', 'utf8');
const codeAst = acorn.parse(codeGs, { ecmaVersion: 2022, sourceType: 'script', allowReturnOutsideFunction: true });
const doPost = codeAst.body.find((n) => n.type === 'FunctionDeclaration' && n.id.name === 'doPost');
const codeActions = new Set();
JSON.stringify(doPost, (k, v) => {
  if (v && v.type === 'SwitchCase' && v.test && v.test.type === 'Literal') codeActions.add(v.test.value);
  return v;
});

console.log('='.repeat(60));
console.log('PENCOCOKAN AKSI');
console.log('='.repeat(60));
console.log('dipanggil index.html      :', called.size);
console.log('-> Apps Script (bridge)   :', appsScriptActions.size);
console.log('-> Jembatan Supabase      :', bridgeActions.size);
console.log('aksi ada di Code.gs       :', codeActions.size);
for (const [f, set] of dipanggilLain) {
  console.log(`${f.padEnd(24)}:`, set.size, 'aksi langsung ke Apps Script');
}

const takDitangani = [];
for (const a of called) {
  if (appsScriptActions.has(a)) {
    if (!codeActions.has(a)) takDitangani.push(`${a}  -> Apps Script TIDAK punya aksi ini`);
    continue;
  }
  if (bridgeActions.has(a)) continue;
  takDitangani.push(`${a}  -> tidak ada di bridge maupun Apps Script`);
}

// Aksi yang dipanggil halaman di luar portal. Semuanya wajib ada di
// Code.gs, karena tidak lewat bridge sama sekali.
for (const [f, set] of dipanggilLain) {
  for (const a of set) {
    if (!codeActions.has(a)) takDitangani.push(`${a}  (dipanggil ${f}) -> TIDAK ada di Code.gs`);
  }
}

if (takDitangani.length) {
  console.log('\nMASALAH:');
  for (const t of takDitangani) console.log('  - ' + t);
} else {
  console.log('\nSemua aksi punya penanggung. Tidak ada yang menggantung.');
}

// Aksi yang ditangani bridge tapi tak pernah dipanggil (info)
const takDipakai = [...bridgeActions].filter((a) => !called.has(a));
if (takDipakai.length) {
  console.log('\nHandler di bridge yang tidak dipanggil portal:');
  for (const a of takDipakai) console.log('  - ' + a);
}

// WAJIB keluar dengan kode 1 kalau ada aksi yang menggantung. Tanpa ini,
// langkah ini hanya mencetak informasi dan kegagalannya tidak pernah stopping
// pipeline - persis kelas bug yang seharusnya dicegahnya.
process.exit(takDitangani.length ? 1 : 0);
