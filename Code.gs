/**
 * Backend Google Apps Script - Portal RW 26
 * Tempel file ini pada Extensions > Apps Script, lalu deploy ulang sebagai Web App.
 */
const USER_SPREADSHEET_ID = '1MYvidwDFe65xCsZz9AP2zAGpv3SHXE9QRxulqULXxGY';
const USER_SHEET_NAME = 'user';
const HIMBAUAN_SPREADSHEET_ID = '1CnjK2IQ2bAAIMuQ3C8liNDsz9RP3gy1Ls_Ud6Y9zqdE';
const HIMBAUAN_SHEET_NAME = 'Sheet1';
const HIMBAUAN_DRIVE_FOLDER_ID = '1ypF7zjtpk86ZAWktMQ9BM3mhtLLls-9y';
const HEADERS = ['User ID','Nama Lengkap','Email','No HP','Role ID','Wilayah ID','Status','Password Hash','Login Terakhir','Tanggal Dibuat'];
const HIMBAUAN_HEADERS = ['ID','JUDUL','KATEGORI','GAMBAR','STATUS'];
const SESSION_SECONDS = 21600;

function doGet() {
  return json_({ok:true, service:'Portal RW 26 API', time:formatDate_(new Date())});
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    switch (body.action) {
      case 'login': return login_(body);
      case 'logout': return logout_(body);
      case 'listUsers': return listUsers_(body);
      case 'createUser': return createUser_(body);
      case 'updateUser': return updateUser_(body);
      case 'toggleUser': return toggleUser_(body);
      case 'deleteUser': return deleteUser_(body);
      case 'listHimbauan': return listHimbauan_(body);
      case 'createHimbauan': return createHimbauan_(body);
      case 'toggleHimbauan': return toggleHimbauan_(body);
      case 'deleteHimbauan': return deleteHimbauan_(body);
      default: throw new Error('Aksi API tidak dikenal.');
    }
  } catch (err) {
    return json_({ok:false, message:err.message || 'Terjadi kesalahan server.'});
  }
}

