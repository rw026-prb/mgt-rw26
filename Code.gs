/**
 * Backend Google Apps Script - Portal RW 26
 * Tempel file ini pada Extensions > Apps Script, lalu deploy ulang sebagai Web App.
 */
const USER_SPREADSHEET_ID = '1MYvidwDFe65xCsZz9AP2zAGpv3SHXE9QRxulqULXxGY';
const USER_SHEET_NAME = 'user';
const HIMBAUAN_SPREADSHEET_ID = '1CnjK2IQ2bAAIMuQ3C8liNDsz9RP3gy1Ls_Ud6Y9zqdE';
const HIMBAUAN_SHEET_NAME = 'himbauan';
const HIMBAUAN_DRIVE_FOLDER_ID = '1ypF7zjtpk86ZAWktMQ9BM3mhtLLls-9y';
const INFO_SPREADSHEET_ID = '15qG8a0brYTc0KjeMof077LcT0rfIxQ9TFRmAkzcpEJs';
const FASUM_SPREADSHEET_ID = '1omrKdc4ozp066NqijEOB5gmp0u7U8hIB-0Fb_ccKmJY';
const ORG_SPREADSHEET_ID = '1gkMOBSVkBPuLFphl9yggbmWo7uzGcV7QIamwgnBB9X8';
const NEWS_DRIVE_FOLDER_ID = '1322RJTLHdwdXBDyHETVjRXvDBYF-kyIg';
const FASUM_DRIVE_FOLDER_ID = '1lvcZNiAppoztO-J7DL-5qQ8eZBrSya87';
const ORG_DRIVE_FOLDER_ID = '1Tv1y6isGdVpOKdljEPpDexMOW82aWIOI';
const INFO_SHEET_NAME = 'informasi';
const NEWS_SHEET_NAME = 'berita';
const FASUM_SHEET_NAME = 'fasum';
const ORG_SHEET_NAMES = ['rw','bank-sampah','pokmas'];
const HEADERS = ['User ID','Nama Lengkap','Email','No HP','Role ID','Wilayah ID','Status','Password Hash','Login Terakhir','Tanggal Dibuat'];
const HIMBAUAN_HEADERS = ['ID','JUDUL','KATEGORI','GAMBAR','STATUS'];
const INFO_HEADERS = ['ID','Judul','Kategori','Ringkasan','Tanggal','Status'];
const NEWS_HEADERS = ['ID','Judul','Kategory','Isi','Tanggal','Foto','Status'];
const FASUM_HEADERS = ['ID','NAMA','DESKRIPSI','FOTO','MAPS lokasi'];
const ORG_HEADERS = ['ID','JABATAN','NAMA','FOTO'];
const SESSION_SECONDS = 1800;

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
      case 'listAnnouncements': return listAnnouncements_(body);
      case 'createAnnouncement': return createAnnouncement_(body);
      case 'updateAnnouncement': return updateAnnouncement_(body);
      case 'toggleAnnouncement': return toggleAnnouncement_(body);
      case 'deleteAnnouncement': return deleteAnnouncement_(body);
      case 'listNews': return listNews_(body);
      case 'createNews': return createNews_(body);
      case 'updateNews': return updateNews_(body);
      case 'toggleNews': return toggleNews_(body);
      case 'deleteNews': return deleteNews_(body);
      case 'listFacilities': return listFacilities_(body);
      case 'createFacility': return createFacility_(body);
      case 'updateFacility': return updateFacility_(body);
      case 'deleteFacility': return deleteFacility_(body);
      case 'listOrganization': return listOrganization_(body);
      case 'createOrgMember': return createOrgMember_(body);
      case 'updateOrgMember': return updateOrgMember_(body);
      case 'deleteOrgMember': return deleteOrgMember_(body);
      default: throw new Error('Aksi API tidak dikenal.');
    }
  } catch (err) {
    return json_({ok:false, message:err.message || 'Terjadi kesalahan server.'});
  }
}

