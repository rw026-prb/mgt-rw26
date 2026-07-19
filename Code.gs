/**
 * Backend Google Apps Script - Portal RW 26
 * Tempel file ini pada Extensions > Apps Script, lalu deploy ulang sebagai Web App.
 */
const USER_SPREADSHEET_ID = '1MYvidwDFe65xCsZz9AP2zAGpv3SHXE9QRxulqULXxGY';
const USER_SHEET_NAME = 'user';
const KAS_SPREADSHEET_ID = '1Vq4movo3TW_A8rB0yy4unuwAQm0lAPerJaOMWe2vTuU';
const KAS_SHEET_NAME = 'rincian detail';
const KAS_DRIVE_FOLDER_ID = '1YDiyLsylMsbUBzOC85RUL5zkqsOOGz6C';
const HIMBAUAN_SPREADSHEET_ID = '1CnjK2IQ2bAAIMuQ3C8liNDsz9RP3gy1Ls_Ud6Y9zqdE';
const HIMBAUAN_SHEET_NAME = 'himbauan';
const HIMBAUAN_DRIVE_FOLDER_ID = '1ypF7zjtpk86ZAWktMQ9BM3mhtLLls-9y';
const INFO_SPREADSHEET_ID = '15qG8a0brYTc0KjeMof077LcT0rfIxQ9TFRmAkzcpEJs';
const FASUM_SPREADSHEET_ID = '1omrKdc4ozp066NqijEOB5gmp0u7U8hIB-0Fb_ccKmJY';
const ORG_SPREADSHEET_ID = '1gkMOBSVkBPuLFphl9yggbmWo7uzGcV7QIamwgnBB9X8';
const NEWS_DRIVE_FOLDER_ID = '1322RJTLHdwdXBDyHETVjRXvDBYF-kyIg';
const FASUM_DRIVE_FOLDER_ID = '1lvcZNiAppoztO-J7DL-5qQ8eZBrSya87';
const ORG_DRIVE_FOLDER_ID = '1Tv1y6isGdVpOKdljEPpDexMOW82aWIOI';
const GALLERY_SPREADSHEET_ID = '1oLjA8Ak_dyQ1d6bjnNf4xKrxaLqgd8fk7LYux0UDKUY';
const GALLERY_SHEET_NAME = 'album';
const GALLERY_DRIVE_FOLDER_ID = '18AbNqUjBBgaS4acBKh7_zbB9SqC8bqMO';
const STATISTIK_SHEET_NAME = 'statistik_warga';
const STATISTIK_HEADERS = ['ID','Nama Kategori','Nilai','Keterangan','Terakhir Diperbarui'];
const ACTIVITY_LOG_SHEET_NAME = 'activity_log';
const ACTIVITY_LOG_HEADERS = ['Timestamp','Actor','Role','Action','Module','Description'];
const INFO_SHEET_NAME = 'informasi';
const NEWS_SHEET_NAME = 'berita';
const FASUM_SHEET_NAME = 'fasum';
const ORG_SHEET_NAMES = ['rw','posyandu','pkk','bank-sampah','pokmas'];
const HEADERS = ['User ID','Nama Lengkap','Email','No HP','Role ID','Wilayah ID','Status','Password Hash','Login Terakhir','Tanggal Dibuat','Menu Akses'];
const HIMBAUAN_HEADERS = ['ID','JUDUL','KATEGORI','GAMBAR','STATUS'];
const INFO_HEADERS = ['ID','Judul','Kategori','Ringkasan','Tanggal','Status'];
const NEWS_HEADERS = ['ID','Judul','Kategory','Isi','Tanggal','Foto','Status'];
const FASUM_HEADERS = ['ID','NAMA','DESKRIPSI','FOTO','MAPS lokasi'];
const ORG_HEADERS = ['ID','JABATAN','NAMA','FOTO'];
const GALLERY_HEADERS = ['ID','Nama Album','Deskripsi','Folder ID','Tanggal','Status'];
const SESSION_SECONDS = 1800;