function setupSheet() {
  const sheet = getSheet_();
  if (sheet.getLastRow() === 0) sheet.getRange(1,1,1,HEADERS.length).setValues([HEADERS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1,1,1,HEADERS.length).setFontWeight('bold').setBackground('#d9ead3');
  sheet.autoResizeColumns(1,HEADERS.length);
}

function setupHimbauanSheet() {
  const sheet = getHimbauanSheet_();
  if (sheet.getLastRow() === 0) sheet.getRange(1,1,1,HIMBAUAN_HEADERS.length).setValues([HIMBAUAN_HEADERS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1,1,1,HIMBAUAN_HEADERS.length).setFontWeight('bold').setBackground('#d9ead3');
  sheet.autoResizeColumns(1,HIMBAUAN_HEADERS.length);
}

function login_(body) {
  const identifier = String(body.identifier || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!identifier || !password) throw new Error('User ID/email dan password wajib diisi.');
  const sheet = getSheet_(), rows = getRows_(sheet);
  const index = rows.findIndex(r => String(r[0]).toLowerCase() === identifier || String(r[2]).toLowerCase() === identifier);
  if (index < 0) throw new Error('Akun tidak ditemukan.');
  const row = rows[index];
  if (String(row[6]).toLowerCase() !== 'aktif') throw new Error('Akun sedang nonaktif. Hubungi administrator.');
  const incomingHash = hashPassword_(password);
  const stored = String(row[7] || '');
  if (stored !== incomingHash && stored !== password) throw new Error('Password yang Anda masukkan salah.');
  const rowNumber = index + 2;
  if (stored === password) sheet.getRange(rowNumber,8).setValue(incomingHash);
  sheet.getRange(rowNumber,9).setValue(formatDate_(new Date()));
  const token = Utilities.getUuid() + Utilities.getUuid();
  const user = rowToUser_(row); user.loginTerakhir = formatDate_(new Date());
  CacheService.getScriptCache().put('session_' + token, JSON.stringify(user), SESSION_SECONDS);
  return json_({ok:true, token:token, user:user, expiresAt:Date.now() + SESSION_SECONDS * 1000});
}

function logout_(body) {
  if (body.token) CacheService.getScriptCache().remove('session_' + body.token);
  return json_({ok:true});
}

function listUsers_(body) {
  requireAdmin_(body.token);
  return json_({ok:true, users:getRows_(getSheet_()).map(rowToUser_)});
}

function createUser_(body) {
  requireAdmin_(body.token);
  const u = body.user || {}, sheet = getSheet_(), rows = getRows_(sheet);
  if (!u.nama || !u.email || !u.password) throw new Error('Nama, email, dan password wajib diisi.');
  if (rows.some(r => String(r[2]).toLowerCase() === String(u.email).toLowerCase())) throw new Error('Email sudah digunakan.');
  const id = nextUserId_(rows);
  sheet.appendRow([id,u.nama,u.email,u.noHp || '',u.role || 'Admin RT',u.wilayah || 'RW026',u.status || 'Aktif',hashPassword_(u.password),'',formatDate_(new Date())]);
  return json_({ok:true, message:'Pengguna berhasil ditambahkan.', userId:id});
}

function updateUser_(body) {
  requireAdmin_(body.token);
  const u = body.user || {}, found = findUserRow_(u.userId), sheet = getSheet_();
  if (!found) throw new Error('Pengguna tidak ditemukan.');
  const current = found.values;
  const passwordHash = u.password ? hashPassword_(u.password) : current[7];
  sheet.getRange(found.row,1,1,10).setValues([[current[0],u.nama || current[1],u.email || current[2],u.noHp || '',u.role || current[4],u.wilayah || current[5],u.status || current[6],passwordHash,current[8],current[9]]]);
  return json_({ok:true, message:'Data pengguna diperbarui.'});
}

function toggleUser_(body) {
  const actor = requireAdmin_(body.token);
  if (actor.userId === body.userId) throw new Error('Anda tidak dapat menonaktifkan akun sendiri.');
  const found = findUserRow_(body.userId); if (!found) throw new Error('Pengguna tidak ditemukan.');
  const status = String(found.values[6]).toLowerCase() === 'aktif' ? 'Nonaktif' : 'Aktif';
  getSheet_().getRange(found.row,7).setValue(status);
  return json_({ok:true, status:status});
}

function deleteUser_(body) {
  const actor = requireAdmin_(body.token);
  if (actor.userId === body.userId) throw new Error('Anda tidak dapat menghapus akun sendiri.');
  const found = findUserRow_(body.userId); if (!found) throw new Error('Pengguna tidak ditemukan.');
  getSheet_().deleteRow(found.row);
  return json_({ok:true, message:'Pengguna berhasil dihapus.'});
}

function listHimbauan_(body) {
  requireSession_(body.token);
  return json_({ok:true, himbauan:getHimbauanRows_().map(himbauanRowToObject_)});
}

function createHimbauan_(body) {
  requireAdmin_(body.token);
  const item = body.himbauan || {};
  if (!item.judul || !item.kategori || !item.fileName || !item.dataUrl) throw new Error('Judul, kategori, dan gambar wajib diisi.');
  const match = String(item.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Format file gambar tidak valid.');
  const allowed = ['image/svg+xml','image/png','image/jpeg','image/webp','image/gif'];
  if (allowed.indexOf(match[1]) < 0) throw new Error('Gunakan file SVG, PNG, JPG, WebP, atau GIF.');
  const folder = DriveApp.getFolderById(HIMBAUAN_DRIVE_FOLDER_ID);
  const safeName = sanitizeFileName_(item.fileName);
  const blob = Utilities.newBlob(Utilities.base64Decode(match[2]), match[1], safeName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const rows = getHimbauanRows_().map(r => r.values);
  const id = nextHimbauanId_(rows);
  const driveUrl = 'https://drive.google.com/file/d/' + file.getId() + '/view?usp=drive_link';
  getHimbauanSheet_().appendRow([id,item.judul,item.kategori,'=HYPERLINK("' + driveUrl + '","' + String(item.judul).replace(/"/g,'""') + '")',item.status || 'Aktif']);
  return json_({ok:true, message:'Himbauan berhasil disimpan.', id:id});
}

function toggleHimbauan_(body) {
  requireAdmin_(body.token);
  const found = findHimbauanRow_(body.id); if (!found) throw new Error('Data himbauan tidak ditemukan.');
  const status = String(found.values[4]).toLowerCase() === 'aktif' ? 'Nonaktif' : 'Aktif';
  getHimbauanSheet_().getRange(found.row,5).setValue(status);
  return json_({ok:true, status:status});
}

function deleteHimbauan_(body) {
  requireAdmin_(body.token);
  const found = findHimbauanRow_(body.id); if (!found) throw new Error('Data himbauan tidak ditemukan.');
  const object = himbauanRowToObject_(found);
  if (object.fileId) DriveApp.getFileById(object.fileId).setTrashed(true);
  getHimbauanSheet_().deleteRow(found.row);
  return json_({ok:true, message:'Himbauan berhasil dihapus.'});
}

function requireSession_(token) {
  const raw = CacheService.getScriptCache().get('session_' + String(token || ''));
  if (!raw) throw new Error('Sesi berakhir. Silakan login kembali.');
  return JSON.parse(raw);
}

function requireAdmin_(token) {
  const user = requireSession_(token);
  if (!['Super Admin','Admin RW'].includes(user.role)) throw new Error('Anda tidak memiliki akses untuk tindakan ini.');
  return user;
}

function getSheet_() {
  const ss = SpreadsheetApp.openById(USER_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(USER_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(USER_SHEET_NAME);
  return sheet;
}
function getHimbauanSheet_() { const ss=SpreadsheetApp.openById(HIMBAUAN_SPREADSHEET_ID); let sheet=ss.getSheetByName(HIMBAUAN_SHEET_NAME); if(!sheet) sheet=ss.insertSheet(HIMBAUAN_SHEET_NAME); return sheet; }
function getRows_(sheet) { return sheet.getLastRow() < 2 ? [] : sheet.getRange(2,1,sheet.getLastRow()-1,10).getDisplayValues().filter(r => r[0]); }
function findUserRow_(id) { const rows=getRows_(getSheet_()), index=rows.findIndex(r=>String(r[0])===String(id)); return index<0?null:{row:index+2,values:rows[index]}; }
function rowToUser_(r) { return {userId:r[0],nama:r[1],email:r[2],noHp:r[3],role:r[4],wilayah:r[5],status:r[6],loginTerakhir:r[8] || '-',tanggalDibuat:r[9] || '-'}; }
function nextUserId_(rows) { const max=rows.reduce((m,r)=>Math.max(m,parseInt(String(r[0]).replace(/\D/g,''),10)||0),-1); return 'RW-' + String(max+1).padStart(4,'0'); }
function getHimbauanRows_() { const sheet=getHimbauanSheet_(), last=sheet.getLastRow(); if(last<2)return []; const values=sheet.getRange(2,1,last-1,5).getDisplayValues(); const formulas=sheet.getRange(2,1,last-1,5).getFormulas(); return values.map((v,i)=>({row:i+2,values:v,formulas:formulas[i]})).filter(r=>r.values[0]); }
function findHimbauanRow_(id) { const rows=getHimbauanRows_(), index=rows.findIndex(r=>String(r.values[0])===String(id)); return index<0?null:rows[index]; }
function himbauanRowToObject_(row) { const v=row.values, formula=row.formulas ? row.formulas[3] : ''; const url=extractUrl_(formula || v[3]); const fileId=extractFileId_(url); return {id:v[0],judul:v[1],kategori:v[2],gambar:v[3],status:v[4],driveUrl:url,imageUrl:fileId?'https://drive.google.com/uc?export=view&id='+fileId:url,fileId:fileId}; }
function nextHimbauanId_(rows) { const max=rows.reduce((m,r)=>Math.max(m,parseInt(String(r[0]).replace(/\D/g,''),10)||0),0); return String(max+1); }
function extractUrl_(value) { const text=String(value || ''); const formula=text.match(/HYPERLINK\("([^"]+)"/i); if(formula)return formula[1]; const url=text.match(/https?:\/\/[^",\s)]+/); return url?url[0]:text; }
function extractFileId_(url) { const text=String(url || ''); const byPath=text.match(/\/d\/([a-zA-Z0-9_-]+)/); if(byPath)return byPath[1]; const byId=text.match(/[?&]id=([a-zA-Z0-9_-]+)/); return byId?byId[1]:''; }
function sanitizeFileName_(name) { return String(name || 'himbauan.svg').replace(/[\\/:*?"<>|]/g,'-').slice(0,120); }
function hashPassword_(password) { const digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(password),Utilities.Charset.UTF_8); return digest.map(b=>(b+256)%256).map(b=>('0'+b.toString(16)).slice(-2)).join(''); }
function formatDate_(date) { return Utilities.formatDate(date,Session.getScriptTimeZone() || 'Asia/Jakarta','dd/MM/yyyy HH:mm'); }
function json_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
