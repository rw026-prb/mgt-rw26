// Alat bantu debug: melacak kedalaman kurung per baris.
import fs from 'node:fs';

const lines = fs.readFileSync('D:/Website RW/Mgt-portal RW/Code.gs', 'utf8').split(/\r?\n/);

let inS = false, inD = false, inT = false, inB = false, depth = 0;
const BT = String.fromCharCode(96);
const ev = [];

lines.forEach((L, i) => {
  const before = depth;
  const wasIn = { S: inS, D: inD, T: inT, B: inB };
  for (let j = 0; j < L.length; j++) {
    const c = L[j], n = L[j + 1];
    if (inB) { if (c === '*' && n === '/') { inB = false; j++; } continue; }
    if (inT) { if (c === '\\') { j++; continue; } if (c === BT) { inT = false; } continue; }
    if (inS) { if (c === '\\') { j++; continue; } if (c === "'") { inS = false; } continue; }
    if (inD) { if (c === '\\') { j++; continue; } if (c === '"') { inD = false; } continue; }
    if (c === '-' && n === '-') break;
    if (c === '/' && n === '*') { inB = true; j++; continue; }
    if (c === BT) { inT = true; continue; }
    if (c === "'") { inS = true; continue; }
    if (c === '"') { inD = true; continue; }
    if (c === '{') depth++;
    if (c === '}') depth--;
  }
  if (/^\s*function\s/.test(L)) {
    ev.push({ baris: i + 1, depthSebelum: before, depthSesudah: depth, nama: (L.match(/function\s+(\w+)/) || [])[1] });
  }
  // Catat setiap linha yang kedalamannya berubah, supaya terlihat dari mana
  // hitungan mulai meleset.
  if (before !== depth && i < 60) {
    console.log(`  baris ${String(i + 1).padStart(3)}  ${before} -> ${depth}   [S=${wasIn.S} D=${wasIn.D} T=${wasIn.T} B=${wasIn.B}]  ${L.slice(0, 70)}`);
  }
});

console.log('fungsi di baris yang SETELAH depth!=0:', ev.filter((e) => e.depthSesudah !== 0).length, 'dari', ev.length);
console.log('\n10 pertama yang salah:');
for (const e of ev.filter((x) => x.depthSesudah !== 0).slice(0, 10)) {
  console.log(`  baris ${e.baris}  depth -> ${e.depthSesudah}  ${e.nama}`);
}
console.log('\nkeadaan akhir: depth=' + depth, 'inS=' + inS, 'inD=' + inD, 'inT=' + inT, 'inB=' + inB);

// Tunjukkan baris yang membuat depth tidak kembali ke 0 untuk blok pertama
const firstBad = ev.find((e) => e.depthSesudah !== 0);
if (firstBad) {
  console.log('\nkonteks sekitar baris ' + firstBad.baris + ':');
  for (let k = Math.max(0, firstBad.baris - 8); k < Math.min(lines.length, firstBad.baris + 3); k++) {
    console.log(String(k + 1).padStart(5) + ': ' + lines[k].slice(0, 110));
  }
}
