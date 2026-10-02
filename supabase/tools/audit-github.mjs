// ============================================================================
//  audit-github.mjs  —  Unduh isi berkas dari GitHub, periksa di dalamnya.
//
//  Pemeriksaan nama berkas saja tidak cukup. Kunci bisa ikut ter-push di dalam
//  config.js, Code.gs, atau catatan di README - semuanya lolos nama berkas
//  yang terlihat bersih. Yang diperiksa di sini adalah ISI tiap berkas
//  persis seperti yang tersimpan di server GitHub.
// ============================================================================

import { execFileSync } from 'node:child_process';

const REPOS = [
  { nama: 'Mgt-portal RW', repo: 'rw026-prb/mgt-rw26' },
  { nama: 'Website-RW26', repo: 'rw026-prb/portal-rw26' },
];

const JWT = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const POLA = [
  { nama: 'kunci service_role (nilai)', re: /SUPABASE_SERVICE_ROLE_KEY\s*=\s*["']?[A-Za-z0-9_.-]{40,}/ },
  { nama: 'kunci sb_secret_', re: /sb_secret_[A-Za-z0-9]/ },
  { nama: 'kredensial service account', re: /"type"\s*:\s*"service_account"/ },
  { nama: 'kata sandi', re: /(?:password|passwd|pass)\s*[:=]\s*["'][^"'\s]{8,}["']/i },
];

/**
 * Deteksi private key tanpa salah positives.
 *
 * Dua syarat harus terpenuhi:
 *   1. Ada baris "-----BEGIN ... PRIVATE KEY-----"
 *   2. Ada setidaknya SATU baris isi yang benar-benar terbaca sebagai base64
 *      dan TIDAK mengandung tanda "...".
 *
 * Tanpa syarat kedua, documentasi pun ikut kena - README memuat contoh
 * private key dengan isi yang disingkat menjadi "MIIEvQIBADANBg...".
 */
function adaPrivateKeyAsli(isi) {
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(isi)) return false;
  const baris = isi.split('\n').map((b) => b.trim());
  return baris.some(
    (b) => /^[A-Za-z0-9+/]{32,}={0,2}$/.test(b) && !b.includes('...')
  );
}

function muatJson(url) {
  const out = execFileSync('curl', ['-sS', '-L', '-H', 'Accept: application/vnd.github+json', url], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

function ambilTeks(url) {
  return execFileSync('curl', ['-sS', '-L', url], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

let totalBerkas = 0;
let totalTemuan = 0;

for (const r of REPOS) {
  console.log('='.repeat(66));
  console.log(r.nama + '  (' + r.repo + ')');
  console.log('='.repeat(66));

  const pohon = muatJson(`https://api.github.com/repos/${r.repo}/git/trees/main?recursive=1`);
  const berkas = pohon.tree.filter((t) => t.type === 'blob');
  const teks = berkas.filter((t) => /\.(js|mjs|gs|html|json|yml|yaml|sql|md|txt|css)$/i.test(t.path));

  console.log(`  berkas total : ${berkas.length}`);
  console.log(`  yang diperiksa isinya : ${teks.length}`);
  console.log('');

  for (const b of teks) {
    totalBerkas++;
    const isi = ambilTeks(`https://raw.githubusercontent.com/${r.repo}/main/${b.path}`);
    const temuan = [];

    for (const m of isi.match(JWT) || []) {
      try {
        const muatan = Buffer.from(m.split('.')[1], 'base64').toString('utf8');
        if (/service_role/.test(muatan)) temuan.push('JWT role service_role');
        else if (!/anon/.test(muatan)) temuan.push('JWT role tak dikenal: ' + muatan.slice(0, 70));
      } catch { /* abaikan */ }
    }
    for (const p of POLA) {
      if (p.re && p.re.test(isi)) temuan.push(p.nama);
    }
    if (adaPrivateKeyAsli(isi)) temuan.push('private key Google (isi asli)');

    // Hanya berkas CSV-nya yang bahaya. Skrip migrasi boleh menyebut nama
    // berkas kredensial di dalam kodenya - itu justru alat untuk menghasilkan
    // menghasilkan kredensial, bukan kredensialnya sendiri.
    if (/\.csv$/i.test(b.path) && /user-credentials/i.test(b.path)) {
      temuan.push('berkas daftar password');
    }

    if (temuan.length) {
      totalTemuan += temuan.length;
      console.log(`  ! ${b.path}`);
      for (const t of temuan) console.log(`      -> ${t}`);
    }
  }

  const bersih = totalTemuan === 0;
  console.log(bersih ? '  -> isi semua berkas: AMAN' : '  -> ADA TEMUAN');
  console.log('');
}

console.log('='.repeat(66));
console.log(`Total berkas diperiksa : ${totalBerkas}`);
console.log(totalTemuan === 0
  ? 'HASIL: tidak ada rahasia di dalam berkas mana pun. AMAN.'
  : `HASIL: ${totalTemuan} temuan. Periksa daftar di atas.`);
console.log('='.repeat(66));
process.exit(totalTemuan === 0 ? 0 : 1);