function setupSheet() {
  const sheet = getSheet_();
  ensureHeader_(sheet, HEADERS);
}

function setupHimbauanSheet() {
  const sheet = getHimbauanSheet_();
  ensureHeader_(sheet, HIMBAUAN_HEADERS);
}

function setupPortalSheets() {
  ensureHeader_(getInfoSheet_(), INFO_HEADERS);
  ensureHeader_(getNewsSheet_(), NEWS_HEADERS);
  ensureHeader_(getFacilitySheet_(), FASUM_HEADERS);
  ORG_SHEET_NAMES.forEach(name => ensureHeader_(getOrgSheet_(name), ORG_HEADERS));
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
  const id = nextId_(rows, '');
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

function listAnnouncements_(body) {
  requireSession_(body.token);
  return json_({ok:true, announcements:getTableRows_(getInfoSheet_(), 6).map(announcementRowToObject_)});
}

function createAnnouncement_(body) {
  requireAdmin_(body.token);
  const item = body.announcement || {};
  if (!item.judul || !item.kategori || !item.ringkasan) throw new Error('Judul, kategori, dan ringkasan wajib diisi.');
  const sheet = getInfoSheet_();
  const id = nextId_(getTableRows_(sheet, 6).map(r => r.values), 'INF-');
  sheet.appendRow([id,item.judul,item.kategori,item.ringkasan,item.tanggal || today_(),item.status || 'Aktif']);
  return json_({ok:true, id:id});
}

function updateAnnouncement_(body) {
  requireAdmin_(body.token);
  const item = body.announcement || {}, found = findTableRow_(getInfoSheet_(), item.id, 6);
  if (!found) throw new Error('Pengumuman tidak ditemukan.');
  getInfoSheet_().getRange(found.row,1,1,6).setValues([[found.values[0],item.judul,item.kategori,item.ringkasan,item.tanggal,item.status]]);
  return json_({ok:true});
}

function toggleAnnouncement_(body) {
  requireAdmin_(body.token);
  const found = findTableRow_(getInfoSheet_(), body.id, 6);
  if (!found) throw new Error('Pengumuman tidak ditemukan.');
  const status = String(found.values[5]).toLowerCase() === 'aktif' ? 'Nonaktif' : 'Aktif';
  getInfoSheet_().getRange(found.row,6).setValue(status);
  return json_({ok:true, status:status});
}

function deleteAnnouncement_(body) {
  requireAdmin_(body.token);
  const found = findTableRow_(getInfoSheet_(), body.id, 6);
  if (!found) throw new Error('Pengumuman tidak ditemukan.');
  getInfoSheet_().deleteRow(found.row);
  return json_({ok:true});
}

function listNews_(body) {
  requireSession_(body.token);
  return json_({ok:true, news:getTableRows_(getNewsSheet_(), 7).map(newsRowToObject_)});
}

function createNews_(body) {
  requireAdmin_(body.token);
  const item = body.news || {};
  if (!item.judul || !item.category || !item.isi) throw new Error('Judul, kategori, dan isi berita wajib diisi.');
  const sheet = getNewsSheet_();
  const id = nextId_(getTableRows_(sheet, 7).map(r => r.values), 'BRT-');
  const foto = saveDriveImage_(item, NEWS_DRIVE_FOLDER_ID, item.judul);
  sheet.appendRow([id,item.judul,item.category,item.isi,item.tanggal || today_(),foto,item.status || 'Aktif']);
  return json_({ok:true, id:id});
}

function updateNews_(body) {
  requireAdmin_(body.token);
  const item = body.news || {}, found = findTableRow_(getNewsSheet_(), item.id, 7);
  if (!found) throw new Error('Berita tidak ditemukan.');
  const foto = saveDriveImage_(item, NEWS_DRIVE_FOLDER_ID, item.judul) || item.foto || found.values[5] || '';
  getNewsSheet_().getRange(found.row,1,1,7).setValues([[found.values[0],item.judul,item.category,item.isi,item.tanggal,foto,item.status]]);
  return json_({ok:true});
}

function toggleNews_(body) {
  requireAdmin_(body.token);
  const found = findTableRow_(getNewsSheet_(), body.id, 7);
  if (!found) throw new Error('Berita tidak ditemukan.');
  const status = String(found.values[6]).toLowerCase() === 'aktif' ? 'Nonaktif' : 'Aktif';
  getNewsSheet_().getRange(found.row,7).setValue(status);
  return json_({ok:true, status:status});
}

function deleteNews_(body) {
  requireAdmin_(body.token);
  const found = findTableRow_(getNewsSheet_(), body.id, 7);
  if (!found) throw new Error('Berita tidak ditemukan.');
  getNewsSheet_().deleteRow(found.row);
  return json_({ok:true});
}

function listFacilities_(body) {
  requireSession_(body.token);
  return json_({ok:true, facilities:getTableRows_(getFacilitySheet_(), 5).map(facilityRowToObject_)});
}

function createFacility_(body) {
  requireAdmin_(body.token);
  const item = body.facility || {};
  if (!item.nama || !item.deskripsi) throw new Error('Nama dan deskripsi fasilitas wajib diisi.');
  const sheet = getFacilitySheet_();
  const id = nextId_(getTableRows_(sheet, 5).map(r => r.values), 'FAS-');
  const foto = saveDriveImage_(item, FASUM_DRIVE_FOLDER_ID, item.nama);
  sheet.appendRow([id,item.nama,item.deskripsi,foto,item.maps || '']);
  return json_({ok:true, id:id});
}

function updateFacility_(body) {
  requireAdmin_(body.token);
  const item = body.facility || {}, found = findTableRow_(getFacilitySheet_(), item.id, 5);
  if (!found) throw new Error('Fasilitas tidak ditemukan.');
  const foto = saveDriveImage_(item, FASUM_DRIVE_FOLDER_ID, item.nama) || item.foto || found.values[3] || '';
  getFacilitySheet_().getRange(found.row,1,1,5).setValues([[found.values[0],item.nama,item.deskripsi,foto,item.maps || '']]);
  return json_({ok:true});
}

function deleteFacility_(body) {
  requireAdmin_(body.token);
  const found = findTableRow_(getFacilitySheet_(), body.id, 5);
  if (!found) throw new Error('Fasilitas tidak ditemukan.');
  getFacilitySheet_().deleteRow(found.row);
  return json_({ok:true});
}

function listOrganization_(body) {
  requireSession_(body.token);
  const groups = {};
  ORG_SHEET_NAMES.forEach(name => groups[name] = getTableRows_(getOrgSheet_(name), 4).map(r => orgRowToObject_(name, r)));
  return json_({ok:true, organization:groups});
}

function createOrgMember_(body) {
  requireAdmin_(body.token);
  const item = body.member || {}, group = validateOrgGroup_(item.group);
  if (!item.jabatan || !item.nama) throw new Error('Jabatan dan nama pengurus wajib diisi.');
  const sheet = getOrgSheet_(group);
  const id = nextId_(getTableRows_(sheet, 4).map(r => r.values), 'ORG-');
  const foto = saveDriveImage_(item, ORG_DRIVE_FOLDER_ID, item.nama);
  sheet.appendRow([id,item.jabatan,item.nama,foto]);
  return json_({ok:true, id:id});
}

function updateOrgMember_(body) {
  requireAdmin_(body.token);
  const item = body.member || {}, group = validateOrgGroup_(item.group), found = findTableRow_(getOrgSheet_(group), item.id, 4);
  if (!found) throw new Error('Data pengurus tidak ditemukan.');
  const foto = saveDriveImage_(item, ORG_DRIVE_FOLDER_ID, item.nama) || item.foto || found.values[3] || '';
  getOrgSheet_(group).getRange(found.row,1,1,4).setValues([[found.values[0],item.jabatan,item.nama,foto]]);
  return json_({ok:true});
}

function deleteOrgMember_(body) {
  requireAdmin_(body.token);
  const group = validateOrgGroup_(body.group), found = findTableRow_(getOrgSheet_(group), body.id, 4);
  if (!found) throw new Error('Data pengurus tidak ditemukan.');
  getOrgSheet_(group).deleteRow(found.row);
  return json_({ok:true});
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

function getSheet_() { return openSheet_(USER_SPREADSHEET_ID, USER_SHEET_NAME); }
function getHimbauanSheet_() { return openSheet_(HIMBAUAN_SPREADSHEET_ID, HIMBAUAN_SHEET_NAME); }
function getInfoSheet_() { return openSheet_(INFO_SPREADSHEET_ID, INFO_SHEET_NAME); }
function getNewsSheet_() { return openSheet_(INFO_SPREADSHEET_ID, NEWS_SHEET_NAME); }
function getFacilitySheet_() { return openSheet_(FASUM_SPREADSHEET_ID, FASUM_SHEET_NAME); }
function getOrgSheet_(name) { return openSheet_(ORG_SPREADSHEET_ID, name); }
function openSheet_(spreadsheetId, sheetName) { const ss=SpreadsheetApp.openById(spreadsheetId); let sheet=ss.getSheetByName(sheetName); if(!sheet) sheet=ss.insertSheet(sheetName); return sheet; }
function ensureHeader_(sheet, headers) { if (sheet.getLastRow() === 0) sheet.getRange(1,1,1,headers.length).setValues([headers]); sheet.setFrozenRows(1); sheet.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#d9ead3'); sheet.autoResizeColumns(1,headers.length); }
function getRows_(sheet) { return sheet.getLastRow() < 2 ? [] : sheet.getRange(2,1,sheet.getLastRow()-1,10).getDisplayValues().filter(r => r[0]); }
function findUserRow_(id) { const rows=getRows_(getSheet_()), index=rows.findIndex(r=>String(r[0])===String(id)); return index<0?null:{row:index+2,values:rows[index]}; }
function rowToUser_(r) { return {userId:r[0],nama:r[1],email:r[2],noHp:r[3],role:r[4],wilayah:r[5],status:r[6],loginTerakhir:r[8] || '-',tanggalDibuat:r[9] || '-'}; }
function nextUserId_(rows) { const max=rows.reduce((m,r)=>Math.max(m,parseInt(String(r[0]).replace(/\D/g,''),10)||0),-1); return 'RW-' + String(max+1).padStart(4,'0'); }
function getHimbauanRows_() { const sheet=getHimbauanSheet_(), last=sheet.getLastRow(); if(last<2)return []; const values=sheet.getRange(2,1,last-1,5).getDisplayValues(); const formulas=sheet.getRange(2,1,last-1,5).getFormulas(); return values.map((v,i)=>({row:i+2,values:v,formulas:formulas[i]})).filter(r=>r.values[0]); }
function findHimbauanRow_(id) { const rows=getHimbauanRows_(), index=rows.findIndex(r=>String(r.values[0])===String(id)); return index<0?null:rows[index]; }
function himbauanRowToObject_(row) { const v=row.values, formula=row.formulas ? row.formulas[3] : ''; const url=extractUrl_(formula || v[3]); const fileId=extractFileId_(url); return {id:v[0],judul:v[1],kategori:v[2],gambar:v[3],status:v[4],driveUrl:url,imageUrl:fileId?'https://drive.google.com/uc?export=view&id='+fileId:url,fileId:fileId}; }
function getTableRows_(sheet, width) { const last=sheet.getLastRow(); if(last<2)return []; const range=sheet.getRange(2,1,last-1,width); const values=range.getDisplayValues(); const formulas=range.getFormulas(); return values.map((v,i)=>({row:i+2,values:v,formulas:formulas[i]})).filter(r=>r.values[0]); }
function findTableRow_(sheet, id, width) { const rows=getTableRows_(sheet, width), index=rows.findIndex(r=>String(r.values[0])===String(id)); return index<0?null:rows[index]; }
function announcementRowToObject_(row) { const v=row.values; return {id:v[0],judul:v[1],kategori:v[2],ringkasan:v[3],tanggal:v[4],status:v[5]}; }
function newsRowToObject_(row) { const v=row.values, foto=extractUrl_((row.formulas && row.formulas[5]) || v[5]); const fileId=extractFileId_(foto); return {id:v[0],judul:v[1],category:v[2],isi:v[3],tanggal:v[4],foto:foto,imageUrl:fileId?'https://drive.google.com/thumbnail?id='+fileId+'&sz=w1200':foto,fileId:fileId,status:v[6]}; }
function facilityRowToObject_(row) { const v=row.values, foto=extractUrl_((row.formulas && row.formulas[3]) || v[3]); const fileId=extractFileId_(foto); return {id:v[0],nama:v[1],deskripsi:v[2],foto:foto,imageUrl:fileId?'https://drive.google.com/thumbnail?id='+fileId+'&sz=w1200':foto,fileId:fileId,maps:v[4]}; }
function orgRowToObject_(group, row) { const v=row.values, foto=extractUrl_((row.formulas && row.formulas[3]) || v[3]); const fileId=extractFileId_(foto); return {group:group,id:v[0],jabatan:v[1],nama:v[2],foto:foto,imageUrl:fileId?'https://drive.google.com/thumbnail?id='+fileId+'&sz=w800':foto,fileId:fileId}; }
function validateOrgGroup_(group) { const value=String(group || 'rw'); if (ORG_SHEET_NAMES.indexOf(value) < 0) throw new Error('Jenis struktur organisasi tidak valid.'); return value; }
function nextId_(rows, prefix) { const max=rows.reduce((m,r)=>Math.max(m,parseInt(String(r[0]).replace(/\D/g,''),10)||0),0); return prefix + String(max+1).padStart(prefix ? 3 : 1, '0'); }
function saveDriveImage_(item, folderId, label) { if (!item.dataUrl) return ''; const match=String(item.dataUrl).match(/^data:([^;]+);base64,(.+)$/); if(!match) throw new Error('Format file gambar tidak valid.'); const allowed=['image/svg+xml','image/png','image/jpeg','image/webp','image/gif']; if(allowed.indexOf(match[1])<0) throw new Error('Gunakan file SVG, PNG, JPG, WebP, atau GIF.'); const safeName=sanitizeFileName_(item.fileName || label || 'foto'); const blob=Utilities.newBlob(Utilities.base64Decode(match[2]),match[1],safeName); const file=DriveApp.getFolderById(folderId).createFile(blob); file.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW); const driveUrl='https://drive.google.com/file/d/'+file.getId()+'/view?usp=drive_link'; return '=HYPERLINK("' + driveUrl + '","' + String(label || safeName).replace(/"/g,'""') + '")'; }
function extractUrl_(value) { const text=String(value || ''); const formula=text.match(/HYPERLINK\("([^"]+)"/i); if(formula)return formula[1]; const url=text.match(/https?:\/\/[^",\s)]+/); return url?url[0]:text; }
function extractFileId_(url) { const text=String(url || ''); const byPath=text.match(/\/d\/([a-zA-Z0-9_-]+)/); if(byPath)return byPath[1]; const byId=text.match(/[?&]id=([a-zA-Z0-9_-]+)/); return byId?byId[1]:''; }
function sanitizeFileName_(name) { return String(name || 'himbauan.svg').replace(/[\\/:*?"<>|]/g,'-').slice(0,120); }
function hashPassword_(password) { const digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(password),Utilities.Charset.UTF_8); return digest.map(b=>(b+256)%256).map(b=>('0'+b.toString(16)).slice(-2)).join(''); }
function today_() { return Utilities.formatDate(new Date(),Session.getScriptTimeZone() || 'Asia/Jakarta','dd/MM/yyyy'); }
function formatDate_(date) { return Utilities.formatDate(date,Session.getScriptTimeZone() || 'Asia/Jakarta','dd/MM/yyyy HH:mm'); }
function json_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
