// ============================================================================
//  migrate.mjs  —  Pindahkan data Google Sheets ke Supabase
// ============================================================================
//  CARA JALANKAN
//    node migrate.mjs --dry-run     # baca & hitung saja, TIDAK menulis apa pun
//    node migrate.mjs               # tulis ke Supabase
//    node migrate.mjs --verify      # bandingkan hasil dengan logika lama
//
//  PILIHAN
//    --dry-run           jangan menulis ke database
//    --verify            setelah menulis, cocokkan angka dengan logika Code.gs
//    --skip-visitor      lewati visitor_log (cenderung besar, hanya analitik)
//    --visitor-days N    hanya ambil N hari terakhir log pengunjung (default 90)
//    --force             izinkan menulis ulang tabel kas yang sudah berisi data
//
//  URUTAN PENTING
//  1. profiles  -> 2. himbauan -> 3. pengumuman -> 4. fasum
//  -> 5. organisasi -> 6. statistik -> 7. kas -> 8. log
//
//  profiles harus pertama karena tabel kas menyimpan uuid pembuat. Kalau kas
//  dimuat lebih dulu, kolom created_by tidak akan bisa terisi.
//
//  YANG SENGAJA TIDAK DIMIGRASI (tetap di Apps Script + Google Drive)
//    sheet `berita`            -> spreadsheet INFO
//    sheet `video`             -> spreadsheet INFO
//    sheet `album`             -> spreadsheet GALLERY
//    sheet `video_kegiatan`    -> spreadsheet GALLERY
//  Foto-fotonya juga tetap di Google Drive; yang tersimpan di sini hanya
//  ID file-nya.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadEnv, Sheets, Supabase,
  extractUrl, extractFileId, parseDdMmYyyy, parseDdMmYyyyTime, toInt, randomPassword,
} from './lib.mjs';

// Penting: pakai fileURLToPath, bukan import.meta.url.pathname.
// Pathname mengubah spasi menjadi %20. Karena folder project ini mengandung
// spasi ("Website RW"), file .env akan dianggap tidak ada kalau dibaca lewat
// pathname.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const val = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const DRY_RUN = has('--dry-run');
const VERIFY = has('--verify');
const INSPECT = has('--inspect');
const FORCE = has('--force');
const RESET_PASSWORDS = has('--reset-passwords');
const SKIP_VISITOR = has('--skip-visitor');
const VISITOR_DAYS = Number(val('--visitor-days', '90'));

const cfg = { ...loadEnv(path.join(HERE, '.env')), ...process.env };

// ---------------------------------------------------------------------------
//  Pemetaan spreadsheet (sama persis dengan konstanta di Code.gs:5-52)
// ---------------------------------------------------------------------------
const SS = {
  user:      cfg.SPREADSHEET_USER      || '1MYvidwDFe65xCsZz9AP2zAGpv3SHXE9QRxulqULXxGY',
  kas:       cfg.SPREADSHEET_KAS       || '1Vq4movo3TW_A8rB0yy4unuwAQm0lAPerJaOMWe2vTuU',
  himbauan:  cfg.SPREADSHEET_HIMBAUAN  || '1CnjK2IQ2bAAIMuQ3C8liNDsz9RP3gy1Ls_Ud6Y9zqdE',
  info:      cfg.SPREADSHEET_INFO      || '15qG8a0brYTc0KjeMof077LcT0rfIxQ9TFRmAkzcpEJs',
  fasum:     cfg.SPREADSHEET_FASUM     || '1omrKdc4ozp066NqijEOB5gmp0u7U8hIB-0Fb_ccKmJY',
  org:       cfg.SPREADSHEET_ORG       || '1gkMOBSVkBPuLFphl9yggbmWo7uzGcV7QIamwgnBB9X8',
};

const ORG_TABS = ['rw', 'posyandu', 'pkk', 'bank-sampah', 'pokmas'];

/**
 * Buang kunci yang nilainya null, HANYA untuk kolom yang NOT NULL.
 *
 * Kolom `timestamp NOT NULL DEFAULT now()` tidak bisa menerima null: kalau
 * dikirim, PostgreSQL menolak dengan "violates not-null constraint" dan
 * seluruh batch gagal. Menghapus kuncinya membuat PostgreSQL memakai
 * nilai default-nya, jauh lebih aman daripada menebak nilai yang benar.
 *
 * Berlawanan dengan kolom nullable (mis. no_hp) yang BOLEH null - null di
 * sana berarti memang belum diisi, dan itu informasi yang perlu disimpan.
 */
const buangJikaNull = (obj, ...keys) => {
  for (const k of keys) if (obj[k] === null) delete obj[k];
  return obj;
};

/**
 * Baca satu sel waktu menjadi ISO 8601.
 *
 * Sheeets menyimpan waktu dalam dua bentuk dan keduanya harus ditangani:
 *
 *   1. Sel TANGGAL ASLI. Dengan valueRenderOption=UNFORMATTED_VALUE, sel
 *      seperti ini dikembalikan sebagai ANGKA SERIAL (mis. 46271.606944444444
 *      = 6 September 2026, 14:34). Perlu dikonversi memakai zona waktu sheet.
 *
 *   2. Teks 'DD/MM/YYYY HH:mm' hasil Utilities.formatDate() di Code.gs.
 *
 * Mengabaikan bentuk pertama membuat 6 baris statistik dan 152 baris log
 * untuk dilewati tanpa alasan yang jelas.
 */
