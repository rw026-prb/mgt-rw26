// Periksa sintaks skrip inline di berkas HTML.
//
// BERAPA GUNANYA
// --------------
// Langkah "Periksa sintaks semua berkas JavaScript" di .github/workflows/uji.yml
// hanya menemukan berkas *.js dan *.mjs. Isi <script> di dalam .html TIDAK ikut
// diperiksa - padahal login.html, update-password.html, dan index.html
// masing-masing Hundreds baris JavaScript yang salah ketik satu karakter
// akan merusak seluruh halaman tanpa build yang gagal.
//
// Jadi skrip ini menutup celah yang sama seperti yang sudah dilakukan
// workflow untuk assets/*.js: menyalin setiap blok <script> tanpa src= ke
// berkas sementara, lalu memeriksanya dengan `node --check`.
//
// CARA MENJALANKAN
//   node cek-inline.mjs            -> periksa semua berkas HTML di repo
//   node cek-inline.mjs login.html -> periksa satu berkas
//
// Keluar dengan kode 1 kalau ada blok yang sintaksnya rusak.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Path dihitung relatif ke file ini, supaya skrip ini jalan di komputer mana
// pun - termasuk runner Linux GitHub Actions yang Path-nya beda.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const argumen = process.argv.slice(2);
const berkas = argumen.length
  ? argumen
  : fs.readdirSync(REPO).filter((n) => n.endsWith('.html')).map((n) => path.join(REPO, n));

let lulus = 0;
let gagal = 0;

console.log('='.repeat(60));
console.log('SINTAKS SKRIP INLINE DI HTML');
console.log('='.repeat(60));

for (const f of berkas) {
  const penuh = path.isAbsolute(f) ? f : path.join(REPO, f);
  if (!fs.existsSync(penuh)) {
    console.log('  dilewati (tidak ada): ' + f);
    continue;
  }
  const sumber = fs.readFileSync(penuh, 'utf8');
  const nama = path.basename(penuh);

  // Hanya blok yang isinya inline. <script src="..."> dimuat dari berkas
  // lain, jadi tidak ada isinya untuk diperiksa di sini.
  const blok = [...sumber.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

  if (!blok.length) {
    console.log('  (tidak ada skrip inline) ' + nama);
    continue;
  }

  blok.forEach((kode, i) => {
    if (!kode.trim()) return;
    const sementara = path.join(os.tmpdir(), `rw26-inline-${nama}-${i}.js`);
    fs.writeFileSync(sementara, kode);
    try {
      execFileSync(process.execPath, ['--check', sementara], { stdio: 'pipe' });
      lulus++;
      console.log(`    OK    ${nama} blok #${i + 1}  (${kode.split('\n').length} baris)`);
    } catch (e) {
      gagal++;
      console.log(`    SALAH ${nama} blok #${i + 1}`);
      const pesan = ((e.stderr && e.stderr.toString()) || e.message).trim();
      // Nomor baris dari `node --check` ikut dipindah, supaya blok yang
      // salah readily identifiable di berkas aslinya.
      console.log(pesan.split('\n').map((b) => '          ' + b).join('\n'));
    } finally {
      fs.unlinkSync(sementara);
    }
  });
}

console.log('-'.repeat(60));
console.log(`lulus ${lulus}, gagal ${gagal}`);
process.exit(gagal ? 1 : 0);