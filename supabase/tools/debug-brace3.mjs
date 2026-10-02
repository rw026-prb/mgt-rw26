// Pemeriksa kedalaman kurung dengan penanganan operator decrement yang benar.
import fs from 'node:fs';

const lines = fs.readFileSync('D:/Website RW/Mgt-portal RW/Code.gs', 'utf8').split(/\r?\n/);
const BT = String.fromCharCode(96), SQ = String.fromCharCode(39), DQ = String.fromCharCode(34);

let inS = false, inD = false, inT = false, inB = false;
let depth = 0;
const clean = lines.map((L) => {
  let out = '';
  for (let j = 0; j < L.length; j++) {
    const c = L[j], n = L[j + 1];
    if (inB) { if (c === '*' && n === '/') { inB = false; j++; out += '  '; } else out += ' '; continue; }
    if (inT) { if (c === '\\') { j++; out += '  '; continue; } if (c === BT) inT = false; out += ' '; continue; }
    if (inS) { if (c === '\\') { j++; out += '  '; continue; } if (c === SQ) inS = false; out += ' '; continue; }
    if (inD) { if (c === '\\') { j++; out += '  '; continue; } if (c === DQ) inD = false; out += ' '; continue; }
    if (c === '/' && n === '/') break;
    if (c === '-' && n === '-' && (j === 0 || /\s/.test(L[j - 1])) && (j + 2 >= L.length || /\s/.test(L[j + 2]))) break;
    if (c === '/' && n === '*') { inB = true; j++; out += '  '; continue; }
    if (c === BT) { inT = true; out += ' '; continue; }
    if (c === SQ) { inS = true; out += ' '; continue; }
    if (c === DQ) { inD = true; out += ' '; continue; }
    out += c;
  }
  return out;
});

const bad = [];
for (let i = 0; i < lines.length; i++) {
  const before = depth;
  for (const ch of clean[i]) { if (ch === '{') depth++; else if (ch === '}') depth--; }
  if (/^\s*function\s/.test(lines[i]) && before !== 0) {
    bad.push({ baris: i + 1, depth: before, teks: lines[i].slice(0, 80) });
  }
}
console.log('fungsi pada depth != 0 :', bad.length, 'dari', lines.filter((l) => /^\s*function\s/.test(l)).length);
console.log('depth akhir            :', depth, ' inS=' + inS, ' inD=' + inD, ' inT=' + inT, ' inB=' + inB);
if (bad.length) for (const b of bad.slice(0, 6)) console.log('  baris ' + b.baris + ' depth=' + b.depth + '  ' + b.teks);
if (inS || inD || inT || inB) {
  console.log('\nADA STRING/KOMENTAR YANG TIDAK TERTUTUP -> cari baris pembuka terakhir:');
  for (let i = 0; i < lines.length; i++) {
    if (/`/.test(lines[i]) && !/^\s*\*/.test(lines[i])) {
      const k = (lines[i].match(/`/g) || []).length;
      if (k % 2 === 1) console.log('  backtick ganjil di baris ' + (i + 1) + ': ' + lines[i].slice(0, 90));
    }
  }
}