function doGet(e) {
  try {
    // Tangkap parameter 'action' dari URL
    const action = e && e.parameter && e.parameter.action;
    
    // Jika action adalah publicContent, kirimkan data portal
    if (action === 'publicContent') {
      return publicContent_();
    }
    if (action === 'publicKasReport') {
      return publicKasReport_(e.parameter);
    }
    
    // Fallback jika tidak ada parameter
    return json_({ok:true, service:'Portal RW 26 API', time:formatDate_(new Date())});
  } catch (err) {
    return json_({ok:false, message:err.message || 'Terjadi kesalahan server.'});
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    switch (body.action) {
      case 'login': return login_(body);
      case 'logout': return logout_(body);
      case 'publicContent': return publicContent_();
      case 'publicKasReport': return publicKasReport_(body);
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
      case 'listKas': return listKas_(body);
      case 'createKas': return createKas_(body);
      case 'updateKas': return updateKas_(body);
      case 'deleteKas': return deleteKas_(body);
      case 'approveKas': return approveKas_(body);
      case 'rejectKas': return rejectKas_(body);
      case 'getKasReport': return getKasReport_(body);
      case 'getKasDashboard': return getKasDashboard_(body);
      case 'getKasCashFlow': return getKasCashFlow_(body);
      case 'listStatistik': return listStatistik_(body);
      case 'createStatistik': return createStatistik_(body);
      case 'updateStatistik': return updateStatistik_(body);
      case 'deleteStatistik': return deleteStatistik_(body);
      case 'listActivity': return listActivity_(body);
      case 'listGalleryAlbums': return listGalleryAlbums_(body);
      case 'createGalleryAlbum': return createGalleryAlbum_(body);
      case 'deleteGalleryAlbum': return deleteGalleryAlbum_(body);
      case 'listGalleryPhotos': return listGalleryPhotos_(body);
      case 'uploadGalleryPhoto': return uploadGalleryPhoto_(body);
      case 'deleteGalleryPhoto': return deleteGalleryPhoto_(body);
      case 'updateMyProfile': return updateMyProfile_(body);
      case 'requestPasswordReset': return requestPasswordReset_(body);
      case 'validateResetToken': return validateResetToken_(body);
      case 'resetPassword': return resetPassword_(body);
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

function setupGallerySheet() {
  ensureHeader_(getGallerySheet_(), GALLERY_HEADERS);
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
  logActivity_(user, 'login', 'auth', user.nama + ' login ke portal');
  return json_({ok:true, token:token, user:user, expiresAt:Date.now() + SESSION_SECONDS * 1000});
}

function logout_(body) {
  if (body.token) CacheService.getScriptCache().remove('session_' + body.token);
  return json_({ok:true});
}

function publicContent_() {
  const organization = {};
  ORG_SHEET_NAMES.forEach(name => {
    organization[name] = getTableRows_(getOrgSheet_(name), 4).map(r => orgRowToObject_(name, r));
  });
  
  const gallery = getGalleryRows_()
    .map(galleryRowToObject_)
    .filter(isActive_)
    .map(album => {
      const photos = [];
      try {
        const folder = DriveApp.getFolderById(album.folderId);
        const files = folder.getFiles();
        while (files.hasNext()) {
          const f = files.next();
          if (f.getMimeType().startsWith('image/')) {
            photos.push({ fileId: f.getId(), name: f.getName() });
          }
        }
      } catch (e) {}
      return { nama: album.nama, deskripsi: album.deskripsi, photos: photos };
    })
    .filter(album => album.photos.length > 0);
  
  return json_({
    ok:true,
    himbauan:getHimbauanRows_().map(himbauanRowToObject_).filter(isActive_),
    announcements:getTableRows_(getInfoSheet_(), 6).map(announcementRowToObject_).filter(isActive_),
    news:getTableRows_(getNewsSheet_(), 7).map(newsRowToObject_).filter(isActive_),
    facilities:getTableRows_(getFacilitySheet_(), 5).map(facilityRowToObject_),
    organization:organization,
    gallery: gallery,
    statistik: getStatistikRows_().map(statistikRowToObject_)
  });
}

function publicKasReport_(params) {
  try {
    const now = new Date();
    const targetBulan = parseInt(params && params.bulan, 10);
    const targetTahun = parseInt(params && params.tahun, 10);
    const bulan = isNaN(targetBulan) ? now.getMonth() : targetBulan;
    const tahun = isNaN(targetTahun) ? now.getFullYear() : targetTahun;

    const sheet = getKasSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return json_({ ok: true, saldoAwal: 0, totalMasuk: 0, totalKeluar: 0, saldoAkhir: 0, rincianMasuk: [], rincianKeluar: [], updatedAt: new Date().toISOString() });
    }

    const data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
    let saldoAwal = 0, totalMasuk = 0, totalKeluar = 0;
    const rincianMasuk = [], rincianKeluar = [];

    let latestTimestamp = null;
    data.forEach(function (row) {
      const status = String(row[11] || 'Menunggu');
      if (status !== 'Disetujui') return;
      const ts = row[1];
      if (ts instanceof Date && !isNaN(ts) && (!latestTimestamp || ts > latestTimestamp)) latestTimestamp = ts;
      const tglRaw = row[2];
      if (!tglRaw) return;
      var d = null;
      if (tglRaw instanceof Date) { d = tglRaw; }
      else if (typeof tglRaw === 'string') {
        const parts = tglRaw.split('/');
        if (parts.length === 3) d = new Date(parts[2], parts[1] - 1, parts[0]);
      }
      if (d) {
        const m = d.getMonth(), y = d.getFullYear();
        const masuk = Number(row[6]) || 0, keluar = Number(row[7]) || 0;
        if (y < tahun || (y === tahun && m < bulan)) { saldoAwal += masuk - keluar; }
        else if (m === bulan && y === tahun) {
          const tglFormatted = Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM/yyyy');
          if (masuk > 0) { totalMasuk += masuk; rincianMasuk.push({ tanggal: tglFormatted, uraian: row[3], nominal: masuk }); }
          if (keluar > 0) { totalKeluar += keluar; rincianKeluar.push({ tanggal: tglFormatted, uraian: row[3], nominal: keluar }); }
        }
      }
    });

    const sortByDateAsc = (a, b) => {
      const p = s => { const pp = String(s).split('/'); return pp.length === 3 ? new Date(pp[2], pp[1]-1, pp[0]).getTime() : 0; };
      return p(a.tanggal) - p(b.tanggal);
    };
    rincianMasuk.sort(sortByDateAsc);
    rincianKeluar.sort(sortByDateAsc);
    const saldoAkhir = saldoAwal + totalMasuk - totalKeluar;
    const updatedAt = latestTimestamp || new Date();
    return json_({ ok: true, saldoAwal: saldoAwal, totalMasuk: totalMasuk, totalKeluar: totalKeluar, saldoAkhir: saldoAkhir, rincianMasuk: rincianMasuk, rincianKeluar: rincianKeluar, updatedAt: updatedAt.toISOString() });
  } catch (err) {
    return json_({ ok: false, message: err.toString() });
  }
}

function listUsers_(body) {
  requireAdmin_(body.token);
  return json_({ok:true, users:getRows_(getSheet_()).map(rowToUser_)});
}

function createUser_(body) {
  const actor = requireAdmin_(body.token);
  const u = body.user || {}, sheet = getSheet_(), rows = getRows_(sheet);
  if (!u.nama || !u.email || !u.password) throw new Error('Nama, email, dan password wajib diisi.');
  if (rows.some(r => String(r[2]).toLowerCase() === String(u.email).toLowerCase())) throw new Error('Email sudah digunakan.');
  if (actor.role !== 'Super Admin' && u.role === 'Super Admin') throw new Error('Hanya Super Admin yang dapat membuat akun Super Admin.');
  const id = nextUserId_(rows);
  const menuAkses = u.role === 'Editor' ? JSON.stringify(u.menuAkses || []) : '[]';
  sheet.appendRow([id,u.nama,u.email,u.noHp || '',u.role || 'Editor',u.wilayah || 'RW026',u.status || 'Aktif',hashPassword_(u.password),'',formatDate_(new Date()),menuAkses]);
  logActivity_(actor, 'create', 'users', 'Menambah pengguna ' + u.nama);
  return json_({ok:true, message:'Pengguna berhasil ditambahkan.', userId:id});
}

function updateUser_(body) {
  const actor = requireAdmin_(body.token);
  const u = body.user || {}, found = findUserRow_(u.userId), sheet = getSheet_();
  if (!found) throw new Error('Pengguna tidak ditemukan.');
  const current = found.values;
  if (actor.role !== 'Super Admin' && current[4] === 'Super Admin') throw new Error('Anda tidak memiliki izin untuk mengubah akun Super Admin.');
  if (actor.role !== 'Super Admin' && u.role === 'Super Admin') throw new Error('Hanya Super Admin yang dapat mengubah role ke Super Admin.');
  const passwordHash = u.password ? hashPassword_(u.password) : current[7];
  const menuAkses = u.role === 'Editor' ? JSON.stringify(u.menuAkses || JSON.parse(current[10] || '[]')) : (current[10] || '[]');
  sheet.getRange(found.row,1,1,11).setValues([[current[0],u.nama || current[1],u.email || current[2],u.noHp || '',u.role || current[4],u.wilayah || current[5],u.status || current[6],passwordHash,current[8],current[9],menuAkses]]);
  logActivity_(actor, 'update', 'users', 'Memperbarui pengguna ' + (u.nama || current[1]));
  return json_({ok:true, message:'Data pengguna diperbarui.'});
}

function toggleUser_(body) {
  const actor = requireAdmin_(body.token);
  if (actor.userId === body.userId) throw new Error('Anda tidak dapat menonaktifkan akun sendiri.');
  const found = findUserRow_(body.userId); if (!found) throw new Error('Pengguna tidak ditemukan.');
  if (actor.role !== 'Super Admin' && found.values[4] === 'Super Admin') throw new Error('Anda tidak memiliki izin untuk menonaktifkan Super Admin.');
  const status = String(found.values[6]).toLowerCase() === 'aktif' ? 'Nonaktif' : 'Aktif';
  getSheet_().getRange(found.row,7).setValue(status);
  logActivity_(actor, 'toggle', 'users', 'Mengubah status ' + found.values[1] + ' ke ' + status);
  return json_({ok:true, status:status});
}

function deleteUser_(body) {
  const actor = requireAdmin_(body.token);
  if (actor.userId === body.userId) throw new Error('Anda tidak dapat menghapus akun sendiri.');
  const found = findUserRow_(body.userId); if (!found) throw new Error('Pengguna tidak ditemukan.');
  if (actor.role !== 'Super Admin' && found.values[4] === 'Super Admin') throw new Error('Anda tidak memiliki izin untuk menghapus Super Admin.');
  getSheet_().deleteRow(found.row);
  logActivity_(actor, 'delete', 'users', 'Menghapus pengguna ' + found.values[1]);
  return json_({ok:true, message:'Pengguna berhasil dihapus.'});
}

function updateMyProfile_(body) {
  const user = requireSession_(body.token);
  const profile = body.profile || {};
  if (!profile.email) throw new Error('Email wajib diisi.');
  if (!profile.currentPassword) throw new Error('Password saat ini wajib diisi untuk keamanan.');
  const found = findUserRow_(user.userId);
  if (!found) throw new Error('Pengguna tidak ditemukan.');
  const current = found.values;
  const storedHash = String(current[7] || '');
  const currentHash = hashPassword_(profile.currentPassword);
  if (storedHash !== currentHash && storedHash !== profile.currentPassword) {
    throw new Error('Password saat ini salah.');
  }
  if (storedHash === profile.currentPassword) {
    getSheet_().getRange(found.row, 8).setValue(currentHash);
  }
  const rows = getRows_(getSheet_());
  const emailExists = rows.some(r => String(r[0]) !== user.userId && String(r[2]).toLowerCase() === String(profile.email).toLowerCase());
  if (emailExists) throw new Error('Email sudah digunakan oleh pengguna lain.');
  const newHash = profile.newPassword ? hashPassword_(profile.newPassword) : current[7];
  getSheet_().getRange(found.row, 3).setValue(profile.email);
  getSheet_().getRange(found.row, 4).setValue(profile.noHp || '');
  if (profile.newPassword) {
    if (profile.newPassword.length < 8) throw new Error('Password baru minimal 8 karakter.');
    if (profile.newPassword !== profile.confirmPassword) throw new Error('Konfirmasi password baru tidak cocok.');
    getSheet_().getRange(found.row, 8).setValue(newHash);
  }
  const updatedRow = getRows_(getSheet_()).find(r => String(r[0]) === user.userId);
  const updatedUser = updatedRow ? rowToUser_(updatedRow) : user;
  updatedUser.email = profile.email;
  updatedUser.noHp = profile.noHp || '';
  CacheService.getScriptCache().put('session_' + body.token, JSON.stringify(updatedUser), SESSION_SECONDS);
  logActivity_(user, 'update', 'profil', user.nama + ' memperbarui profil sendiri');
  return json_({ok: true, message: 'Profil berhasil diperbarui.', user: updatedUser});
}

function requestPasswordReset_(body) {
  const email = String(body.email || '').trim().toLowerCase();
  if (!email) throw new Error('Email wajib diisi.');
  const rows = getRows_(getSheet_());
  const userRow = rows.find(r => String(r[2]).toLowerCase() === email);
  if (!userRow) return json_({ok: true, message: 'Link reset password telah dikirim ke email Anda jika terdaftar.'});
  const userId = String(userRow[0]);
  const nama = String(userRow[1] || 'User');
  const token = Utilities.getUuid();
  const cacheData = JSON.stringify({userId: userId, email: email, nama: nama});
  CacheService.getScriptCache().put('reset_' + token, cacheData, 900);
  const siteUrl = String(body.siteUrl || '').replace(/\/+$/, '');
  const resetUrl = siteUrl + '/reset.html?token=' + token;
  const htmlBody = '<div style="font-family:DM Sans,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#f9fafb;border-radius:16px;border:1px solid #e5e7eb;">' +
    '<div style="text-align:center;margin-bottom:24px;"><div style="display:inline-block;width:48px;height:48px;border-radius:14px;background:#e9b949;color:#064b3b;font-size:1.3rem;line-height:48px;font-weight:700;">RW</div></div>' +
    '<h2 style="text-align:center;color:#1a1a1a;font-size:1.3rem;margin-bottom:8px;">Reset Password</h2>' +
    '<p style="text-align:center;color:#6b7280;font-size:0.9rem;margin-bottom:24px;">Halo <strong>' + nama + '</strong>, Anda meminta reset password untuk akun Portal RW 26.</p>' +
    '<div style="text-align:center;margin-bottom:24px;"><a href="' + resetUrl + '" style="display:inline-block;padding:14px 32px;background:#0a6c50;color:#fff;text-decoration:none;border-radius:12px;font-weight:700;font-size:0.95rem;">Buat Password Baru</a></div>' +
    '<p style="color:#6b7280;font-size:0.8rem;text-align:center;margin-bottom:8px;">Link ini berlaku selama <strong>15 menit</strong>.</p>' +
    '<p style="color:#9ca3af;font-size:0.78rem;text-align:center;border-top:1px solid #e5e7eb;padding-top:16px;margin-top:16px;">Jika Anda tidak meminta reset password, abaikan email ini. Password Anda tidak akan berubah.</p>' +
    '</div>';
  GmailApp.sendEmail(email, 'Reset Password - Portal RW 26', '', {htmlBody: htmlBody, name: 'Portal RW 26'});
  return json_({ok: true, message: 'Link reset password telah dikirim ke email Anda.'});
}

function validateResetToken_(body) {
  const token = String(body.token || '');
  if (!token) throw new Error('Token tidak valid.');
  const raw = CacheService.getScriptCache().get('reset_' + token);
  if (!raw) throw new Error('Token tidak valid atau sudah kedaluwarsa. Silakan minta link reset baru.');
  const data = JSON.parse(raw);
  return json_({ok: true, email: data.email, nama: data.nama});
}

function resetPassword_(body) {
  const token = String(body.token || '');
  const newPassword = String(body.newPassword || '');
  const confirmPassword = String(body.confirmPassword || '');
  if (!token) throw new Error('Token tidak valid.');
  if (!newPassword || newPassword.length < 8) throw new Error('Password baru minimal 8 karakter.');
  if (newPassword !== confirmPassword) throw new Error('Konfirmasi password baru tidak cocok.');
  const raw = CacheService.getScriptCache().get('reset_' + token);
  if (!raw) throw new Error('Token tidak valid atau sudah kedaluwarsa. Silakan minta link reset baru.');
  const data = JSON.parse(raw);
  const found = findUserRow_(data.userId);
  if (!found) throw new Error('Pengguna tidak ditemukan.');
  const newHash = hashPassword_(newPassword);
  const storedHash = String(found.values[7] || '');
  if (storedHash === newPassword) {
    getSheet_().getRange(found.row, 8).setValue(newHash);
  } else {
    getSheet_().getRange(found.row, 8).setValue(newHash);
  }
  CacheService.getScriptCache().remove('reset_' + token);
  logActivity_({userId: data.userId, nama: data.nama, role: found.values[4] || ''}, 'update', 'auth', data.nama + ' berhasil reset password');
  return json_({ok: true, message: 'Password berhasil diubah. Silakan login dengan password baru.'});
}

function listHimbauan_(body) {
  requireSession_(body.token);
  return json_({ok:true, himbauan:getHimbauanRows_().map(himbauanRowToObject_)});
}

function createHimbauan_(body) {
  requireMenuAccess_(body.token, 'himbauan');
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
  getHimbauanSheet_().appendRow([id,item.judul,item.kategori,'=HYPERLINK("' + driveUrl + '";"' + String(item.judul).replace(/"/g,'""') + '")',item.status || 'Aktif']);
  logActivity_(requireSession_(body.token), 'create', 'himbauan', 'Menambah himbauan "' + item.judul + '"');
  return json_({ok:true, message:'Himbauan berhasil disimpan.', id:id});
}

function toggleHimbauan_(body) {
  requireMenuAccess_(body.token, 'himbauan');
  const found = findHimbauanRow_(body.id); if (!found) throw new Error('Data himbauan tidak ditemukan.');
  const status = String(found.values[4]).toLowerCase() === 'aktif' ? 'Nonaktif' : 'Aktif';
  getHimbauanSheet_().getRange(found.row,5).setValue(status);
  logActivity_(requireSession_(body.token), 'toggle', 'himbauan', 'Mengubah status himbauan "' + found.values[1] + '" ke ' + status);
  return json_({ok:true, status:status});
}

function deleteHimbauan_(body) {
  requireMenuAccess_(body.token, 'himbauan');
  const found = findHimbauanRow_(body.id); if (!found) throw new Error('Data himbauan tidak ditemukan.');
  const object = himbauanRowToObject_(found);
  if (object.fileId) DriveApp.getFileById(object.fileId).setTrashed(true);
  getHimbauanSheet_().deleteRow(found.row);
  logActivity_(requireSession_(body.token), 'delete', 'himbauan', 'Menghapus himbauan "' + found.values[1] + '"');
  return json_({ok:true, message:'Himbauan berhasil dihapus.'});
}

function listAnnouncements_(body) {
  requireSession_(body.token);
  return json_({ok:true, announcements:getTableRows_(getInfoSheet_(), 6).map(announcementRowToObject_)});
}

function createAnnouncement_(body) {
  requireMenuAccess_(body.token, 'pengumuman');
  const item = body.announcement || {};
  if (!item.judul || !item.kategori || !item.ringkasan) throw new Error('Judul, kategori, dan ringkasan wajib diisi.');
  const sheet = getInfoSheet_();
  const id = nextId_(getTableRows_(sheet, 6).map(r => r.values), 'INF-');
  sheet.appendRow([id,item.judul,item.kategori,item.ringkasan,item.tanggal || today_(),item.status || 'Aktif']);
  logActivity_(requireSession_(body.token), 'create', 'pengumuman', 'Menambah pengumuman "' + item.judul + '"');
  return json_({ok:true, id:id});
}

function updateAnnouncement_(body) {
  requireMenuAccess_(body.token, 'pengumuman');
  const item = body.announcement || {}, found = findTableRow_(getInfoSheet_(), item.id, 6);
  if (!found) throw new Error('Pengumuman tidak ditemukan.');
  getInfoSheet_().getRange(found.row,1,1,6).setValues([[found.values[0],item.judul,item.kategori,item.ringkasan,item.tanggal,item.status]]);
  logActivity_(requireSession_(body.token), 'update', 'pengumuman', 'Memperbarui pengumuman "' + item.judul + '"');
  return json_({ok:true});
}

function toggleAnnouncement_(body) {
  requireMenuAccess_(body.token, 'pengumuman');
  const found = findTableRow_(getInfoSheet_(), body.id, 6);
  if (!found) throw new Error('Pengumuman tidak ditemukan.');
  const status = String(found.values[5]).toLowerCase() === 'aktif' ? 'Nonaktif' : 'Aktif';
  getInfoSheet_().getRange(found.row,6).setValue(status);
  logActivity_(requireSession_(body.token), 'toggle', 'pengumuman', 'Mengubah status pengumuman "' + found.values[1] + '" ke ' + status);
  return json_({ok:true, status:status});
}

function deleteAnnouncement_(body) {
  requireMenuAccess_(body.token, 'pengumuman');
  const found = findTableRow_(getInfoSheet_(), body.id, 6);
  if (!found) throw new Error('Pengumuman tidak ditemukan.');
  getInfoSheet_().deleteRow(found.row);
  logActivity_(requireSession_(body.token), 'delete', 'pengumuman', 'Menghapus pengumuman "' + found.values[1] + '"');
  return json_({ok:true});
}

function listNews_(body) {
  requireSession_(body.token);
  return json_({ok:true, news:getTableRows_(getNewsSheet_(), 7).map(newsRowToObject_)});
}

function createNews_(body) {
  requireMenuAccess_(body.token, 'berita');
  const item = body.news || {};
  if (!item.judul || !item.category || !item.isi) throw new Error('Judul, kategori, dan isi berita wajib diisi.');
  const sheet = getNewsSheet_();
  const id = nextId_(getTableRows_(sheet, 7).map(r => r.values), 'BRT-');
  const foto = saveDriveImage_(item, NEWS_DRIVE_FOLDER_ID, item.judul);
  sheet.appendRow([id,item.judul,item.category,item.isi,item.tanggal || today_(),foto,item.status || 'Aktif']);
  logActivity_(requireSession_(body.token), 'create', 'berita', 'Menambah berita "' + item.judul + '"');
  return json_({ok:true, id:id});
}

function updateNews_(body) {
  requireMenuAccess_(body.token, 'berita');
  const item = body.news || {}, found = findTableRow_(getNewsSheet_(), item.id, 7);
  if (!found) throw new Error('Berita tidak ditemukan.');
  const foto = saveDriveImage_(item, NEWS_DRIVE_FOLDER_ID, item.judul) || item.foto || found.values[5] || '';
  getNewsSheet_().getRange(found.row,1,1,7).setValues([[found.values[0],item.judul,item.category,item.isi,item.tanggal,foto,item.status]]);
  logActivity_(requireSession_(body.token), 'update', 'berita', 'Memperbarui berita "' + item.judul + '"');
  return json_({ok:true});
}

function toggleNews_(body) {
  requireMenuAccess_(body.token, 'berita');
  const found = findTableRow_(getNewsSheet_(), body.id, 7);
  if (!found) throw new Error('Berita tidak ditemukan.');
  const status = String(found.values[6]).toLowerCase() === 'aktif' ? 'Nonaktif' : 'Aktif';
  getNewsSheet_().getRange(found.row,7).setValue(status);
  logActivity_(requireSession_(body.token), 'toggle', 'berita', 'Mengubah status berita "' + found.values[1] + '" ke ' + status);
  return json_({ok:true, status:status});
}

function deleteNews_(body) {
  requireMenuAccess_(body.token, 'berita');
  const found = findTableRow_(getNewsSheet_(), body.id, 7);
  if (!found) throw new Error('Berita tidak ditemukan.');
  getNewsSheet_().deleteRow(found.row);
  logActivity_(requireSession_(body.token), 'delete', 'berita', 'Menghapus berita "' + found.values[1] + '"');
  return json_({ok:true});
}

function listFacilities_(body) {
  requireSession_(body.token);
  return json_({ok:true, facilities:getTableRows_(getFacilitySheet_(), 5).map(facilityRowToObject_)});
}

function createFacility_(body) {
  requireMenuAccess_(body.token, 'fasilitas');
  const item = body.facility || {};
  if (!item.nama || !item.deskripsi) throw new Error('Nama dan deskripsi fasilitas wajib diisi.');
  const sheet = getFacilitySheet_();
  const id = nextId_(getTableRows_(sheet, 5).map(r => r.values), 'FAS-');
  const foto = saveDriveImage_(item, FASUM_DRIVE_FOLDER_ID, item.nama);
  sheet.appendRow([id,item.nama,item.deskripsi,foto,item.maps || '']);
  logActivity_(requireSession_(body.token), 'create', 'fasilitas', 'Menambah fasilitas "' + item.nama + '"');
  return json_({ok:true, id:id});
}

function updateFacility_(body) {
  requireMenuAccess_(body.token, 'fasilitas');
  const item = body.facility || {}, found = findTableRow_(getFacilitySheet_(), item.id, 5);
  if (!found) throw new Error('Fasilitas tidak ditemukan.');
  const foto = saveDriveImage_(item, FASUM_DRIVE_FOLDER_ID, item.nama) || item.foto || found.values[3] || '';
  getFacilitySheet_().getRange(found.row,1,1,5).setValues([[found.values[0],item.nama,item.deskripsi,foto,item.maps || '']]);
  logActivity_(requireSession_(body.token), 'update', 'fasilitas', 'Memperbarui fasilitas "' + item.nama + '"');
  return json_({ok:true});
}

function deleteFacility_(body) {
  requireMenuAccess_(body.token, 'fasilitas');
  const found = findTableRow_(getFacilitySheet_(), body.id, 5);
  if (!found) throw new Error('Fasilitas tidak ditemukan.');
  getFacilitySheet_().deleteRow(found.row);
  logActivity_(requireSession_(body.token), 'delete', 'fasilitas', 'Menghapus fasilitas "' + found.values[1] + '"');
  return json_({ok:true});
}

function listOrganization_(body) {
  requireSession_(body.token);
  const groups = {};
  ORG_SHEET_NAMES.forEach(name => groups[name] = getTableRows_(getOrgSheet_(name), 4).map(r => orgRowToObject_(name, r)));
  return json_({ok:true, organization:groups});
}

function createOrgMember_(body) {
  requireMenuAccess_(body.token, 'organisasi');
  const item = body.member || {}, group = validateOrgGroup_(item.group);
  if (!item.jabatan || !item.nama) throw new Error('Jabatan dan nama pengurus wajib diisi.');
  const sheet = getOrgSheet_(group);
  const id = nextId_(getTableRows_(sheet, 4).map(r => r.values), 'ORG-');
  const foto = saveDriveImage_(item, ORG_DRIVE_FOLDER_ID, item.nama);
  sheet.appendRow([id,item.jabatan,item.nama,foto]);
  logActivity_(requireSession_(body.token), 'create', 'organisasi', 'Menambah pengurus ' + item.nama + ' (' + item.jabatan + ')');
  return json_({ok:true, id:id});
}

function updateOrgMember_(body) {
  requireMenuAccess_(body.token, 'organisasi');
  const item = body.member || {}, group = validateOrgGroup_(item.group), found = findTableRow_(getOrgSheet_(group), item.id, 4);
  if (!found) throw new Error('Data pengurus tidak ditemukan.');
  const foto = saveDriveImage_(item, ORG_DRIVE_FOLDER_ID, item.nama) || item.foto || found.values[3] || '';
  getOrgSheet_(group).getRange(found.row,1,1,4).setValues([[found.values[0],item.jabatan,item.nama,foto]]);
  logActivity_(requireSession_(body.token), 'update', 'organisasi', 'Memperbarui pengurus ' + item.nama);
  return json_({ok:true});
}

function deleteOrgMember_(body) {
  requireMenuAccess_(body.token, 'organisasi');
  const group = validateOrgGroup_(body.group), found = findTableRow_(getOrgSheet_(group), body.id, 4);
  if (!found) throw new Error('Data pengurus tidak ditemukan.');
  getOrgSheet_(group).deleteRow(found.row);
  logActivity_(requireSession_(body.token), 'delete', 'organisasi', 'Menghapus pengurus ' + found.values[2]);
  return json_({ok:true});
}

function listGalleryAlbums_(body) {
  requireSession_(body.token);
  const rows = getGalleryRows_();
  const albums = rows.map(galleryRowToObject_);
  for (let i = 0; i < albums.length; i++) {
    if (albums[i].folderId) {
      try {
        const folder = DriveApp.getFolderById(albums[i].folderId);
        const files = folder.getFiles();
        let count = 0, firstFile = null;
        while (files.hasNext()) {
          const f = files.next();
          if (count === 0) firstFile = f;
          count++;
        }
        albums[i].photoCount = count;
        albums[i].thumbnailUrl = firstFile ? 'https://drive.google.com/thumbnail?id=' + firstFile.getId() + '&sz=w400' : '';
      } catch (e) {
        albums[i].photoCount = 0;
        albums[i].thumbnailUrl = '';
      }
    }
  }
  return json_({ ok: true, albums: albums });
}

function createGalleryAlbum_(body) {
  requireMenuAccess_(body.token, 'galeri');
  const item = body.album || {};
  if (!item.nama) throw new Error('Nama album wajib diisi.');
  const parentFolder = DriveApp.getFolderById(GALLERY_DRIVE_FOLDER_ID);
  const subFolder = parentFolder.createFolder(sanitizeFileName_(item.nama));
  const sheet = getGallerySheet_();
  const id = nextId_(getGalleryRows_().map(r => r.values), 'GAL-');
  sheet.appendRow([id, item.nama, item.deskripsi || '', subFolder.getId(), today_(), item.status || 'Aktif']);
  return json_({ ok: true, message: 'Album berhasil dibuat.', id: id, folderId: subFolder.getId() });
}

function deleteGalleryAlbum_(body) {
  requireMenuAccess_(body.token, 'galeri');
  const found = findGalleryRow_(body.id);
  if (!found) throw new Error('Album tidak ditemukan.');
  const album = galleryRowToObject_(found);
  if (album.folderId) {
    try { DriveApp.getFolderById(album.folderId).setTrashed(true); } catch (e) {}
  }
  getGallerySheet_().deleteRow(found.row);
  return json_({ ok: true, message: 'Album berhasil dihapus.' });
}

function listGalleryPhotos_(body) {
  requireSession_(body.token);
  if (!body.folderId) throw new Error('Folder ID wajib diisi.');
  const folder = DriveApp.getFolderById(body.folderId);
  const files = folder.getFiles();
  const photos = [];
  while (files.hasNext()) {
    const f = files.next();
    const mime = f.getMimeType();
    if (mime.startsWith('image/')) {
      photos.push({
        fileId: f.getId(),
        name: f.getName(),
        mimeType: mime,
        url: f.getUrl(),
        thumbnailUrl: 'https://drive.google.com/thumbnail?id=' + f.getId() + '&sz=w600',
        viewUrl: 'https://drive.google.com/uc?export=view&id=' + f.getId(),
        dateCreated: Utilities.formatDate(f.getDateCreated(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm')
      });
    }
  }
  return json_({ ok: true, photos: photos });
}

function uploadGalleryPhoto_(body) {
  requireMenuAccess_(body.token, 'galeri');
  if (!body.folderId || !body.dataUrl || !body.fileName) throw new Error('Folder ID, file, dan nama file wajib diisi.');
  const match = String(body.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Format file gambar tidak valid.');
  const allowed = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  if (allowed.indexOf(match[1]) < 0) throw new Error('Gunakan file SVG, PNG, JPG, WebP, atau GIF.');
  const folder = DriveApp.getFolderById(body.folderId);
  const safeName = sanitizeFileName_(body.fileName);
  const blob = Utilities.newBlob(Utilities.base64Decode(match[2]), match[1], safeName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return json_({ ok: true, message: 'Foto berhasil diupload.', fileId: file.getId(), url: file.getUrl() });
}

function deleteGalleryPhoto_(body) {
  requireMenuAccess_(body.token, 'galeri');
  if (!body.fileId) throw new Error('File ID wajib diisi.');
  try { DriveApp.getFileById(body.fileId).setTrashed(true); } catch (e) {}
  return json_({ ok: true, message: 'Foto berhasil dihapus.' });
}

function getGallerySheet_() { return openSheet_(GALLERY_SPREADSHEET_ID, GALLERY_SHEET_NAME); }

function getGalleryRows_() {
  const sheet = getGallerySheet_(), last = sheet.getLastRow();
  if (last < 2) return [];
  const values = sheet.getRange(2, 1, last - 1, 6).getDisplayValues();
  return values.map((v, i) => ({ row: i + 2, values: v })).filter(r => r.values[0]);
}

function findGalleryRow_(id) {
  const rows = getGalleryRows_(), index = rows.findIndex(r => String(r.values[0]) === String(id));
  return index < 0 ? null : rows[index];
}

function galleryRowToObject_(row) {
  const v = row.values;
  return {
    id: v[0],
    nama: v[1],
    deskripsi: v[2],
    folderId: v[3],
    tanggal: v[4],
    status: v[5]
  };
}

function getKasSheet_() { return openSheet_(KAS_SPREADSHEET_ID, KAS_SHEET_NAME); }

function getKasRows_() {
  const sheet = getKasSheet_(), last = sheet.getLastRow();
  if (last < 2) return [];
  const values = sheet.getRange(2, 1, last - 1, 14).getValues();
  const formulas = sheet.getRange(2, 1, last - 1, 14).getFormulas();
  return values.map((v, i) => ({ row: i + 2, values: v, formulas: formulas[i] })).filter(r => r.values[0]);
}

function kasRowToObject_(row) {
  const v = row.values, f = row.formulas || [];
  let tglStr = v[2];
  if (tglStr instanceof Date) {
    const tz = Session.getScriptTimeZone();
    tglStr = Utilities.formatDate(tglStr, tz, 'dd/MM/yyyy');
  }
  const linkRaw = String(f[10] || v[10] || '');
  const m = linkRaw.match(/HYPERLINK\("([^"]+)"/i);
  const fileUrl = m ? m[1] : (linkRaw.match(/https?:\/\/[^",\s)]+/) || [''])[0];
  const fileId = extractFileId_(fileUrl);
  const imageUrl = fileId ? 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1200' : fileUrl;
  return {
    rowNum: row.row,
    tanggal: String(tglStr),
    uraian: String(v[3] || ''),
    pj: String(v[4] || ''),
    metode: String(v[5] || ''),
    masuk: Number(v[6]) || 0,
    keluar: Number(v[7]) || 0,
    keterangan: String(v[8] || ''),
    fileUrl: fileUrl,
    fileId: fileId,
    imageUrl: imageUrl,
    status: String(v[11] || 'Menunggu'),
    createdBy: String(v[12] || ''),
    approvedBy: String(v[13] || '')
  };
}

function listKas_(body) {
  var session = requireSession_(body.token);
  const allRows = getKasRows_().map(kasRowToObject_).sort((a, b) => {
    const p = s => { const pp = String(s).split('/'); return pp.length === 3 ? new Date(pp[2], pp[1]-1, pp[0]).getTime() : 0; };
    return p(b.tanggal) - p(a.tanggal);
  });
  const total = allRows.length;
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const perPage = Math.max(1, Math.min(50, parseInt(body.perPage, 10) || 10));
  const totalPages = Math.ceil(total / perPage) || 1;
  const start = (page - 1) * perPage;
  const data = allRows.slice(start, start + perPage);
  return json_({ ok: true, data, total, page, perPage, totalPages, userRole: session.role, userId: session.userId, userNama: session.nama });
}

function createKas_(body) {
  var session = requireMenuAccess_(body.token, 'kas');
  const item = body.kas || {};
  if (!item.tanggal || !item.uraian || !item.nominal || !item.jenis_form) throw new Error('Tanggal, uraian, nominal, dan jenis transaksi wajib diisi.');
  const sheet = getKasSheet_();
  const nextRow = sheet.getLastRow() + 1;

  let linkFormula = '-';
  if (item.fileData && item.fileName) {
    const match = String(item.fileData).match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      const ext = item.fileName.includes('.') ? item.fileName.split('.').pop() : 'jpg';
      const safeName = sanitizeFileName_('Bukti_' + item.uraian.replace(/[/\\?%*:|"<>]/g, '-') + '_' + item.tanggal.replace(/\//g, '-') + '.' + ext);
      const blob = Utilities.newBlob(Utilities.base64Decode(match[2]), match[1], safeName);
      const file = DriveApp.getFolderById(KAS_DRIVE_FOLDER_ID).createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      linkFormula = '=HYPERLINK("' + file.getUrl() + '"; "Lihat Bukti Foto")';
    }
  }

  const masuk = item.jenis_form === 'masuk' ? parseInt(item.nominal, 10) : 0;
  const keluar = item.jenis_form === 'keluar' ? parseInt(item.nominal, 10) : 0;

  sheet.getRange(nextRow, 1).setValue('=ROW()-1');
  sheet.getRange(nextRow, 2).setValue(new Date());
  sheet.getRange(nextRow, 3).setValue(item.tanggal);
  sheet.getRange(nextRow, 4).setValue(item.uraian);
  sheet.getRange(nextRow, 5).setValue('-');
  sheet.getRange(nextRow, 6).setValue(item.metode || 'Tunai');
  sheet.getRange(nextRow, 7).setValue(masuk);
  sheet.getRange(nextRow, 8).setValue(keluar);
  sheet.getRange(nextRow, 9).setValue(item.keterangan || '-');
  if (nextRow === 2) {
    sheet.getRange(nextRow, 10).setFormula('=IF(L2="Disetujui";G2-H2;0)');
  } else {
    sheet.getRange(nextRow, 10).setFormula('=$J' + (nextRow - 1) + '+IF(L' + nextRow + '="Disetujui";G' + nextRow + '-H' + nextRow + ';0)');
  }
  sheet.getRange(nextRow, 11).setFormula(linkFormula);
  sheet.getRange(nextRow, 12).setValue('Menunggu');
  sheet.getRange(nextRow, 13).setValue(session.nama);

  logActivity_(session, 'create', 'kas', 'Menambah transaksi "' + item.uraian + '" (' + item.jenis_form + ' Rp' + parseInt(item.nominal, 10).toLocaleString('id-ID') + ')');
  return json_({ ok: true, message: 'Transaksi berhasil disimpan. Menunggu persetujuan admin.' });
}

function updateKas_(body) {
  var session = requireMenuAccess_(body.token, 'kas');
  const item = body.kas || {};
  const targetRow = parseInt(item.rowNum, 10);
  if (!targetRow || targetRow < 2) throw new Error('Baris data tidak valid.');
  const sheet = getKasSheet_();

  if (item.fileData && item.fileData.includes(',')) {
    const rangeFoto = sheet.getRange(targetRow, 11);
    const formulaLama = String(rangeFoto.getFormula() || '');
    const valueLama = String(rangeFoto.getValue() || '');
    const stringCek = formulaLama || valueLama;
    if (stringCek) {
      let idFileLama = '';
      const m1 = stringCek.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      const m2 = stringCek.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (m1) idFileLama = m1[1]; else if (m2) idFileLama = m2[1];
      if (idFileLama) try { DriveApp.getFileById(idFileLama).setTrashed(true); } catch (e) { }
    }
    const match = item.fileData.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      const ext = item.fileName.includes('.') ? item.fileName.split('.').pop() : 'jpg';
      const safeName = sanitizeFileName_('Bukti_' + item.uraian.replace(/[/\\?%*:|"<>]/g, '-') + '_' + item.tanggal.replace(/\//g, '-') + '.' + ext);
      const blob = Utilities.newBlob(Utilities.base64Decode(match[2]), match[1], safeName);
      const file = DriveApp.getFolderById(KAS_DRIVE_FOLDER_ID).createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      sheet.getRange(targetRow, 11).setFormula('=HYPERLINK("' + file.getUrl() + '"; "Lihat Bukti Foto 1")');
    }
  }

  sheet.getRange(targetRow, 2).setValue(new Date());
  sheet.getRange(targetRow, 3).setValue(item.tanggal);
  sheet.getRange(targetRow, 4).setValue(item.uraian);
  sheet.getRange(targetRow, 5).setValue('-');
  sheet.getRange(targetRow, 6).setValue(item.metode || 'Tunai');
  if (item.jenis_form === 'masuk') {
    sheet.getRange(targetRow, 7).setValue(parseInt(item.nominal, 10));
    sheet.getRange(targetRow, 8).setValue(0);
  } else {
    sheet.getRange(targetRow, 7).setValue(0);
    sheet.getRange(targetRow, 8).setValue(parseInt(item.nominal, 10));
  }
  sheet.getRange(targetRow, 9).setValue(item.keterangan || '-');

  if (item.status === 'Menunggu') {
    sheet.getRange(targetRow, 12).setValue('Menunggu');
  }

  updateKasBalances_(sheet, targetRow);
  logActivity_(session, 'update', 'kas', 'Memperbarui transaksi "' + item.uraian + '"');
  return json_({ ok: true, message: 'Transaksi berhasil diperbarui.' });
}

function deleteKas_(body) {
  const user = requireMenuAccess_(body.token, 'kas');
  const session = requireSession_(body.token);
  const targetRow = parseInt(body.rowNum, 10);
  if (!targetRow || targetRow < 2) throw new Error('Baris data tidak valid.');
  const sheet = getKasSheet_();

  if (!['Super Admin', 'Admin'].includes(session.role)) {
    const currentStatus = String(sheet.getRange(targetRow, 12).getValue() || 'Menunggu');
    const currentCreator = String(sheet.getRange(targetRow, 13).getValue() || '');
    if (currentStatus !== 'Menunggu' && currentStatus !== 'Ditolak') throw new Error('Anda hanya bisa menghapus transaksi Menunggu atau Ditolak.');
    if (currentCreator !== session.nama) throw new Error('Anda hanya bisa menghapus transaksi milik Anda sendiri.');
  }

  var formulaLama = String(sheet.getRange(targetRow, 11).getFormula() || '');
  var valueLama = String(sheet.getRange(targetRow, 11).getValue() || '');
  var stringCek = formulaLama || valueLama;
  if (stringCek) {
    var idFile = '';
    var m1 = stringCek.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    var m2 = stringCek.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (m1) idFile = m1[1]; else if (m2) idFile = m2[1];
    if (idFile) try { DriveApp.getFileById(idFile).setTrashed(true); } catch (e) {}
  }

  sheet.deleteRow(targetRow);
  updateKasBalances_(sheet, targetRow);
  logActivity_(session, 'delete', 'kas', 'Menghapus transaksi pada baris ' + targetRow);
  return json_({ ok: true, message: 'Transaksi berhasil dihapus.' });
}

function updateKasBalances_(sheet, fromRow) {
  var lastRow = sheet.getLastRow();
  for (var i = Math.max(2, fromRow); i <= lastRow; i++) {
    if (i === 2) {
      sheet.getRange(i, 10).setFormula('=IF(L2="Disetujui";G2-H2;0)');
    } else {
      sheet.getRange(i, 10).setFormula('=$J' + (i - 1) + '+IF(L' + i + '="Disetujui";G' + i + '-H' + i + ';0)');
    }
  }
}

function approveKas_(body) {
  var session = requireSession_(body.token);
  if (!['Super Admin', 'Admin'].includes(session.role)) throw new Error('Hanya Admin atau Super Admin yang dapat menyetujui transaksi.');
  var targetRow = parseInt(body.rowNum, 10);
  if (!targetRow || targetRow < 2) throw new Error('Baris data tidak valid.');
  var sheet = getKasSheet_();
  var currentStatus = String(sheet.getRange(targetRow, 12).getValue() || '');
  if (currentStatus !== 'Menunggu') throw new Error('Hanya transaksi berstatus Menunggu yang dapat disetujui.');
  sheet.getRange(targetRow, 12).setValue('Disetujui');
  sheet.getRange(targetRow, 14).setValue(session.nama);
  updateKasBalances_(sheet, targetRow);
  logActivity_(session, 'approve', 'kas', 'Menyetujui transaksi pada baris ' + targetRow);
  return json_({ ok: true, message: 'Transaksi berhasil disetujui.' });
}

function rejectKas_(body) {
  var session = requireSession_(body.token);
  if (!['Super Admin', 'Admin'].includes(session.role)) throw new Error('Hanya Admin atau Super Admin yang dapat menolak transaksi.');
  var targetRow = parseInt(body.rowNum, 10);
  if (!targetRow || targetRow < 2) throw new Error('Baris data tidak valid.');
  var sheet = getKasSheet_();
  var currentStatus = String(sheet.getRange(targetRow, 12).getValue() || '');
  if (currentStatus !== 'Menunggu') throw new Error('Hanya transaksi berstatus Menunggu yang dapat ditolak.');
  sheet.getRange(targetRow, 12).setValue('Ditolak');
  sheet.getRange(targetRow, 14).setValue('');
  updateKasBalances_(sheet, targetRow);
  logActivity_(session, 'reject', 'kas', 'Menolak transaksi pada baris ' + targetRow);
  return json_({ ok: true, message: 'Transaksi berhasil ditolak.' });
}

function getKasReport_(body) {
  requireSession_(body.token);
  try {
    const sheet = getKasSheet_(), lastRow = sheet.getLastRow();
    let saldoAwal = 0, totalMasuk = 0, totalKeluar = 0, rincianMasuk = [], rincianKeluar = [];
    if (lastRow < 2) return json_({ ok: true, saldoAwal: 0, totalMasuk: 0, totalKeluar: 0, saldoAkhir: 0, rincianMasuk: [], rincianKeluar: [] });
    const data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
    const targetBulan = parseInt(body.bulan, 10), targetTahun = parseInt(body.tahun, 10);
    const tz = Session.getScriptTimeZone();
    data.forEach(row => {
      const status = String(row[11] || 'Menunggu');
      if (status !== 'Disetujui') return;
      const tglRaw = row[2];
      if (!tglRaw) return;
      let d = null;
      if (tglRaw instanceof Date) { d = tglRaw; }
      else if (typeof tglRaw === 'string') {
        const parts = tglRaw.split('/');
        if (parts.length === 3) d = new Date(parts[2], parts[1] - 1, parts[0]);
      }
      if (d) {
        const m = d.getMonth(), y = d.getFullYear();
        const masuk = Number(row[6]) || 0, keluar = Number(row[7]) || 0;
        if (y < targetTahun || (y === targetTahun && m < targetBulan)) { saldoAwal += masuk - keluar; }
        else if (m === targetBulan && y === targetTahun) {
          if (masuk > 0) { totalMasuk += masuk; rincianMasuk.push({ tanggal: Utilities.formatDate(d, tz, 'dd/MM/yyyy'), uraian: row[3], nominal: masuk }); }
          if (keluar > 0) { totalKeluar += keluar; rincianKeluar.push({ tanggal: Utilities.formatDate(d, tz, 'dd/MM/yyyy'), uraian: row[3], nominal: keluar }); }
        }
      }
    });
    const sortByDateAsc = (a, b) => {
      const p = s => { const pp = String(s).split('/'); return pp.length === 3 ? new Date(pp[2], pp[1]-1, pp[0]).getTime() : 0; };
      return p(a.tanggal) - p(b.tanggal);
    };
    rincianMasuk.sort(sortByDateAsc);
    rincianKeluar.sort(sortByDateAsc);
    const saldoAkhir = saldoAwal + totalMasuk - totalKeluar;
    return json_({ ok: true, saldoAwal, totalMasuk, totalKeluar, saldoAkhir, rincianMasuk, rincianKeluar });
  } catch (err) {
    return json_({ ok: false, message: err.toString() });
  }
}

function getKasDashboard_(body) {
  var session = requireSession_(body.token);
  try {
    const sheet = getKasSheet_(), lastRow = sheet.getLastRow();
    if (lastRow < 2) return json_({ ok: true, totalMasuk: 0, totalKeluar: 0, saldoAkhir: 0, jumlahTransaksi: 0, menungguCount: 0, ditolakCount: 0, notifications: [] });
    const now = new Date();
    const targetBulan = now.getMonth(), targetTahun = now.getFullYear();
    const data = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
    let totalMasuk = 0, totalKeluar = 0, jumlahTransaksi = 0, menungguCount = 0, ditolakCount = 0;
    const userNama = session.nama;
    const notifications = [];
    data.forEach((row, idx) => {
      const status = String(row[11] || 'Menunggu');
      if (status === 'Menunggu') {
        menungguCount++;
        notifications.push({ type: 'menunggu', uraian: String(row[3] || '-'), tanggal: String(row[2] || '-'), createdBy: String(row[12] || '-'), rowNum: idx + 2 });
      }
      if (status === 'Ditolak' && String(row[12] || '') === userNama) {
        ditolakCount++;
        notifications.push({ type: 'ditolak', uraian: String(row[3] || '-'), tanggal: String(row[2] || '-'), createdBy: String(row[12] || '-'), rowNum: idx + 2 });
      }
      if (status !== 'Disetujui') return;
      const tglRaw = row[2];
      if (!tglRaw) return;
      let d = null;
      if (tglRaw instanceof Date) { d = tglRaw; }
      else if (typeof tglRaw === 'string') {
        const parts = tglRaw.split('/');
        if (parts.length === 3) d = new Date(parts[2], parts[1] - 1, parts[0]);
      }
      if (d) {
        const m = d.getMonth(), y = d.getFullYear();
        if (m === targetBulan && y === targetTahun) {
          const masuk = Number(row[6]) || 0, keluar = Number(row[7]) || 0;
          if (masuk > 0) totalMasuk += masuk;
          if (keluar > 0) totalKeluar += keluar;
          if (masuk > 0 || keluar > 0) jumlahTransaksi++;
        }
      }
    });
    return json_({ ok: true, totalMasuk, totalKeluar, saldoAkhir: totalMasuk - totalKeluar, jumlahTransaksi, menungguCount, ditolakCount, notifications });
  } catch (err) {
    return json_({ ok: false, message: err.toString() });
  }
}

function getKasCashFlow_(body) {
  requireSession_(body.token);
  try {
    const sheet = getKasSheet_(), lastRow = sheet.getLastRow();
    if (lastRow < 2) return json_({ ok: true, data: [] });
    const data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
    const bulanAwal = parseInt(body.bulanAwal, 10), tahunAwal = parseInt(body.tahunAwal, 10);
    const bulanAkhir = parseInt(body.bulanAkhir, 10), tahunAkhir = parseInt(body.tahunAkhir, 10);
    const namaBulan = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
    const months = [];
    let y = tahunAwal, m = bulanAwal;
    while (y < tahunAkhir || (y === tahunAkhir && m <= bulanAkhir)) {
      months.push({ bulan: m, tahun: y, label: namaBulan[m] + ' ' + y, masuk: 0, keluar: 0 });
      m++;
      if (m > 11) { m = 0; y++; }
    }
    let saldoAll = 0;
    data.forEach(row => {
      const status = String(row[11] || 'Menunggu');
      if (status !== 'Disetujui') return;
      const tglRaw = row[2];
      if (!tglRaw) return;
      let d = null;
      if (tglRaw instanceof Date) { d = tglRaw; }
      else if (typeof tglRaw === 'string') {
        const parts = tglRaw.split('/');
        if (parts.length === 3) d = new Date(parts[2], parts[1] - 1, parts[0]);
      }
      if (!d) return;
      const dm = d.getMonth(), dy = d.getFullYear();
      const masuk = Number(row[6]) || 0, keluar = Number(row[7]) || 0;
      if (dy < tahunAwal || (dy === tahunAwal && dm < bulanAwal)) {
        saldoAll += masuk - keluar;
      }
      const found = months.find(x => x.bulan === dm && x.tahun === dy);
      if (found) { found.masuk += masuk; found.keluar += keluar; }
    });
    let saldo = saldoAll;
    const result = months.map(x => {
      saldo += x.masuk - x.keluar;
      return { label: x.label, masuk: x.masuk, keluar: x.keluar, saldo: saldo };
    });
    return json_({ ok: true, data: result });
  } catch (err) {
    return json_({ ok: false, message: err.toString() });
  }
}

function getStatistikSheet_() { return openSheet_(INFO_SPREADSHEET_ID, STATISTIK_SHEET_NAME); }

function getStatistikRows_() {
  const sheet = getStatistikSheet_(), last = sheet.getLastRow();
  if (last < 2) return [];
  const values = sheet.getRange(2, 1, last - 1, 5).getValues();
  return values.map((v, i) => ({ row: i + 2, values: v })).filter(r => r.values[0]);
}

function statistikRowToObject_(row) {
  const v = row.values;
  return {
    id: String(v[0] || ''),
    nama: String(v[1] || ''),
    nilai: Number(v[2]) || 0,
    keterangan: String(v[3] || ''),
    updatedAt: String(v[4] || '')
  };
}

function listStatistik_(body) {
  requireSession_(body.token);
  return json_({ ok: true, data: getStatistikRows_().map(statistikRowToObject_) });
}

function createStatistik_(body) {
  requireMenuAccess_(body.token, 'statistik');
  const item = body.statistik || {};
  if (!item.nama) throw new Error('Nama kategori wajib diisi.');
  const sheet = getStatistikSheet_();
  const rows = getStatistikRows_().map(r => r.values);
  const id = nextId_(rows, 'STT-');
  sheet.appendRow([id, item.nama, Number(item.nilai) || 0, item.keterangan || '', formatDate_(new Date())]);
  logActivity_(requireSession_(body.token), 'create', 'statistik', 'Menambah kategori "' + item.nama + '"');
  return json_({ ok: true, message: 'Kategori berhasil ditambahkan.', id: id });
}

function updateStatistik_(body) {
  requireMenuAccess_(body.token, 'statistik');
  const item = body.statistik || {};
  if (!item.id) throw new Error('ID kategori wajib diisi.');
  const rows = getStatistikRows_();
  const found = rows.find(r => String(r.values[0]) === String(item.id));
  if (!found) throw new Error('Kategori tidak ditemukan.');
  const sheet = getStatistikSheet_();
  sheet.getRange(found.row, 1, 1, 5).setValues([[found.values[0], item.nama || found.values[1], Number(item.nilai) || found.values[2], item.keterangan !== undefined ? item.keterangan : found.values[3], formatDate_(new Date())]]);
  logActivity_(requireSession_(body.token), 'update', 'statistik', 'Memperbarui kategori "' + (item.nama || found.values[1]) + '"');
  return json_({ ok: true, message: 'Kategori berhasil diperbarui.' });
}

function deleteStatistik_(body) {
  requireMenuAccess_(body.token, 'statistik');
  if (!body.id) throw new Error('ID kategori wajib diisi.');
  const rows = getStatistikRows_();
  const found = rows.find(r => String(r.values[0]) === String(body.id));
  if (!found) throw new Error('Kategori tidak ditemukan.');
  getStatistikSheet_().deleteRow(found.row);
  logActivity_(requireSession_(body.token), 'delete', 'statistik', 'Menghapus kategori "' + found.values[1] + '"');
  return json_({ ok: true, message: 'Kategori berhasil dihapus.' });
}

function getActivityLogSheet_() { return openSheet_(INFO_SPREADSHEET_ID, ACTIVITY_LOG_SHEET_NAME); }

function logActivity_(actor, action, module, description) {
  try {
    const sheet = getActivityLogSheet_();
    ensureHeader_(sheet, ACTIVITY_LOG_HEADERS);
    sheet.appendRow([formatDate_(new Date()), actor.nama || 'System', actor.role || '-', action, module, description]);
    const lastRow = sheet.getLastRow();
    if (lastRow > 102) sheet.deleteRows(2, lastRow - 102);
  } catch (e) {}
}

function listActivity_(body) {
  requireSession_(body.token);
  const sheet = getActivityLogSheet_();
  ensureHeader_(sheet, ACTIVITY_LOG_HEADERS);
  const last = sheet.getLastRow();
  if (last < 2) return json_({ ok: true, data: [] });
  const limit = Math.min(20, Math.max(1, parseInt(body.limit, 10) || 10));
  const totalRows = last - 1;
  const startRow = Math.max(2, last - limit + 1);
  const count = last - startRow + 1;
  const values = sheet.getRange(startRow, 1, count, 6).getValues();
  const data = values.reverse().map(r => ({
    timestamp: String(r[0] || ''),
    actor: String(r[1] || ''),
    role: String(r[2] || ''),
    action: String(r[3] || ''),
    module: String(r[4] || ''),
    description: String(r[5] || '')
  }));
  return json_({ ok: true, data });
}

function requireSession_(token) {
  const raw = CacheService.getScriptCache().get('session_' + String(token || ''));
  if (!raw) throw new Error('Sesi berakhir. Silakan login kembali.');
  return JSON.parse(raw);
}

function requireAdmin_(token) {
  const user = requireSession_(token);
  if (!['Super Admin','Admin'].includes(user.role)) throw new Error('Anda tidak memiliki akses untuk tindakan ini.');
  return user;
}

function requireSuperAdmin_(token) {
  const user = requireSession_(token);
  if (user.role !== 'Super Admin') throw new Error('Hanya Super Admin yang dapat melakukan tindakan ini.');
  return user;
}

function requireMenuAccess_(token, menuKey) {
  const user = requireSession_(token);
  if (['Super Admin', 'Admin'].includes(user.role)) return user;
  if (user.role === 'Editor') {
    const menus = JSON.parse(user.menuAkses || '[]');
    if (menus.includes(menuKey)) return user;
  }
  throw new Error('Anda tidak memiliki akses ke menu ini.');
}

function getSheet_() { return openSheet_(USER_SPREADSHEET_ID, USER_SHEET_NAME); }
function getHimbauanSheet_() { return openSheet_(HIMBAUAN_SPREADSHEET_ID, HIMBAUAN_SHEET_NAME); }
function getInfoSheet_() { return openSheet_(INFO_SPREADSHEET_ID, INFO_SHEET_NAME); }
function getNewsSheet_() { return openSheet_(INFO_SPREADSHEET_ID, NEWS_SHEET_NAME); }
function getFacilitySheet_() { return openSheet_(FASUM_SPREADSHEET_ID, FASUM_SHEET_NAME); }
function getOrgSheet_(name) { return openSheet_(ORG_SPREADSHEET_ID, name); }
function openSheet_(spreadsheetId, sheetName) { const ss=SpreadsheetApp.openById(spreadsheetId); let sheet=ss.getSheetByName(sheetName); if(!sheet) sheet=ss.insertSheet(sheetName); return sheet; }
function ensureHeader_(sheet, headers) { if (sheet.getLastRow() === 0) sheet.getRange(1,1,1,headers.length).setValues([headers]); sheet.setFrozenRows(1); sheet.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#d9ead3'); sheet.autoResizeColumns(1,headers.length); }
function getRows_(sheet) { const last = sheet.getLastRow(); if (last < 2) return []; const cols = Math.min(11, sheet.getLastColumn()); return sheet.getRange(2,1,last-1,cols).getDisplayValues().filter(r => r[0]); }
function findUserRow_(id) { const rows=getRows_(getSheet_()), index=rows.findIndex(r=>String(r[0])===String(id)); return index<0?null:{row:index+2,values:rows[index]}; }
function rowToUser_(r) { return {userId:r[0],nama:r[1],email:r[2],noHp:r[3],role:r[4],wilayah:r[5],status:r[6],loginTerakhir:r[8] || '-',tanggalDibuat:r[9] || '-',menuAkses:r[10] || '[]'}; }
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
function isActive_(item) { return String(item.status || 'Aktif').toLowerCase() === 'aktif'; }
function validateOrgGroup_(group) { const value=String(group || 'rw'); if (ORG_SHEET_NAMES.indexOf(value) < 0) throw new Error('Jenis struktur organisasi tidak valid.'); return value; }
function nextId_(rows, prefix) { const max=rows.reduce((m,r)=>Math.max(m,parseInt(String(r[0]).replace(/\D/g,''),10)||0),0); return prefix + String(max+1).padStart(prefix ? 3 : 1, '0'); }
function saveDriveImage_(item, folderId, label) { if (!item.dataUrl) return ''; const match=String(item.dataUrl).match(/^data:([^;]+);base64,(.+)$/); if(!match) throw new Error('Format file gambar tidak valid.'); const allowed=['image/svg+xml','image/png','image/jpeg','image/webp','image/gif']; if(allowed.indexOf(match[1])<0) throw new Error('Gunakan file SVG, PNG, JPG, WebP, atau GIF.'); const safeName=sanitizeFileName_(item.fileName || label || 'foto'); const blob=Utilities.newBlob(Utilities.base64Decode(match[2]),match[1],safeName); const file=DriveApp.getFolderById(folderId).createFile(blob); file.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW); const driveUrl='https://drive.google.com/file/d/'+file.getId()+'/view?usp=drive_link'; return '=HYPERLINK("' + driveUrl + '";"' + String(label || safeName).replace(/"/g,'""') + '")'; }
function extractUrl_(value) { const text=String(value || ''); const formula=text.match(/HYPERLINK\("([^"]+)"/i); if(formula)return formula[1]; const url=text.match(/https?:\/\/[^",\s)]+/); return url?url[0]:text; }
function extractFileId_(url) { const text=String(url || ''); const byPath=text.match(/\/d\/([a-zA-Z0-9_-]+)/); if(byPath)return byPath[1]; const byId=text.match(/[?&]id=([a-zA-Z0-9_-]+)/); return byId?byId[1]:''; }
function sanitizeFileName_(name) { return String(name || 'himbauan.svg').replace(/[\\/:*?"<>|]/g,'-').slice(0,120); }
function hashPassword_(password) { const digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(password),Utilities.Charset.UTF_8); return digest.map(b=>(b+256)%256).map(b=>('0'+b.toString(16)).slice(-2)).join(''); }
function today_() { return Utilities.formatDate(new Date(),Session.getScriptTimeZone() || 'Asia/Jakarta','dd/MM/yyyy'); }
function formatDate_(date) { return Utilities.formatDate(date,Session.getScriptTimeZone() || 'Asia/Jakarta','dd/MM/yyyy HH:mm'); }
function json_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }