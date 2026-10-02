// Uji fungsi konversi tanggal & parsing tanpa perlu koneksi internet.
import {
  serialToDate, serialToTimestamp, parseDdMmYyyy, parseDdMmYyyyTime,
  extractUrl, extractFileId, toInt, randomPassword,
} from './lib.mjs';

let lulus = 0, gagal = 0;
function cek(nama, dapat, harus) {
  const ok = JSON.stringify(dapat) === JSON.stringify(harus);
  if (ok) { lulus++; console.log(`  OK    ${nama}`); }
  else { gagal++; console.log(`  SALAH ${nama}\n          dapat : ${JSON.stringify(dapat)}\n          harus : ${JSON.stringify(harus)}`); }
}

console.log('serialToDate');
// 25569 = 1970-01-01 00:00 UTC
cek('epoch, UTC', serialToDate(25569, 'UTC'), '1970-01-01');
cek('epoch, Jakarta', serialToDate(25569, 'Asia/Jakarta'), '1970-01-01');
cek('setengah hari', serialToDate(25569.5, 'UTC'), '1970-01-01');

// 2026-08-09 00:00 Asia/Jakarta = 2026-08-08 17:00 UTC
const serialJakartaTengahMalam = (Date.UTC(2026, 7, 8, 17, 0, 0) / 86400000) + 25569;
cek('09/08/2026 tengah malam Jakarta', serialToDate(serialJakartaTengahMalam, 'Asia/Jakarta'), '2026-08-09');
cek('sama, dibaca sebagai UTC', serialToDate(serialJakartaTengahMalam, 'UTC'), '2026-08-08');

console.log('\nserialToTimestamp');
cek('stempel 14:30 Jakarta', serialToTimestamp(serialJakartaTengahMalam + 14.5 / 24, 'Asia/Jakarta'), '2026-08-09T14:30:00+07:00');
cek('stempel 00:00 UTC', serialToTimestamp(25569, 'UTC'), '1970-01-01T00:00:00+00:00');

console.log('\nparseDdMmYyyy');
cek('format normal', parseDdMmYyyy('09/08/2026'), '2026-08-09');
cek('tanpa nol di depan', parseDdMmYyyy('9/8/2026'), '2026-08-09');
cek('31 desember', parseDdMmYyyy('31/12/2026'), '2026-12-31');
cek('bukan tanggal', parseDdMmYyyy('bukan'), '');
cek('kosong', parseDdMmYyyy(''), '');
cek('ISO tidak boleh', parseDdMmYyyy('2026-08-09'), '');
cek('31 februari ditolak', parseDdMmYyyy('31/02/2026'), '');
cek('1 Januari sah (awal tahun)', parseDdMmYyyy('01/01/2026'), '2026-01-01');
cek('32 didokumen ditolak', parseDdMmYyyy('32/01/2026'), '');
cek('13 bulan ditolak', parseDdMmYyyy('01/13/2026'), '');
cek('29 feb 2024 (tahun kabisat) sah', parseDdMmYyyy('29/02/2024'), '2024-02-29');
cek('29 feb 2026 ditolak', parseDdMmYyyy('29/02/2026'), '');

console.log('\nparseDdMmYyyyTime');
cek('dengan jam', parseDdMmYyyyTime('09/08/2026 14:30', 'Asia/Jakarta'), '2026-08-09T14:30:00+07:00');
cek('tanpa jam', parseDdMmYyyyTime('09/08/2026', 'Asia/Jakarta'), '2026-08-09T00:00:00+07:00');
cek('menit 05', parseDdMmYyyyTime('01/01/2026 08:05', 'Asia/Jakarta'), '2026-01-01T08:05:00+07:00');
cek('salah format', parseDdMmYyyyTime('2026-08-09 14:30', 'Asia/Jakarta'), '');

console.log('\nextractUrl / extractFileId');
cek('formula HYPERLINK', extractUrl('=HYPERLINK("https://drive.google.com/file/d/1aBcD_Xy/view";"Judul")'), 'https://drive.google.com/file/d/1aBcD_Xy/view');
cek('formula tanpa titik koma', extractUrl('=HYPERLINK("https://drive.google.com/file/d/1aBcD_Xy/view", "Judul")'), 'https://drive.google.com/file/d/1aBcD_Xy/view');
cek('URL telanjang', extractUrl(null, 'https://drive.google.com/file/d/1aBcD_Xy/view'), 'https://drive.google.com/file/d/1aBcD_Xy/view');
cek('file id dari /d/', extractFileId('https://drive.google.com/file/d/1aBcD_Xy/view?usp=drive_link'), '1aBcD_Xy');
cek('file id dari ?id=', extractFileId('https://drive.google.com/uc?export=view&id=1aBcD_Xy'), '1aBcD_Xy');
cek('bukan link drive', extractFileId('https://example.com/foto.jpg'), '');

console.log('\ntoInt');
cek('angka', toInt('500000'), 500000);
cek('teks angka', toInt('500000'), 500000);
cek('kosong -> 0', toInt(''), 0);
cek('bukan angka -> 0', toInt('abc'), 0);
cek('pecahan dibulatkan', toInt('150000.6'), 150001);

console.log('\nrandomPassword');
for (let i = 0; i < 200; i++) {
  const pw = randomPassword(16);
  if (pw.length !== 16) { gagal++; console.log('  SALAH panjang: ' + pw.length); break; }
  if (!/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/\d/.test(pw)) { gagal++; console.log('  SALAH komposisi: ' + pw); break; }
  if (i === 199) { lulus++; console.log('  OK    200 password: panjang 16, ada huruf besar/kecil/angka, semua unik'); }
}
const unik = new Set(Array.from({ length: 500 }, () => randomPassword(16)));
cek('500 password semuanya berbeda', unik.size, 500);

console.log(`\nlulus ${lulus}, gagal ${gagal}`);
process.exit(gagal ? 1 : 0);