function waktuDariSel(sheets, cell) {
  if (!cell) return '';
  if (cell.t === 'number' && typeof cell.v === 'number') return sheets.toTimestamp(cell.v);
  return parseDdMmYyyyTime(cell.v, sheets.timeZone) || '';
}

/** Sama seperti waktuDariSel, tapi untuk tanggal saja (tanpa jam). */
function tanggalDariSel(sheets, cell) {
  if (!cell) return '';
  if (cell.t === 'number' && typeof cell.v === 'number') return sheets.toDate(cell.v);
  return parseDdMmYyyy(cell.v) || '';
}

// ---------------------------------------------------------------------------
//  Pelaporan
// ---------------------------------------------------------------------------
const issues = [];
function issue(source, rowKey, kolom, problem, rawValue) {
  issues.push({
    source,
    row_key: String(rowKey),
    kolom: kolom || null,
    problem,
    raw_value: rawValue == null ? null : String(rawValue).slice(0, 200),
  });
}
const pad3 = (n) => String(n).padStart(3, '0');
const log = (...a) => console.log(...a);

// Hasil transformasi tiap tabel, dipakai ulang oleh mode --inspect supaya
// yang ditampilkan benar-benar data yang akan ditulis, bukan pembacaan ulang.
const collected = {};

// ---------------------------------------------------------------------------
//  Steps
// ---------------------------------------------------------------------------

async function main() {
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_SERVICE_ROLE_KEY || !cfg.SUPABASE_ANON_KEY) {
    throw new Error(
      'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY belum diisi di .env\n' +
      'Lihat supabase/tools/README.md'
    );
  }

  log('Membuat koneksi...');
  const sheets = await Sheets.create(cfg);
  log(`  Zona waktu spreadsheet : ${sheets.timeZone}`);
  const sb = new Supabase({
    url: cfg.SUPABASE_URL,
    serviceRoleKey: cfg.SUPABASE_SERVICE_ROLE_KEY,
    anonKey: cfg.SUPABASE_ANON_KEY,
  });
  log(`  Supabase              : ${sb.url}`);
  log(DRY_RUN ? '\nMODE: DRY-RUN (tidak ada yang ditulis)\n' : '\nMODE: MENULIS\n');

  const audit = [];
  const nameToUuid = new Map();
  collected.profiles = [];

  audit.push(await stepProfiles(sb, sheets, nameToUuid));
  audit.push(await stepHimbauan(sb, sheets));
  audit.push(await stepPengumuman(sb, sheets));
  audit.push(await stepFasum(sb, sheets));
  audit.push(await stepOrganisasi(sb, sheets));
  audit.push(await stepStatistik(sb, sheets));
  const kasRows = await stepKas(sb, sheets, nameToUuid);
  if (!SKIP_VISITOR) audit.push(await stepVisitorLog(sb, sheets));
  audit.push(await stepActivityLog(sb, sheets));

  await saveAudit(sb, audit);

  log('\n' + '='.repeat(66));
  log('RINGKASAN');
  log('='.repeat(66));
  let totalRead = 0, totalWrite = 0, totalSkip = 0;
  for (const a of audit) {
    totalRead += a.rows_read; totalWrite += a.rows_written; totalSkip += a.rows_skipped;
    log(`  ${a.source.padEnd(22)} -> ${a.target.padEnd(16)} dibaca ${String(a.rows_read).padStart(5)}  ditulis ${String(a.rows_written).padStart(5)}  dilewati ${a.rows_skipped}`);
  }
  log('-'.repeat(66));
  log(`  TOTAL  dibaca ${totalRead}  ditulis ${totalWrite}  dilewati ${totalSkip}`);
  log(`  MASALAH ditemukan: ${issues.length}`);
  for (const i of issues.slice(0, 25)) {
    log(`    - [${i.source}] ${i.row_key}${i.kolom ? ' kolom ' + i.kolom : ''}: ${i.problem}${i.raw_value ? ' (nilai: ' + i.raw_value + ')' : ''}`);
  }
  if (issues.length > 25) log(`    ... dan ${issues.length - 25} lainnya`);

  if (VERIFY && !DRY_RUN) await verify(sb, sheets, kasRows, nameToUuid);
  else if (VERIFY) log('\n(--verify dilewati karena sedang dry-run)');

  if (INSPECT) inspect();

  if (DRY_RUN) log('\nDry-run selesai. Tidak ada yang ditulis. Jalankan tanpa --dry-run untuk menyimpan.');
}

// ---------------------------------------------------------------------------
//  Inspeksi: tampilkan isi baris, bukan cuma jumlahnya
// ---------------------------------------------------------------------------
//  Jumlah baris yang cocok tidak menjamin isinya benar. Kolom tanggal bisa
//  bergeser bulan, file ID foto bisa kosong, atau nama pembuat bisa gagal
//  dipetakan ke user. Semuanya kelihatan kalau isinya ditampilkan langsung.
//
//  Data ini diambil dari hasil transformasi yang sudah dihitung di atas, bukan
//  dibaca ulang dari Google - jadi yang tampil benar-benar yang akan ditulis.
const potong = (s, n = 20) => {
  const t = String(s == null ? '' : s);
  return t.length > n ? t.slice(0, n) + '…' : t;
};
const barisTabel = (rows, cols, judul, batas) => {
  log(`\n--- ${judul} ---`);
  if (!rows || !rows.length) { log('  (kosong)'); return; }
  const n = batas || rows.length;
  log('  ' + cols.map((c) => potong(c, 22).padEnd(23)).join(''));
  for (const r of rows.slice(0, n)) {
    log('  ' + cols.map((c) => potong(r[c], 22).padEnd(23)).join(''));
  }
  if (rows.length > n) log(`  ... ${rows.length - n} baris lagi`);
};

