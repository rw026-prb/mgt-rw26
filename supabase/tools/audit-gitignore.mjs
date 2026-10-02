// ============================================================================
//  audit-gitignore.mjs  —  Periksa apakah ada file ter-ignore yang tetap
//  sudah ter-*track* di repository.
//
//  Kenapa ini penting: .gitignore HANYA berlaku untuk file yang belum
//  di-track. Kalau sebuah file sempat ter-commit SEBELUM .gitignore dibuat,
//  file itu tetap ikut ter-push selamanya, apa pun aturannya. Contoh nyata:
//  supabase/tools/.env di-*add* pada commit pertama, lalu .gitignore baru
//  dibuat pada commit berikutnya - file tersebut tetap terbawa.
// ============================================================================

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Repo kedua hanya dipindai kalau memang ada di komputer ini. Di runner CI
// hanya repo tempat skrip ini berada yang terunduh, jadi path itu tidak ada
// dan harus dilewati - bukan membuat pemeriksaan gagal.
const REPOS = [
  { nama: 'Mgt-portal RW', dir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..') },
  { nama: 'Website-RW26', dir: 'D:/Website RW/Website-RW26' },
];

// Nama berkas yang TIDAK BOLEH PERNAH ada di repository publik.
const SENGAJA_TERLARANG = [
  /\.env$/i,
  /\.env\.local$/i,
  /^\.env\b/,
  /node_modules/i,
  /pgdata/i,
  /pg_log/i,
  /postmaster\.pid/i,
  /\.pem$/i,
  /\.key$/i,
  /service-account.*\.json$/i,
  /user-credentials.*\.csv$/i,
  /^\.supabase-tmp/i,
  /\.bak$/i,
  /(^|[\\/])out[\\/]/i,
  /(^|[\\/])lib[\\/]auth_client/i,
];

let masalah = 0;

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

for (const repo of REPOS) {
  console.log('='.repeat(66));
  console.log(repo.nama);
  console.log('='.repeat(66));

  if (!fs.existsSync(path.join(repo.dir, '.git'))) {
    console.log('  BUKAN repository git');
    console.log('');
    continue;
  }

  const tracked = git(repo.dir, ['ls-files', '-z']).split('\0').filter(Boolean);
  console.log(`  berkas ter-track          : ${tracked.length}`);

  // ---- Lapis 1: berkas ter-track yang .gitignore akan kecualikan ----
  const terTrackTapiIgnored = [];
  for (const f of tracked) {
    try {
      execFileSync('git', ['-C', repo.dir, 'check-ignore', '-q', '--no-index', f], { stdio: 'ignore' });
      terTrackTapiIgnored.push(f);
    } catch {
      // exit != 0 berarti tidak di-ignore. Itu yang kita mau.
    }
  }
  if (terTrackTapiIgnored.length) {
    masalah += terTrackTapiIgnored.length;
    console.log(`  TER-TRACK tapi di-ignore  : ${terTrackTapiIgnored.length}`);
    for (const f of terTrackTapiIgnored) console.log('     ! ' + f);
  } else {
    console.log('  ter-track tapi di-ignore : 0  (baik)');
  }

  // ---- Lapis 2: nama berkas yang jelas tidak boleh ada ----
  const terlarang = tracked.filter((f) => SENGAJA_TERLARANG.some((p) => p.test(f)));
  if (terlarang.length) {
    masalah += terlarang.length;
    console.log(`  NAMA BERKAAS TERLARANG  : ${terlarang.length}`);
    for (const f of terlarang) console.log('     ! ' + f);
  } else {
    console.log('  nama berkas terlarang   : 0  (baik)');
  }

  // ---- Lapis 3: pernah ter-commit di riwayat? ----
  for (const pola of ['.env$', 'user-credentials', 'supabase/tools/out/']) {
    let riwayat = '';
    try {
      riwayat = git(repo.dir, ['log', '--all', '--full-history', '--format=%h %s', '--', '*' + pola]);
    } catch { /* tidak ada */ }
    const baris = riwayat.trim().split('\n').filter(Boolean);
    if (baris.length) {
      masalah += baris.length;
      console.log(`  RIWAYAT berisi ${pola}: ${baris.length}`);
      for (const b of baris.slice(0, 5)) console.log('     ! ' + b);
    } else {
      console.log(`  riwayat ${pola.padEnd(18)}: bersih`);
    }
  }

  // ---- Lapis 4: berkas ada di disk tapi tidak ter-track (memang wajar) ----
  const diDiskTidakTerTrack = [];
  const telusuri = (d, kedalaman = 0) => {
    if (kedalaman > 3) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (['node_modules', 'pgdata', 'pg_log'].includes(e.name)) continue;
        telusuri(p, kedalaman + 1);
        continue;
      }
      if (!SENGAJA_TERLARANG.some((re) => re.test(e.name))) continue;
      if (tracked.includes(path.relative(repo.dir, p).split(path.sep).join('/'))) continue;
      diDiskTidakTerTrack.push(path.relative(repo.dir, p));
    }
  };
  telusuri(repo.dir);

  if (diDiskTidakTerTrack.length) {
    console.log(`  ada di disk, TIDAK ter-track : ${diDiskTidakTerTrack.length} (aman - sudah di-ignore)`);
    for (const f of diDiskTidakTerTrack) console.log('     . ' + f);
  } else {
    console.log('  ada di disk, tidak ter-track : 0');
  }

  console.log('');
}

console.log('='.repeat(66));
console.log(masalah === 0
  ? 'HASIL: tidak ada berkas terlarang yang ter-track. AMAN.'
  : `HASIL: ${masalah} MASALAH ditemukan. Lihat tanda "!" di atas.`);
console.log('='.repeat(66));
process.exit(masalah === 0 ? 0 : 1);
