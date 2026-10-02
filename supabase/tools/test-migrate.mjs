// ============================================================================
//  test-migrate.mjs  —  Uji transformer dengan data yang meniru Sheets nyata
// ============================================================================
//  Tidak menyentuh Google maupun Supabase. Hanya menguji cara baris sheet
//  diubah menjadi baris tabel.
//
//  Yang diuji sengaja kasus sulit:
//    - kolom Tanggal kas berupa teks 'DD/MM/YYYY' DAN sel tanggal asli (serial)
//    - kolom foto berisi formula =HYPERLINK, bukan URL biasa
//    - kolom M/N berisi NAMA orang yang sebagian tidak ada di daftar user
//    - baris dengan nominal nol, metode ngawur, status ngawur
//    - ID organisasi yang sama muncul di 5 tab berbeda
// ============================================================================

import { parseDdMmYyyy, parseDdMmYyyyTime, extractUrl, extractFileId, toInt } from './lib.mjs';

let lulus = 0, gagal = 0;
function cek(nama, dapat, harus) {
  const ok = JSON.stringify(dapat) === JSON.stringify(harus);
  if (ok) { lulus++; }
  else { gagal++; console.log(`  SALAH ${nama}\n          dapat : ${JSON.stringify(dapat)}\n          harus : ${JSON.stringify(harus)}`); }
}

// ---------------------------------------------------------------------------
//  Baris tiruan: bentuknya sama dengan yang dihasilkan Sheets.read()
const sel = (v, t) => ({ v, f: null, t: t || (typeof v === 'number' ? 'number' : 'string') });
const formula = (v, f) => ({ v, f, t: 'formula' });
const baris = (cells) => ({ cells });

// 2026-08-09 00:00 Asia/Jakarta -> serial Google
const serialTgl = (y, m, d) => (Date.UTC(y, m - 1, d) - 7 * 3600000) / 86400000 + 25569;

console.log('KASUS 1: kolom Tanggal kas ada dua jenis');
const kasTeks = baris([
  sel(1),                                   // A  legacy_row
  sel(serialTgl(2026, 8, 9) + 0.6),         // B  timestamp
  sel('09/08/2026'),                        // C  tanggal TEKS
  sel('Iuran Agustus'),                     // D  uraian
  sel('-'), sel('Tunai'), sel(500000), sel(0), sel('-'),
  sel('-'), sel('-'),                       // J  saldo (diabaikan)
  sel(''),                                  // K  bukti kosong
  sel('Disetujui'), sel('Bendahara'), sel(''), sel(''),
]);
const kasSerial = baris([
  sel(2),
  sel(serialTgl(2026, 8, 10) + 0.6),
  sel(serialTgl(2026, 8, 10)),              // C  tanggal sebagai SERIAL
  sel('Bayar listrik'), sel('-'), sel('Tunai'), sel(0), sel(150000), sel('-'),
  sel('-'), sel('-'), sel('Disetujui'), sel('Bendahara'), sel(''), sel(''),
]);

cek('tanggal bertipe TEKS', parseDdMmYyyy(kasTeks.cells[2].v), '2026-08-09');
cek('tanggal bertipe SERIAL -> tanggal yang sama',
    (() => {
      const s = kasSerial.cells[2].v;
      return new Date(Math.round((s - 25569) * 86400000))
        .toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    })(),
    '2026-08-10');
cek('timestamp kolom B', parseDdMmYyyyTime('09/08/2026 14:30', 'Asia/Jakarta'), '2026-08-09T14:30:00+07:00');

console.log('KASUS 2: kolom foto berisi formula HYPERLINK');
const foto = formula('Judul Berita', '=HYPERLINK("https://drive.google.com/file/d/1XyZ_ab-123/view?usp=drive_link";"Judul Berita")');
cek('URL diambil dari formula, bukan teks', extractUrl(foto.f, foto.v), 'https://drive.google.com/file/d/1XyZ_ab-123/view?usp=drive_link');
cek('file id', extractFileId(extractUrl(foto.f, foto.v)), '1XyZ_ab-123');
cek('kalau teksnya cuma label, tetap dapat dari formula',
    extractUrl(foto.f, 'Hanya label tanpa link'), 'https://drive.google.com/file/d/1XyZ_ab-123/view?usp=drive_link');

console.log('KASUS 3: nama pembuat yang tidak ada di daftar user');
const users = new Map([['budi', 'uuid-1'], ['siti', 'uuid-2']]);
const cari = (n) => users.get(n) || users.get(n.toLowerCase()) || null;
cek('nama dikenal', cari('Budi'), 'uuid-1');
cek('nama dengan huruf besar', cari('SITI'), 'uuid-2');
cek('nama tidak dikenal -> null', cari('Pak RT Lama'), null);
cek('nama kosong -> null', cari(''), null);

console.log('KASUS 4: nilai yang harus disaring');
// Cerminan kode di migrate.mjs: nilai di luar daftar yang dikenal -> bawaan.
const metodeDb = (m) => (['Tunai', 'Transfer'].includes(m) ? m : 'Tunai');
const statusDbKas = (s) => (['Menunggu', 'Disetujui', 'Ditolak'].includes(s) ? s : 'Menunggu');

cek('masuk 750000 -> diterima', toInt(750000, 0) > 0, true);
cek('metode "Transfer" dipertahankan', metodeDb('Transfer'), 'Transfer');
cek('metode "Transfer Bank" -> Tunai', metodeDb('Transfer Bank'), 'Tunai');
cek('metode kosong -> Tunai', metodeDb(''), 'Tunai');
cek('status "Disetujui" dipertahankan', statusDbKas('Disetujui'), 'Disetujui');
cek('status "Dibaca" -> Menunggu', statusDbKas('Dibaca'), 'Menunggu');
cek('status kosong -> Menunggu (bukan error)', statusDbKas(''), 'Menunggu');

console.log('KASUS 5: ID organisasi sama di 5 tab');
const perGrup = ['rw', 'posyandu', 'pkk', 'bank-sampah', 'pokmas'];
const semuaOrg = perGrup.flatMap((g) => [{ grup: g, legacy_id: 'ORG-001' }, { grup: g, legacy_id: 'ORG-002' }]);
const kunciUnik = new Set(semuaOrg.map((o) => `${o.grup}|${o.legacy_id}`));
cek('10 baris, 10 kunci unik', kunciUnik.size, 10);
cek('ORG-001 muncul 5 kali (satu per grup)', semuaOrg.filter((o) => o.legacy_id === 'ORG-001').length, 5);

console.log('KASUS 6: ID himbauan polos jadi ber-prefix');
const lama = ['1', '2', '3', '4', '5'];
cek('1 -> HIM-001', lama.map((v) => `HIM-${v.padStart(3, '0')}`)[0], 'HIM-001');
cek('5 -> HIM-005', lama.map((v) => `HIM-${v.padStart(3, '0')}`)[4], 'HIM-005');

console.log('KASUS 7: status dengan huruf kapital tidak konsisten');
const statusDb = (s) => String(s || '').trim().toLowerCase() === 'aktif' ? 'Aktif' : 'Nonaktif';
cek('"Aktif"', statusDb('Aktif'), 'Aktif');
cek('"aktif"', statusDb('aktif'), 'Aktif');
cek('"AKTIF"', statusDb('AKTIF'), 'Aktif');
cek('"Aktif " (ada spasi)', statusDb('Aktif '), 'Aktif');
cek('"Nonaktif"', statusDb('Nonaktif'), 'Nonaktif');
cek('"" (kosong) -> Nonaktif, bukan error', statusDb(''), 'Nonaktif');

console.log(`\nlulus ${lulus}, gagal ${gagal}`);
process.exit(gagal ? 1 : 0);