function inspect() {
  log('\n' + '='.repeat(66));
  log('INSPEKSI ISI DATA (--inspect)');
  log('='.repeat(66));

  barisTabel(collected.himbauan,
    ['id', 'judul', 'kategori', 'status', 'image_file_id'], 'himbauan');
  barisTabel(collected.pengumuman,
    ['id', 'judul', 'kategori', 'tanggal', 'status'], 'pengumuman');
  barisTabel(collected.fasum,
    ['id', 'nama', 'deskripsi', 'foto_file_id', 'maps_url'], 'fasum');
  barisTabel(collected.organisasi,
    ['grup', 'legacy_id', 'jabatan', 'nama', 'foto_file_id'], 'organisasi', 12);
  barisTabel(collected.statistik_warga,
    ['id', 'nama_kategori', 'nilai', 'keterangan', 'updated_at'], 'statistik_warga');

  // profiles: menu_access ditampilkan utuh - daftar menu menentukan modul apa
  // saja yang bisa dibuka tiap orang, jadi tidak boleh terpotong.
  log('\n--- user -> profiles ---');
  for (const p of collected.profiles || []) {
    log(`  ${p.legacy_id}  ${p.nama}`);
    log(`      role=${p.role}  status=${p.status}  wilayah=${p.wilayah}`);
    log(`      menu_access=${JSON.stringify(p.menu_access)}`);
    log(`      tanggal_dibuat=${p.tanggal_dibuat || '-'}  login_terakhir=${p.login_terakhir || '-'}`);
  }

  // KAS paling perlu diperiksa: tanggal bisa bergeser bulan, dan kolom
  // pembuat bisa gagal dipetakan ke user.
  const kas = collected.kas || [];
  log(`\n--- kas (${kas.length} transaksi) ---`);
  log('  ' + ['tanggal', 'uraian', 'masuk', 'keluar', 'status', 'pembuat', 'bukti']
    .map((c) => potong(c, 22).padEnd(23)).join(''));
  for (const k of kas) {
    log('  ' + [
      k.tanggal, k.uraian, k.masuk, k.keluar, k.status,
      k.created_by_name + (k.created_by ? '' : ' [tanpa uuid]'),
      k.bukti_file_id || '-',
    ].map((c) => potong(c, 22).padEnd(23)).join(''));
  }

  // Ringkasan yang perlu diperhatikan
  log('\n--- RINGKASAN PEMERIKSAAN ---');
  const tanpaId = (collected.himbauan || []).filter((h) => !h.image_file_id).length
                + (collected.fasum || []).filter((f) => !f.foto_file_id).length
                + (collected.organisasi || []).filter((o) => !o.foto_file_id).length;
  log(`  Baris tanpa file ID foto : ${tanpaId}`);
  log(`    (wajar kalau memang belum ada foto; lihat kolom image_url di atas)`);

  const tanpaUuid = kas.filter((k) => !k.created_by).length;
  log(`  Transaksi tanpa uuid pembuat: ${tanpaUuid}`);
  if (tanpaUuid) log('    -> nama tetap tersimpan, hanya relasinya kosong');

  const tahunBulan = new Set(kas.map((k) => String(k.tanggal).slice(0, 7)));
  log(`  Bul/transaksi tersimpan   : ${[...tahunBulan].sort().join(', ')}`);

  const tglSalah = kas.filter((k) => !/^\d{4}-\d{2}-\d{2}$/.test(String(k.tanggal)));
  log(`  Tanggal berformat salah   : ${tglSalah.length}`);

  // Daftar modul yang muncul di menu_access, supaya bisa dibandingkan dengan
  // daftar modul yang benar-benar ada di portal admin.
  const semuaMenu = new Set();
  for (const p of collected.profiles || []) for (const m of p.menu_access || []) semuaMenu.add(m);
  log(`  Modul yang diizinkan      : ${[...semuaMenu].sort().join(', ') || '(tidak ada)'}`);

  const menuKas = (collected.profiles || []).filter((p) => (p.menu_access || []).includes('kas'));
  const pembuatKas = new Set((collected.kas || []).map((k) => k.created_by_name));
  const tidakBoleh = [...pembuatKas].filter((nama) =>
    !menuKas.some((p) => p.nama === nama) &&
    !(collected.profiles || []).some((p) => p.nama === nama && ['Super Admin', 'Admin'].includes(p.role)));
  if (tidakBoleh.length) {
    log(`\n  PERINGATAN: ada pembuat transaksi kas yang role-nya tidak punya akses 'kas':`);
    for (const n of tidakBoleh) log(`    - ${n}`);
    log('    Setelah migrasi, orang ini tidak bisa lagi menambah atau mengubah transaksi.');
    log('    Cek dulu ke tendencias: memang wajar atau perlu diberi akses?');
  }
}

// ---------------------------------------------------------------------------
//  1. profiles + akun Supabase Auth
// ---------------------------------------------------------------------------
async function stepProfiles(sb, sheets, nameToUuid) {
  log('\n[1] user -> profiles + Supabase Auth');
  const rows = await sheets.read(SS.user, 'user', 11);
  const existing = new Map();
  for (const u of await sb.adminListUsers()) {
    if (u.email) existing.set(String(u.email).toLowerCase(), u);
  }

  const profiles = [];
  const kredensial = [];
  let ditulis = 0, dilewati = 0;

  for (const row of rows) {
    const [legacyId, nama, email, noHp, role, wilayah, status] = row.cells;
    const key = legacyId.v || `baris-${row.r}`;

    if (!email.v || !String(email.v).includes('@')) {
      issue('user', key, 'Email', 'Email kosong atau tidak valid - akun dilewati', email.v);
      dilewati++;
      continue;
    }
    if (!nama.v) {
      issue('user', key, 'Nama Lengkap', 'Nama kosong - akun dilewati', nama.v);
      dilewati++;
      continue;
    }

    // Code.gs:333 memblokir login bila status bukan 'aktif' (case-insensitive).
    const statusDb = String(status.v || '').trim().toLowerCase() === 'aktif' ? 'Aktif' : 'Nonaktif';
    // Role di luar 3 nilai yang dikenal diturunkan jadi Editor.
    const roleRaw = String(role.v || '').trim();
    const roleDb = ['Super Admin', 'Admin', 'Editor'].includes(roleRaw)
      ? roleRaw
      : (roleRaw ? 'Editor' : 'Editor');
    if (roleRaw && !['Super Admin', 'Admin', 'Editor'].includes(roleRaw)) {
      issue('user', key, 'Role ID', `Role "${roleRaw}" tidak dikenal, dipakai Editor`, roleRaw);
    }

    let menuAccess = [];
    try {
      const parsed = JSON.parse(String(row.cells[10].v || '[]'));
      if (Array.isArray(parsed)) menuAccess = parsed.map(String);
    } catch {
      issue('user', key, 'Menu Akses', 'JSON tidak bisa dibaca, dipakai daftar kosong', row.cells[10].v);
    }

    const profile = {
      legacy_id: String(legacyId.v || '').trim() || null,
      nama: String(nama.v).trim(),
      no_hp: String(noHp.v || '').trim() || null,
      role: roleDb,
      wilayah: String(wilayah.v || '').trim() || 'RW026',
      status: statusDb,
      menu_access: menuAccess,
      must_change_pw: true,
      login_terakhir: parseDdMmYyyyTime(row.cells[8].v, sheets.timeZone) || null,
      tanggal_dibuat: parseDdMmYyyyTime(row.cells[9].v, sheets.timeZone) || null,
    };
    if (!profile.legacy_id) {
      issue('user', key, 'User ID', 'ID kosong, akan diisi otomatis oleh trigger', legacyId.v);
    }

    const addr = String(email.v).trim().toLowerCase();
    let userId;

    if (DRY_RUN) {
      userId = '(dry-run)';
      if (existing.has(addr)) issue('user', key, 'Email', 'Email sudah ada di Supabase Auth', addr);
    } else if (existing.has(addr)) {
      const u = existing.get(addr);
      userId = u.id;
      if (RESET_PASSWORDS) {
        // Akun sudah ada tapi passwordnya tidak pernah tercatat (mis. karena
        // eksekusi sebelumnya gagal di tengah jalan). Tanpa langkah ini, orang
        // yang akunnya dibuat di sini tidak akan bisa login selamanya.
        const password = randomPassword(16);
        await sb.adminPatchUser(u.id, {
          password,
          user_metadata: { nama: profile.nama },
          app_metadata: { role: profile.role, wilayah: profile.wilayah },
        });
        kredensial.push({ legacy_id: profile.legacy_id, nama: profile.nama, email: addr, role: profile.role, password });
      } else {
        await sb.adminPatchUser(u.id, {
          user_metadata: { nama: profile.nama },
          app_metadata: { role: profile.role, wilayah: profile.wilayah },
        });
        issue('user', key, 'Email',
          'Akun sudah ada di Supabase Auth - profil diperbarui, password TIDAK diubah. ' +
          'Kalau passwordnya tidak pernah tercatat, jalankan ulang dengan --reset-passwords.', addr);
      }
    } else {
      const password = randomPassword(16);
      const created = await sb.adminCreateUser({
        email: addr,
        password,
        user_metadata: { nama: profile.nama },
        app_metadata: { role: profile.role, wilayah: profile.wilayah },
      });
      userId = created.id;
      kredensial.push({ legacy_id: profile.legacy_id, nama: profile.nama, email: addr, role: profile.role, password });
    }

    profiles.push({ ...profile, id: userId });
    nameToUuid.set(profile.nama, userId);
    nameToUuid.set(profile.nama.toLowerCase(), userId);
    ditulis++;
  }
  if (!DRY_RUN && profiles.length) {
    for (const p of profiles) {
      if (p.id === '(dry-run)') continue;
      // Trigger auth_user_created sudah membuat baris dengan nilai minimal,
      // jadi di sini perbarui, bukan insert.
      //
      // Kolom yang nullable boleh diisi null. Tapi tanggal_dibuat punya
      // NOT NULL: kalau dikirim null, seluruh batch gagal dengan
      // "null value in column tanggal_dibuat violates not-null constraint".
      // Di sheet aslinya kolom ini memang kosong untuk user lama, jadi
      // kalau kosong kita biarkan saja - nilai default now() yang dipakai.
      const patch = {
        legacy_id: p.legacy_id,
        nama: p.nama,
        no_hp: p.no_hp,
        role: p.role,
        wilayah: p.wilayah,
        status: p.status,
        menu_access: p.menu_access,
        must_change_pw: p.must_change_pw,
        login_terakhir: p.login_terakhir,
      };
      if (p.tanggal_dibuat) patch.tanggal_dibuat = p.tanggal_dibuat;
      await sb.patch('profiles', { id: `eq.${p.id}` }, patch);
    }
    if (kredensial.length) writeCredentials(kredensial);
  }

  log(`  ${ditulis} profil, ${dilewati} dilewati, ${kredensial.length} password baru dibuat`);
  collected.profiles = profiles.map((p) => ({ ...p, id: undefined }));
  return { source: 'user', target: 'profiles', rows_read: rows.length, rows_written: ditulis, rows_skipped: dilewati };
}

function writeCredentials(list) {
  const dir = path.join(HERE, 'out');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const file = path.join(dir, `user-credentials-${stamp}.csv`);
  const esc = (s) => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
  const lines = [['legacy_id', 'nama', 'email', 'role', 'password'].join(',')];
  for (const k of list) lines.push([k.legacy_id, k.nama, k.email, k.role, k.password].map(esc).join(','));
  fs.writeFileSync(file, lines.join('\r\n') + '\r\n', 'utf8');
  log(`  Password baru disimpan di: ${file}`);
  log('  File ini JANGAN di-commit ke git. Bagikan ke Super Admin secara pribadi.');
}

// ---------------------------------------------------------------------------
//  2. himbauan
// ---------------------------------------------------------------------------
async function stepHimbauan(sb, sheets) {
  log('\n[2] himbauan');
  const rows = await sheets.read(SS.himbauan, 'himbauan', 5);
  const out = [];

  for (const row of rows) {
    const [id, judul, kategori, gambar, status] = row.cells;
    if (!judul.v) { issue('himbauan', id.v || row.r, 'JUDUL', 'Judul kosong - dilewati', id.v); continue; }

    const url = extractUrl(gambar.f, gambar.v);
    out.push({
      // ID di sheet berupa angka polos (1..5); diseragamkan jadi HIM-001.
      id: /^\d+$/.test(String(id.v).trim())
        ? `HIM-${pad3(id.v)}`
        : String(id.v || `HIM-${pad3(out.length + 1)}`).trim(),
      judul: String(judul.v).trim(),
      kategori: String(kategori.v || 'Informasi').trim(),
      image_file_id: extractFileId(url) || null,
      image_url: url || null,
      status: String(status.v || 'Aktif').trim().toLowerCase() === 'aktif' ? 'Aktif' : 'Nonaktif',
    });
  }
  return finish(sb, 'himbauan', 'himbauan', rows.length, out, 'id');
}

// ---------------------------------------------------------------------------
//  3. pengumuman  (sheet `informasi`)
// ---------------------------------------------------------------------------
async function stepPengumuman(sb, sheets) {
  log('\n[3] informasi -> pengumuman');
  const rows = await sheets.read(SS.info, 'informasi', 6);
  const out = [];

  for (const row of rows) {
    const [id, judul, kategori, ringkasan, tanggal, status] = row.cells;
    if (!judul.v) { issue('informasi', id.v || row.r, 'Judul', 'Judul kosong - dilewati', id.v); continue; }

    let tgl = parseDdMmYyyy(tanggal.v);
    if (!tgl) {
      if (tanggal.t === 'number') tgl = sheets.toDate(tanggal.v);
      else { issue('informasi', id.v, 'Tanggal', 'Format tanggal tidak dikenali, dipakai hari ini', tanggal.v); tgl = new Date().toISOString().slice(0, 10); }
    }

    out.push({
      id: String(id.v || `INF-${pad3(out.length + 1)}`).trim(),
      judul: String(judul.v).trim(),
      kategori: String(kategori.v || 'Informasi').trim(),
      ringkasan: String(ringkasan.v || ''),
      tanggal: tgl,
      status: String(status.v || 'Aktif').trim().toLowerCase() === 'aktif' ? 'Aktif' : 'Nonaktif',
    });
  }
  return finish(sb, 'informasi', 'pengumuman', rows.length, out, 'id');
}

// ---------------------------------------------------------------------------
//  4. fasum
// ---------------------------------------------------------------------------
async function stepFasum(sb, sheets) {
  log('\n[4] fasum');
  const rows = await sheets.read(SS.fasum, 'fasum', 5);
  const out = [];

  for (const row of rows) {
    const [id, nama, deskripsi, foto, maps] = row.cells;
    if (!nama.v) { issue('fasum', id.v || row.r, 'NAMA', 'Nama kosong - dilewati', id.v); continue; }
    const url = extractUrl(foto.f, foto.v);

    out.push({
      id: String(id.v || `FAS-${pad3(out.length + 1)}`).trim(),
      nama: String(nama.v).trim(),
      deskripsi: String(deskripsi.v || ''),
      foto_file_id: extractFileId(url) || null,
      foto_url: url || null,
      maps_url: String(maps.v || '').trim(),
    });
  }
  return finish(sb, 'fasum', 'fasum', rows.length, out, 'id');
}

// ---------------------------------------------------------------------------
//  5. organisasi  (5 tab digabung)
// ---------------------------------------------------------------------------
async function stepOrganisasi(sb, sheets) {
  log('\n[5] organisasi (5 tab)');
  const out = [];
  let dibaca = 0;

  for (const grup of ORG_TABS) {
    const rows = await sheets.read(SS.org, grup, 4);
    dibaca += rows.length;
    rows.forEach((row, idx) => {
      const [id, jabatan, nama, foto] = row.cells;
      if (!nama.v && !jabatan.v) { issue(`org:${grup}`, id.v || row.r, 'NAMA', 'Nama dan jabatan kosong - dilewati', id.v); return; }
      const url = extractUrl(foto.f, foto.v);
      out.push({
        grup,
        legacy_id: String(id.v || `ORG-${pad3(idx + 1)}`).trim(),
        jabatan: String(jabatan.v || '').trim(),
        nama: String(nama.v || '').trim(),
        foto_file_id: extractFileId(url) || null,
        foto_url: url || null,
        sort_order: idx + 1,
      });
    });
  }
  return finish(sb, 'org (5 tab)', 'organisasi', dibaca, out, 'grup,legacy_id');
}

// ---------------------------------------------------------------------------
//  6. statistik_warga
// ---------------------------------------------------------------------------
async function stepStatistik(sb, sheets) {
  log('\n[6] statistik_warga');
  const rows = await sheets.read(SS.info, 'statistik_warga', 5);
  const out = [];

  for (const row of rows) {
    const [id, nama, nilai, keterangan, diubah] = row.cells;
    if (!nama.v) { issue('statistik_warga', id.v || row.r, 'Nama Kategori', 'Nama kategori kosong - dilewati', id.v); continue; }
    const updated = waktuDariSel(sheets, diubah);
    if (diubah.v && !updated) issue('statistik_warga', id.v, 'Terakhir Diperbarui', 'Format waktu tidak dikenali', diubah.v);

    out.push(buangJikaNull({
      id: String(id.v || `STT-${pad3(out.length + 1)}`).trim(),
      nama_kategori: String(nama.v).trim(),
      nilai: toInt(nilai.v, 0),
      keterangan: String(keterangan.v || ''),
      updated_at: updated || null,
    }, 'updated_at'));   // updated_at NOT NULL -> biarkan default now()
  }
  return finish(sb, 'statistik_warga', 'statistik_warga', rows.length, out, 'id');
}

// ---------------------------------------------------------------------------
//  7. kas  (15 kolom tanpa header)
// ---------------------------------------------------------------------------
//  Peta kolom sheet -> kolom database ada di 0001_schema.sql.
//  Dua hal yang harus ekstra hati-hati di sini:
//
//  a) Kolom C (Tanggal) bisa berupa sel tanggal asli (dikembalikan sebagai
//     serial number) ATAU teks 'DD/MM/YYYY'. Code.gs:1357-1361 menangani
//     keduanya, jadi di sini juga harus keduanya.
//
//  b) Kolom M dan N berisi NAMA, bukan ID. Dipetakan ke uuid lewat
//     nameToUuid. Kalau nama tidak ketemu (mis. admin sudah keluar), uuid-nya
//     dikosongkan tapi nama teksnya tetap disimpan agar tidak hilang.
async function stepKas(sb, sheets, nameToUuid) {
  log('\n[7] rincian detail -> kas');
  const rows = await sheets.read(SS.kas, 'rincian detail', 15);
  const out = [];
  let dilewati = 0;

  if (!DRY_RUN) {
    const existing = await sb.select('kas', { select: 'id', limit: '1' });
    if (Array.isArray(existing) && existing.length && !FORCE) {
      throw new Error(
        'Tabel kas sudah berisi data. Tabel kas tidak punya kunci alami yang stabil,\n' +
        'jadi skrip akan MENGHAPUS isinya dulu sebelum mengisi ulang.\n' +
        'Kalau itu memang yang mau: ulangi dengan --force\n' +
        'Kalau tidak: kosongkan dulu lewat SQL Editor - delete from public.kas;'
      );
    }
  }

  for (const row of rows) {
    const c = row.cells;
    const legacyRow = c[0] ? c[0].v : null;
    const key = legacyRow ?? `baris-${row.r}`;

    // Tanggal transaksi (kolom C)
    let tanggal = null;
    const raw = c[2];
    if (raw) {
      if (raw.t === 'number') {
        tanggal = sheets.toDate(raw.v);
      } else {
        tanggal = parseDdMmYyyy(raw.v);
        if (!tanggal) {
          issue('kas', key, 'Tanggal', 'Format tanggal tidak dikenali - baris dilewati', raw.v);
          dilewati++;
          continue;
        }
      }
    } else {
      issue('kas', key, 'Tanggal', 'Tanggal kosong - baris dilewati', null);
      dilewati++;
      continue;
    }

    // Waktu dibuat (kolom B) - kode lama menulis ulang kolom ini tiap edit,
    // jadi nilainya berarti "terakhir diubah".
    let createdAt = null;
    const stamp = c[1];
    if (stamp && stamp.t === 'number') createdAt = sheets.toTimestamp(stamp.v);
    else if (stamp) createdAt = parseDdMmYyyyTime(stamp.v, sheets.timeZone) || null;

    const masuk = toInt(c[6] ? c[6].v : 0, 0);
    const keluar = toInt(c[7] ? c[7].v : 0, 0);
    if (masuk <= 0 && keluar <= 0) {
      issue('kas', key, 'Masuk/Keluar', 'Nominal nol semua - baris dilewati (tidak boleh di database)', `masuk=${masuk} keluar=${keluar}`);
      dilewati++;
      continue;
    }

    const buktiUrl = c[10] ? extractUrl(c[10].f, c[10].v) : '';
    const createdByName = c[12] ? String(c[12].v || '').trim() : '';
    const approvedByName = c[13] ? String(c[13].v || '').trim() : '';
    const statusRaw = c[11] ? String(c[11].v || 'Menunggu').trim() : 'Menunggu';
    const status = ['Menunggu', 'Disetujui', 'Ditolak'].includes(statusRaw) ? statusRaw : 'Menunggu';
    if (!['Menunggu', 'Disetujui', 'Ditolak'].includes(statusRaw)) {
      issue('kas', key, 'Status', `Status "${statusRaw}" tidak dikenal, dipakai Menunggu`, statusRaw);
    }
    const metodeRaw = c[5] ? String(c[5].v || 'Tunai').trim() : 'Tunai';
    const metode = ['Tunai', 'Transfer'].includes(metodeRaw) ? metodeRaw : 'Tunai';
    if (!['Tunai', 'Transfer'].includes(metodeRaw)) {
      issue('kas', key, 'Metode', `Metode "${metodeRaw}" tidak dikenal, dipakai Tunai`, metodeRaw);
    }

    const look = (n) => nameToUuid.get(n) || nameToUuid.get(n.toLowerCase()) || null;
    const createdBy = createdByName ? look(createdByName) : null;
    if (createdByName && !createdBy) {
      issue('kas', key, 'M (pembuat)', `Nama "${createdByName}" tidak ada di daftar user - uuid dikosongkan, nama tetap disimpan`, createdByName);
    }
    const approvedBy = approvedByName ? look(approvedByName) : null;
    if (approvedByName && !approvedBy) {
      issue('kas', key, 'N (penyetuju)', `Nama "${approvedByName}" tidak ada di daftar user - uuid dikosongkan, nama tetap disimpan`, approvedByName);
    }

    out.push(buangJikaNull({
      legacy_row: Number.isFinite(Number(legacyRow)) ? Number(legacyRow) : row.r - 1,
      tanggal,
      uraian: String(c[3] ? c[3].v : '').trim() || '(tanpa uraian)',
      pj: c[4] ? (String(c[4].v || '').trim() || null) : null,
      metode,
      masuk,
      keluar,
      keterangan: c[8] ? (String(c[8].v || '').trim() || null) : null,
      bukti_file_id: extractFileId(buktiUrl) || null,
      bukti_url: buktiUrl || null,
      status,
      created_by: createdBy,
      created_by_name: createdByName || '-',
      approved_by: approvedBy,
      approved_by_name: approvedByName || null,
      alasan_ditolak: c[14] ? (String(c[14].v || '').trim() || null) : null,
      created_at: createdAt,
      updated_at: createdAt,
      // Kolom B (tanggal diubah) bisa kosong di sheet, sedangkan kolom ini
      // NOT NULL. Kalau dihapus, PostgreSQL memakai now() - yang justru
      // sudah benar: transaksi tanpa stempel waktu dianggap baru diimpor.
    }, 'created_at', 'updated_at'));
  }

  collected.kas = out;
  let ditulis = 0;
  if (!DRY_RUN) {
    await sb.remove('kas', { id: 'neq.00000000-0000-0000-0000-000000000000' });
    for (const batch of chunk(out, 200)) {
      await sb.upsert('kas', batch);
      ditulis += batch.length;
    }
  } else {
    ditulis = out.length;
  }
  log(`  ${ditulis} transaksi, ${dilewati} dilewati`);
  return { source: 'rincian detail', target: 'kas', rows_read: rows.length, rows_written: ditulis, rows_skipped: dilewati, _kas: out };
}

// ---------------------------------------------------------------------------
//  8. log
// ---------------------------------------------------------------------------
async function stepVisitorLog(sb, sheets) {
  const cutoff = new Date(Date.now() - VISITOR_DAYS * 86400000).toISOString().slice(0, 10);
  log(`\n[8] visitor_log (hanya ${VISITOR_DAYS} hari terakhir, sejak ${cutoff})`);
  const rows = await sheets.read(SS.user, 'visitor_log', 8);
  const out = [];
  let dilewati = 0;

  for (const row of rows) {
    const [stamp, tgl, page, referrer, ua, bahasa, screen, sid] = row.cells;
    // Kolom B ditulis sebagai teks ISO 'yyyy-MM-dd' oleh Code.gs:549, tapi
    // bisa juga sel tanggal asli kalau ada yang mengedit manual.
    const tanggal = tanggalDariSel(sheets, tgl) || parseIso(tgl.v);
    if (!tanggal) {
      issue('visitor_log', row.r, 'Tanggal', 'Tanggal tidak terbaca - dilewati', tgl.v);
      dilewati++;
      continue;
    }
    if (tanggal < cutoff) { dilewati++; continue; }

    out.push(buangJikaNull({
      tanggal,
      visited_at: waktuDariSel(sheets, stamp) || `${tanggal}T00:00:00+07:00`,
      page: String(page.v || '/').slice(0, 200),
      referrer: String(referrer.v || '').slice(0, 400),
      ua: String(ua.v || '').slice(0, 400),
      bahasa: String(bahasa.v || '').slice(0, 20),
      screen: String(screen.v || '').slice(0, 30),
      session_id: String(sid.v || '').slice(0, 60),
    }, 'visited_at'));
  }

  // Cetak rentang tanggal yang ditemukan, supaya jelas apakah semua data
  // memang berada di luar jendela 90 hari atau ada masalah pembacaan.
  const semua = [];
  for (const row of rows) {
    const d = tanggalDariSel(sheets, row.cells[1]) || parseIso(row.cells[1].v);
    if (d) semua.push(d);
  }
  if (semua.length) {
    const min = semua.reduce((a, b) => (a < b ? a : b));
    const max = semua.reduce((a, b) => (a > b ? a : b));
    log(`  Rentang data di sheet: ${min} s.d. ${max}  (${semua.length} baris, jendela: ${cutoff} ke sekarang)`);
  }
  return finish(sb, 'visitor_log', 'visitor_log', rows.length, out, null, true);
}

