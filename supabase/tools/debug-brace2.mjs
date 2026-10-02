// Cari fungsi pertama yang plexus kurungnya tidak seimbang.
import fs from 'node:fs';

const lines = fs.readFileSync('D:/Website RW/Mgt-portal RW/Code.gs', 'utf8').split(/\r?\n/);
const BT = String.fromCharCode(96);
const SQ = String.fromCharCode(39);
const DQ = String.fromCharCode(34);

let inS = false, inD = false, inT = false, inB = false, depth = 0;
const clean = [];

lines.forEach((L) => {
  let c2 = '';
  for (let j = 0; j < L.length; j++) {
    const c = L[j], n = L[j + 1];
    if (inB) { if (c === '*' && n === '/') { inB = false; j++; c2 += '  '; } else c2 += ' '; continue; }
    if (inT) { if (c === '\\') { j++; c2 += '  '; continue; } if (c === BT) inT = false; c2 += ' '; continue; }
    if (inS) { if (c === '\\') { j++; c2 += '  '; continue; } if (c === SQ) inS = false; c2 += ' '; continue; }
    if (inD) { if (c === '\\') { j++; c2 += '  '; continue; } if (c === DQ) inD = false; c2 += ' '; continue; }
    if (c === '-' && n === '-') break;
    if (c === '/' && n === '*') { inB = true; j++; c2 += '  '; continue; }
    if (c === BT) { inT = true; c2 += ' '; continue; }
    if (c === SQ) { inS = true; c2 += ' '; continue; }
    if (c === DQ) { inD = true; c2 += ' '; continue; }
    c2 += c;
  }
  clean.push(c2);
});

// Nexus kumulatif: pada awal setiap baris `function`, depth harus 0.
let d = 0;
let firstBad = -1;
for (let i = 0; i < lines.length; i++) {
  if (/^\s*function\s/.test(lines[i]) && d !== 0) { firstBad = i; break; }
  for (const ch of clean[i]) { if (ch === '{') d++; else if (ch === '}') d--; }
}

if (firstBad < 0) {
  console.log('Semua baris function berada pada depth 0. depth akhir = ' + d);
} else {
  console.log('Fungsi pertama yang mulai pada depth != 0: baris ' + (firstBad + 1));
  console.log('   ' + lines[firstBad].slice(0, 120));
  // Kembalikan kedalaman ke 0 lalu cari berikutnya
  d = 0;
  const bad = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*function\s/.test(lines[i]) && d !== 0) bad.push({ baris: i + 1, depth: d, teks: lines[i].slice(0, 90) });
    for (const ch of clean[i]) { if (ch === '{') d++; else if (ch === '}') d--; }
  }
  console.log('\nTotal fungsi yang tidak mulai pada depth 0: ' + bad.length);
  console.log('\n10 pertama:');
  for (const b of bad.slice(0, 10)) console.log('  baris ' + b.baris + ' depth=' + b.depth + '  ' + b.teks);
}