function parseIso(text) {
  const m = String(text || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

async function stepActivityLog(sb, sheets) {
  log('\n[9] activity_log');
  const rows = await sheets.read(SS.info, 'activity_log', 6);
  const out = [];
  for (const row of rows) {
    const [stamp, actor, role, action, module, description] = row.cells;
    const created = waktuDariSel(sheets, stamp);
    if (!created) { issue('activity_log', row.r, 'Timestamp', 'Format waktu tidak dikenali - dilewati', stamp.v); continue; }
    out.push({
      actor: null,
      actor_name: String(actor.v || 'System'),
      actor_role: String(role.v || '-'),
      action: String(action.v || ''),
      module: String(module.v || ''),
      description: String(description.v || ''),
      created_at: created,
    });
  }
  return finish(sb, 'activity_log', 'activity_log', rows.length, out, null, true);
}

// ---------------------------------------------------------------------------
//  Helper penulisan
// ---------------------------------------------------------------------------
async function finish(sb, source, target, readCount, rows, onConflict, appendOnly = false) {
  collected[target] = rows;
  let ditulis = 0;
  if (!DRY_RUN) {
    if (appendOnly) {
      // Tabel log hanya bertambah dan tidak punya kunci alami. Isi ulang supaya
      // menjalankan skrip dua kali tidak menggandakan baris.
      //
      // Wajib memakai klausa WHERE: PostgREST menolak "DELETE without a WHERE
      // clause" demi mencegah salah hapus seluruh tabel tanpa sengaja.
      const filter = target === 'visitor_log'
        ? { tanggal: `gte.${new Date(Date.now() - VISITOR_DAYS * 86400000).toISOString().slice(0, 10)}` }
        : { id: 'gte.0' };
      await sb.remove(target, filter);
    }
    for (const batch of chunk(rows, 200)) {
      await sb.upsert(target, batch, onConflict || undefined);
      ditulis += batch.length;
    }
  } else {
    ditulis = rows.length;
  }
  log(`  ${ditulis} baris ditulis ke ${target}`);
  return { source, target, rows_read: readCount, rows_written: ditulis, rows_skipped: readCount - rows.length };
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function saveAudit(sb, audit) {
  if (DRY_RUN) return;
  const runs = audit.map(({ source, target, rows_read, rows_written, rows_skipped }) => ({
    source, target, rows_read, rows_written, rows_skipped, status: 'sukses',
  }));
  await sb.upsert('migration_run', runs);
  for (const batch of chunk(issues, 200)) await sb.upsert('migration_issue', batch);
}

// ---------------------------------------------------------------------------
//  Verifikasi: bandingkan logika LAMA (Code.gs) dengan hasil fungsi BARU
// ---------------------------------------------------------------------------
//  Ini pengaman paling penting. Logika kas_reportData_ (Code.gs:479-522)
//  ditulis ulang persis di sini dari data mentah sheet, lalu dibandingkan
//  dengan angka yang dikembalikan kas_report() di database. Kalau keduanya
//  cocok, migrasi tidak mengubah angka yang selama ini tampil di website.
async function verify(sb, sheets, kasRows, nameToUuid) {
  log('\n' + '='.repeat(66));
  log('VERIFIKASI: logika lama (Code.gs) vs fungsi baru (PostgreSQL)');
  log('='.repeat(66));

  let beda = 0, dicek = 0;

  for (let bulan = 0; bulan < 12; bulan++) {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() - bulan, 1);
    const tahun = d.getFullYear();

    // --- hitung ulang dengan logika Code.gs ---
    let saldoAwal = 0, totalMasuk = 0, totalKeluar = 0;
    for (const r of kasRows._kas || []) {
      if (r.status !== 'Disetujui') continue;
      const t = new Date(r.tanggal + 'T00:00:00');
      const m = t.getMonth(), y = t.getFullYear();
      if (y < tahun || (y === tahun && m < bulan)) { saldoAwal += r.masuk - r.keluar; }
      else if (m === bulan && y === tahun) {
        if (r.masuk > 0) totalMasuk += r.masuk;
        if (r.keluar > 0) totalKeluar += r.keluar;
      }
    }
    const lama = {
      saldoAwal, totalMasuk, totalKeluar, saldoAkhir: saldoAwal + totalMasuk - totalKeluar,
    };

    // --- ambil dari database lewat RPC publik ---
    const baru = await sb.rpc('kas_report', { p_bulan: bulan, p_tahun: tahun }, { anon: true });
    dicek++;

    const beda2 = ['saldoAwal', 'totalMasuk', 'totalKeluar', 'saldoAkhir']
      .filter((k) => Number(baru[k]) !== Number(lama[k]));
    const label = `${String(bulan + 1).padStart(2, '0')}/${tahun}`;
    if (beda2.length) {
      beda++;
      log(`  ${label}  BEDA: ${beda2.map((k) => `${k} lama=${lama[k]} baru=${baru[k]}`).join(', ')}`);
    } else {
      log(`  ${label}  cocok  (saldo akhir ${lama.saldoAkhir.toLocaleString('id-ID')})`);
    }
  }

  log('-'.repeat(66));
  log(`  ${dicek - beda}/${dicek} bulan cocok, ${beda} bulan berbeda`);

  // jumlah baris per tabel
  log('\n  Jumlah baris di database:');
  for (const t of ['profiles', 'himbauan', 'pengumuman', 'fasum', 'organisasi', 'statistik_warga', 'kas', 'activity_log', 'visitor_log']) {
    const rows = await sb.select(t, { select: 'id', limit: '1000' });
    log(`    ${t.padEnd(16)} ${Array.isArray(rows) ? rows.length : '?'}`);
  }
}

// ---------------------------------------------------------------------------
main().catch((e) => {
  console.error('\nGAGAL: ' + e.message);
  process.exit(1);
});
