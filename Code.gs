/**
 * Backend Google Apps Script - Portal RW 26
 * ---------------------------------------------------------------------------
 *  SESUDAH MIGRASI KE SUPABASE
 *
 *  File ini sekarang hanya mengurus EMPAT modul:
 *    - Berita & Informasi      (sheet `berita`)
 *    - Video Sambutan          (sheet `video`)
 *    - Galeri Foto             (sheet `album` + folder Google Drive)
 *    - Video Kegiatan          (sheet `video_kegiatan`)
 *
 *  Semua modul lain (himbauan, pengumuman, fasilitas, organisasi, statistik,
 *  kas, pengguna, log) sudah pindah ke Supabase dan TIDAK lagi dibaca dari
 *  sini. Foto untuk modul yang datanya di Supabase tetap di Google Drive,
 *  diunggah lewat aksi `uploadDriveImage`.
 *
 *  Kredensial Supabase TIDAK ditulis di file ini. File ini ikut ter-commit ke
 *  repository publik, jadi kuncinya disimpan di Script Properties:
 *    Properti  > Script Properties  >  SUPABASE_URL
 *                                     SUPABASE_ANON_KEY
 *                                     SUPABASE_SERVICE_ROLE_KEY
 *  Pasang sekali lewat fungsi setupSupabaseConfig_() di bawah.
 */

// ---------------------------------------------------------------------------
//  Spreadsheet & Drive yang masih dipakai
// ---------------------------------------------------------------------------
const INFO_SPREADSHEET_ID = '15qG8a0brYTc0KjeMof077LcT0rfIxQ9TFRmAkzcpEJs';

const NEWS_SHEET_NAME = 'berita';
const NEWS_HEADERS = ['ID', 'Judul', 'Kategory', 'Isi', 'Tanggal', 'Foto', 'Status'];
const NEWS_DRIVE_FOLDER_ID = '1322RJTLHdwdXBDyHETVjRXvDBYF-kyIg';

const VIDEO_SHEET_NAME = 'video';
const VIDEO_HEADERS = ['ID', 'Judul', 'Deskripsi', 'URL', 'Tanggal', 'Status', 'Autoplay'];

const VIDEO_KEGIATAN_SHEET_NAME = 'video_kegiatan';
const VIDEO_KEGIATAN_HEADERS = ['ID', 'Judul', 'Deskripsi', 'URL', 'Tanggal', 'Status'];

const GALLERY_SPREADSHEET_ID = '1oLjA8Ak_dyQ1d6bjnNf4xKrxaLqgd8fk7LYux0UDKUY';
const GALLERY_SHEET_NAME = 'album';
const GALLERY_HEADERS = ['ID', 'Nama Album', 'Deskripsi', 'Folder ID', 'Tanggal', 'Status', 'Jumlah Foto', 'Thumbnail ID'];
const GALLERY_DRIVE_FOLDER_ID = '18AbNqUjBBgaS4acBKh7_zbB9SqC8bqMO';

// Folder Drive milik modul yang DATANYA sudah pindah ke Supabase.
// Dipakai oleh aksi uploadDriveImage_.
const HIMBAUAN_DRIVE_FOLDER_ID = '1ypF7zjtpk86ZAWktMQ9BM3mhtLLls-9y';
const FASUM_DRIVE_FOLDER_ID = '1lvcZNiAppoztO-J7DL-5qQ8eZBrSya87';
const ORG_DRIVE_FOLDER_ID = '1Tv1y6isGdVpOKdljEPpDexMOW82aWIOI';
const KAS_DRIVE_FOLDER_ID = '1YDiyLsylMsbUBzOC85RUL5zkqsOOGz6C';

// ---------------------------------------------------------------------------
//  Cache
// ---------------------------------------------------------------------------
const DATA_CACHE_TTL = 120;
const PUBLIC_CACHE_TTL = 1800;
const GALLERY_CACHE_TTL = 1800;
const LKG_PREFIX = 'lkg_';
const LKG_TTL = 21600;
const PENDING_PREFIX = 'pend_';
const PENDING_TTL = 30;

function cacheGet_(key) {
  const raw = CacheService.getScriptCache().get(key);
  if (raw == null) return undefined;
  try { return JSON.parse(raw); } catch (e) { return undefined; }
}

function cacheSet_(key, value, ttl) {
  if (value === undefined) return;
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(value), ttl);
  } catch (e) {
    console.warn('Cache gagal disimpan untuk ' + key + ': ' + e.message);
  }
}

function cachedData_(key, ttl, compute, fallback) {
  const hit = cacheGet_(key);
  if (hit !== undefined) return hit;
  const lkgKey = LKG_PREFIX + key;
  const lock = LockService.getScriptLock();
  if (lock.tryLock(1200)) {
    try {
      const refreshed = cacheGet_(key);
      if (refreshed !== undefined) return refreshed;
      const data = compute();
      cacheSet_(key, data, ttl);
      cacheSet_(lkgKey, data, LKG_TTL);
      return data;
    } finally {
      lock.releaseLock();
    }
  }
  const lkg = cacheGet_(lkgKey);
  if (lkg !== undefined) return lkg;
  if (cacheGet_(PENDING_PREFIX + key) !== undefined) return fallback === undefined ? null : fallback;
  cacheSet_(PENDING_PREFIX + key, '1', PENDING_TTL);
  return compute();
}

function versionedKey_(module, suffix) {
  const ver = CacheService.getScriptCache().get('ver_' + module) || '0';
  return 'v' + ver + '_' + module + (suffix ? '_' + suffix : '');
}

function invalidateData_(module) {
  const cache = CacheService.getScriptCache();
  // Hanya modul yang masih tinggal di Apps Script. Modul lain di-invalidasi
  // lewat triggers database, bukan lewat cache ini.
  const staticKeys = {
    berita: ['list_news'],
    galeri: ['list_gallery_albums', 'public_gallery_albums'],
    video: ['list_videos'],
    video_kegiatan: ['list_video_kegiatan']
  };
  (staticKeys[module] || []).forEach(key => cache.remove(key));
  cache.remove('public_content');
  const cur = parseInt(cache.get('ver_' + module) || '0', 10);
  cache.put('ver_' + module, String(cur + 1), 3600);
}

function doGet(e) {
  try {
    const action = e && e.parameter && e.parameter.action;
    if (action === 'publicContent') return publicContent_();
    if (action === 'publicGalleryPhotos') return publicGalleryPhotos_(e.parameter);
    //-api lama (kas, pengunjung) sengaja tidak lagi dilayani di sini.
    //Website publik memanggilnya langsung ke Supabase.
    return json_({ ok: true, service: 'Portal RW 26 API (galeri & media)', time: formatDate_(new Date()) });
  } catch (err) {
    return json_({ ok: false, message: err.message || 'Terjadi kesalahan server.' });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    switch (body.action) {
      // ---- Galeri Foto (tab `album` + folder Drive) ----
      case 'listGalleryAlbums': return listGalleryAlbums_(body);
      case 'createGalleryAlbum': return createGalleryAlbum_(body);
      case 'deleteGalleryAlbum': return deleteGalleryAlbum_(body);
      case 'listGalleryPhotos': return listGalleryPhotos_(body);
      case 'uploadGalleryPhoto': return uploadGalleryPhoto_(body);
      case 'deleteGalleryPhoto': return deleteGalleryPhoto_(body);

      // ---- Berita & Informasi (tab `berita`) ----
      case 'listNews': return listNews_(body);
      case 'createNews': return createNews_(body);
      case 'updateNews': return updateNews_(body);
      case 'toggleNews': return toggleNews_(body);
      case 'deleteNews': return deleteNews_(body);

      // ---- Video Sambutan (tab `video`) ----
      case 'listVideos': return listVideos_(body);
      case 'createVideo': return createVideo_(body);
      case 'updateVideo': return updateVideo_(body);
      case 'toggleVideo': return toggleVideo_(body);
      case 'setVideoAutoplay': return setVideoAutoplay_(body);
      case 'clearVideoAutoplay': return clearVideoAutoplay_(body);
      case 'deleteVideo': return deleteVideo_(body);

      // ---- Video Kegiatan (tab `video_kegiatan`) ----
      case 'listVideoKegiatan': return listVideoKegiatan_(body);
      case 'createVideoKegiatan': return createVideoKegiatan_(body);
      case 'updateVideoKegiatan': return updateVideoKegiatan_(body);
      case 'toggleVideoKegiatan': return toggleVideoKegiatan_(body);
      case 'deleteVideoKegiatan': return deleteVideoKegiatan_(body);

      // ---- Upload foto untuk modul yang datanya ada di Supabase ----
      case 'uploadDriveImage': return uploadDriveImage_(body);

      default: throw new Error('Aksi API tidak dikenal.');
    }
  } catch (err) {
    return json_({ ok: false, message: err.message || 'Terjadi kesalahan server.' });
  }
}

// ============================================================================
//  AUTHENTIKASI MELALUI SUPABASE
// ============================================================================
//  Sesi tidak lagi dibuat sendiri. Portal admin login lewat Supabase Auth dan
//  mengirim access token-nya di setiap permintaan. Token itu divalidasi di
//  sini dengan memanggil endpoint /auth/v1/user milik Supabase.
//
//  Kenapa tidak pakai token buatan sendiri seperti sebelumnya?
//  Token Supabase sudah ditandatangani dan kedaluwarsa sendiri, jadi tidak
//  perlu storing apa pun di CacheService. Selain itu, sesi tidak ikut hilang
//  kalau cache Apps Script di-evict.
//
//  PERINGATAN KEAMANAN
//  A Web App yang dideploy dengan "Execute as: Me" dan akses "Anyone" bisa
//  dipanggil siapa saja. Karena itu SETIAP aksi yang mengubah data WAJIB
//  memanggil requireMenuAccess_ lebih dulu. Jangan ada aksi tulis yang
//  dilewati begitu saja.
function supabaseConfig_() {
  const props = PropertiesService.getScriptProperties();
  return {
    url: props.getProperty('SUPABASE_URL'),
    anonKey: props.getProperty('SUPABASE_ANON_KEY'),
    serviceRoleKey: props.getProperty('SUPABASE_SERVICE_ROLE_KEY')
  };
}

/**
 * Pasang kredensial Supabase ke Script Properties.
 * Jalankan SEKALI dari editor Apps Script. Jangan dipanggil lagi setelah
 * terpasang, dan jangan pernah menuliskan nilainya di dalam file ini.
 */
function setupSupabaseConfig_(url, anonKey, serviceRoleKey) {
  const props = PropertiesService.getScriptProperties();
  if (url) props.setProperty('SUPABASE_URL', String(url).trim());
  if (anonKey) props.setProperty('SUPABASE_ANON_KEY', String(anonKey).trim());
  if (serviceRoleKey) props.setProperty('SUPABASE_SERVICE_ROLE_KEY', String(serviceRoleKey).trim());
  console.log('Konfigurasi Supabase tersimpan. Hapus nilai dari riwayat eksekusi.');
  return 'OK';
}

function fetchSupabaseProfile_(cfg, userId) {
  const url = cfg.url + '/rest/v1/profiles'
    + '?select=legacy_id,nama,role,status,menu_access'
    + '&id=eq.' + encodeURIComponent(userId);
  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { apikey: cfg.serviceRoleKey, Authorization: 'Bearer ' + cfg.serviceRoleKey },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) return null;
  const rows = JSON.parse(res.getContentText());
  return (Array.isArray(rows) && rows.length) ? rows[0] : null;
}

function requireSupabaseUser_(token) {
  const cfg = supabaseConfig_();
  if (!cfg.url || !cfg.anonKey || !cfg.serviceRoleKey) {
    throw new Error('Konfigurasi Supabase belum dipasang. Jalankan setupSupabaseConfig_().');
  }
  if (!token) throw new Error('Sesi berakhir. Silakan login kembali.');

  const res = UrlFetchApp.fetch(cfg.url + '/auth/v1/user', {
    method: 'get',
    headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + String(token) },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Sesi berakhir. Silakan login kembali.');
  }
  const user = JSON.parse(res.getContentText());
  if (!user || !user.id) throw new Error('Token tidak valid.');

  const profile = fetchSupabaseProfile_(cfg, user.id);
  if (!profile) throw new Error('Profil tidak ditemukan. Hubungi Super Admin.');
  if (String(profile.status || '').toLowerCase() !== 'aktif') {
    throw new Error('Akun sedang nonaktif. Hubungi administrator.');
  }
  return {
    id: user.id,
    email: user.email,
    nama: profile.nama,
    legacyId: profile.legacy_id,
    role: profile.role,
    menu: Array.isArray(profile.menu_access) ? profile.menu_access : []
  };
}

/** Hierarki wewenang, meniru hasMenuAccess_ yang lama. */
function hasMenuAccess_(user, menuKey) {
  if (!user) return false;
  if (user.role === 'Super Admin' || user.role === 'Admin') return true;
  if (user.role !== 'Editor') return false;
  return Array.isArray(user.menu) && user.menu.indexOf(menuKey) !== -1;
}

function requireMenuAccess_(token, menuKey) {
  const user = requireSupabaseUser_(token);
  if (!hasMenuAccess_(user, menuKey)) throw new Error('Anda tidak memiliki akses ke menu ini.');
  return user;
}

function requireAdmin_(token) {
  const user = requireSupabaseUser_(token);
  if (user.role !== 'Super Admin' && user.role !== 'Admin') {
    throw new Error('Anda tidak memiliki akses untuk tindakan ini.');
  }
  return user;
}

/**
 * Catat jejak perubahan ke tabel activity_log di Supabase.
 *
 * Dulu ditulis ke sheet `activity_log` yang dipangkas jadi 101 baris terakhir.
 * Sekarang ditulis ke PostgreSQL lewat PostgREST, jadi tidak perlu dipangkas.
 *
 * Sengaja dibungkus try/catch: kegagalan menulis log TIDAK boleh membatalkan
 * aksi utama. Dulu juga begitu (Code.gs:1844), dan itu benar - lebih baik
 * perubahan tersimpan tanpa jejak daripada perubahan hilang karena log error.
 */
function logActivity_(actor, action, module, description) {
  try {
    const cfg = supabaseConfig_();
    if (!cfg.url || !cfg.serviceRoleKey) return;
    const res = UrlFetchApp.fetch(cfg.url + '/rest/v1/activity_log', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        apikey: cfg.serviceRoleKey,
        Authorization: 'Bearer ' + cfg.serviceRoleKey,
        Prefer: 'return=minimal'
      },
      payload: JSON.stringify({
        actor: actor && actor.id ? actor.id : null,
        actor_name: (actor && actor.nama) || 'System',
        actor_role: (actor && actor.role) || '-',
        action: String(action || ''),
        module: String(module || ''),
        description: String(description || '')
      }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() >= 300) {
      console.warn('logActivity gagal: ' + res.getResponseCode() + ' ' + String(res.getContentText()).slice(0, 150));
    }
  } catch (e) {
    console.warn('logActivity gagal: ' + e.message);
  }
}


function setupGallerySheet() {
  ensureHeader_(getGallerySheet_(true), GALLERY_HEADERS);
}

function setupVideoSheet() {
  ensureHeader_(getVideoSheet_(true), VIDEO_HEADERS);
}

function refreshGalleryMetadata() {
  const sheet = getGallerySheet_();
  const rows = getGalleryRows_();
  rows.forEach(function (row) {
    const album = galleryRowToObject_(row);
    if (!album.folderId) return;
    try {
      const files = DriveApp.getFolderById(album.folderId).getFiles();
      let count = 0;
      let thumbnailId = '';
      while (files.hasNext()) {
        const file = files.next();
        if (!file.getMimeType().startsWith('image/')) continue;
        if (!thumbnailId) thumbnailId = file.getId();
        count++;
      }
      sheet.getRange(row.row, 7, 1, 2).setValues([[count, thumbnailId]]);
    } catch (e) {
      console.warn('Metadata galeri gagal disinkronkan untuk ' + album.id + ': ' + e.message);
    }
  });
  invalidateData_('galeri');
}

function setupVideoKegiatanSheet() {
  ensureHeader_(getVideoKegiatanSheet_(true), VIDEO_KEGIATAN_HEADERS);
}

/**
 * Memanaskan cache supaya pengunjung pertama tidak menunggu pembacaan sheet.
 * Hanya mengisi cache milik Apps Script. Laporan kas tidak lagi dipanaskan
 * karena dihitung oleh PostgreSQL (yang punya cache sendiri).
 */
function warmCache() {
  const started = Date.now();
  const stats = {};

  try { publicContent_(); stats.publicContent = 'ok'; }
  catch (e) { stats.publicContent = e.message; }

  // Album galeri yang punya foto, supaya lightbox tidak lambat saat dibuka.
  try {
    publicGalleryAlbums_();
    stats.gallery = 'ok';
  } catch (e) { stats.gallery = e.message; }

  console.log('warmCache selesai dalam ' + (Date.now() - started) + 'ms - ' + JSON.stringify(stats));
}

function installWarmTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'warmCache') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('warmCache').timeBased().everyMinutes(10).create();
  console.log('Trigger warmCache terpasang: setiap 10 menit.');
}

/**
 * Bentuk kosong untuk publicContent.
 *
 * Dulu ada 9 kunci. Sekarang hanya 4 yang tersisa di Apps Script - sisanya
 * (himbauan, pengumuman, fasilitas, organisasi, statistik) dibaca langsung
 * dari Supabase oleh Website-RW26 lewat fungsi get_public_content().
 */
function emptyPublicContent_() {
  return { ok: true, news: [], gallery: [], videos: [], videoKegiatan: [] };
}

function publicContentData_() {
  return {
    ok: true,
    news: cachedData_('list_news', DATA_CACHE_TTL, function () {
      return getTableRows_(getNewsSheet_(), 7).map(newsRowToObject_);
    }, []).filter(isActive_),
    gallery: cachedData_('public_gallery_albums', GALLERY_CACHE_TTL, publicGalleryAlbums_, []),
    videos: cachedData_('list_videos', DATA_CACHE_TTL, function () {
      return getVideoRows_().map(videoRowToObject_);
    }, []).filter(isActive_),
    videoKegiatan: cachedData_('list_video_kegiatan', DATA_CACHE_TTL, function () {
      return getVideoKegiatanRows_().map(videoKegiatanRowToObject_);
    }, []).filter(isActive_)
  };
}

function publicContent_() {
  const empty = emptyPublicContent_();
  const data = cachedData_('public_content', PUBLIC_CACHE_TTL, publicContentData_, empty);
  if (!data || !data.ok) return json_(empty);
  return json_(data);
}

function publicGalleryAlbums_() {
  return getGalleryRows_()
    .map(galleryRowToObject_)
    .filter(isActive_)
    .filter(album => album.photoCountStored > 0 && album.thumbnailId)
    .map(album => ({
      id: album.id,
      nama: album.nama,
      deskripsi: album.deskripsi,
      photoCount: album.photoCountStored,
      thumbnailId: album.thumbnailId
    }));
}

function publicGalleryPhotos_(params) {
  const albumId = String((params && params.albumId) || '').trim();
  if (!albumId) throw new Error('ID album wajib diisi.');
  const albumRow = findGalleryRow_(albumId);
  if (!albumRow) throw new Error('Album tidak ditemukan.');
  const album = galleryRowToObject_(albumRow);
  if (!isActive_(album) || !album.folderId) throw new Error('Album tidak tersedia.');
  const key = versionedKey_('galeri', 'public_album_' + album.id);
  const photos = cachedData_(key, GALLERY_CACHE_TTL, function () {
    try {
      const files = DriveApp.getFolderById(album.folderId).getFiles();
      const result = [];
      while (files.hasNext()) {
        const file = files.next();
        if (file.getMimeType().startsWith('image/')) result.push({ fileId: file.getId(), name: file.getName() });
      }
      return result;
    } catch (e) {
      console.warn('Galeri gagal dimuat untuk ' + album.id + ': ' + e.message);
      throw new Error('Foto album belum dapat dimuat.');
    }
  }, []);
  return json_({ ok: true, album: { id: album.id, nama: album.nama }, photos: photos });
}

function listVideos_(body) {
  requireSupabaseUser_(body.token);
  return json_({ok:true, videos:cachedData_('list_videos', DATA_CACHE_TTL, function(){ return getVideoRows_().map(videoRowToObject_); })});
}

function createVideo_(body) {
  requireMenuAccess_(body.token, 'video');
  const item = body.video || {};
  const videoId = extractYoutubeId_(item.url);
  if (!item.judul || !videoId) throw new Error('Judul dan URL YouTube yang valid wajib diisi.');
  const status = item.status || 'Aktif';
  const wantAutoplay = String(item.autoplay||'').toLowerCase()==='ya'||String(item.autoplay||'').toLowerCase()==='true'||item.autoplay===true;
  if (wantAutoplay && String(status).toLowerCase()!=='aktif') throw new Error('Hanya video Aktif yang bisa dijadikan autoplay.');
  if (wantAutoplay) clearAllVideoAutoplay_();
  const sheet = getVideoSheet_();
  const id = nextId_(getVideoRows_().map(r => r.values), 'VID-');
  sheet.appendRow([id, neutralizeFormula_(item.judul), sanitizeHtml_(item.deskripsi || ''), neutralizeFormula_(item.url), item.tanggal || today_(), status, wantAutoplay?'Ya':'']);
  logActivity_(requireSupabaseUser_(body.token), 'create', 'video', 'Menambah video "' + item.judul + '"');
  invalidateData_('video');
  return json_({ok:true, id:id});
}

function updateVideo_(body) {
  requireMenuAccess_(body.token, 'video');
  const item = body.video || {}, found = findVideoRow_(item.id);
  if (!found) throw new Error('Video tidak ditemukan.');
  const videoId = extractYoutubeId_(item.url);
  if (!item.judul || !videoId) throw new Error('Judul dan URL YouTube yang valid wajib diisi.');
  const status = item.status || found.values[5] || 'Aktif';
  const autoplayRaw = item.autoplay!==undefined ? item.autoplay : found.values[6];
  const wantAutoplay = String(autoplayRaw||'').toLowerCase()==='ya'||String(autoplayRaw||'').toLowerCase()==='true'||autoplayRaw===true;
  if (wantAutoplay && String(status).toLowerCase()!=='aktif') throw new Error('Hanya video Aktif yang bisa dijadikan autoplay.');
  if (wantAutoplay) clearAllVideoAutoplay_();
  const sheet=getVideoSheet_();
  sheet.getRange(found.row,1,1,7).setValues([[found.values[0], neutralizeFormula_(item.judul), sanitizeHtml_(item.deskripsi || ''), neutralizeFormula_(item.url), item.tanggal, status, wantAutoplay?'Ya':'']]);
  logActivity_(requireSupabaseUser_(body.token), 'update', 'video', 'Memperbarui video "' + item.judul + '"');
  invalidateData_('video');
  return json_({ok:true});
}

function toggleVideo_(body) {
  requireMenuAccess_(body.token, 'video');
  const found = findVideoRow_(body.id);
  if (!found) throw new Error('Video tidak ditemukan.');
  const status = String(found.values[5]).toLowerCase() === 'aktif' ? 'Nonaktif' : 'Aktif';
  getVideoSheet_().getRange(found.row,6).setValue(status);
  if (status==='Nonaktif') getVideoSheet_().getRange(found.row,7).setValue('');
  logActivity_(requireSupabaseUser_(body.token), 'toggle', 'video', 'Mengubah status video "' + found.values[1] + '" ke ' + status);
  invalidateData_('video');
  return json_({ok:true, status:status});
}
function setVideoAutoplay_(body){
  requireMenuAccess_(body.token, 'video');
  const found=findVideoRow_(body.id);
  if(!found) throw new Error('Video tidak ditemukan.');
  if(String(found.values[5]).toLowerCase()!=='aktif') throw new Error('Hanya video Aktif yang bisa dijadikan autoplay.');
  const lock=LockService.getScriptLock();
  if(lock.tryLock(8000)){ try{ clearAllVideoAutoplay_(); getVideoSheet_().getRange(found.row,7).setValue('Ya'); } finally{ lock.releaseLock(); } } else { clearAllVideoAutoplay_(); getVideoSheet_().getRange(found.row,7).setValue('Ya'); }
  logActivity_(requireSupabaseUser_(body.token), 'update', 'video', 'Menjadikan autoplay "'+found.values[1]+'"');
  invalidateData_('video');
  return json_({ok:true});
}
function clearVideoAutoplay_(body){
  requireMenuAccess_(body.token, 'video');
  clearAllVideoAutoplay_();
  logActivity_(requireSupabaseUser_(body.token), 'update', 'video', 'Menghapus autoplay video');
  invalidateData_('video');
  return json_({ok:true});
}

function deleteVideo_(body) {
  requireMenuAccess_(body.token, 'video');
  const found = findVideoRow_(body.id);
  if (!found) throw new Error('Video tidak ditemukan.');
  getVideoSheet_().deleteRow(found.row);
  logActivity_(requireSupabaseUser_(body.token), 'delete', 'video', 'Menghapus video "' + found.values[1] + '"');
  invalidateData_('video');
  return json_({ok:true, message:'Video berhasil dihapus.'});
}

function listVideoKegiatan_(body) {
  requireSupabaseUser_(body.token);
  return json_({ok:true, videoKegiatan:cachedData_('list_video_kegiatan', DATA_CACHE_TTL, function(){ return getVideoKegiatanRows_().map(videoKegiatanRowToObject_); })});
}

function createVideoKegiatan_(body) {
  requireMenuAccess_(body.token, 'videoKegiatan');
  const item = body.videoKegiatan || body.video || {};
  const videoId = extractYoutubeId_(item.url);
  if (!item.judul || !videoId) throw new Error('Judul dan URL YouTube yang valid wajib diisi.');
  const status = item.status || 'Aktif';
  const sheet = getVideoKegiatanSheet_();
  const id = nextId_(getVideoKegiatanRows_().map(r => r.values), 'VK-');
  sheet.appendRow([id, neutralizeFormula_(item.judul), sanitizeHtml_(item.deskripsi || ''), neutralizeFormula_(item.url), item.tanggal || today_(), status]);
  logActivity_(requireSupabaseUser_(body.token), 'create', 'video_kegiatan', 'Menambah video kegiatan "' + item.judul + '"');
  invalidateData_('video_kegiatan');
  return json_({ok:true, id:id});
}

function updateVideoKegiatan_(body) {
  requireMenuAccess_(body.token, 'videoKegiatan');
  const item = body.videoKegiatan || body.video || {}, found = findVideoKegiatanRow_(item.id);
  if (!found) throw new Error('Video kegiatan tidak ditemukan.');
  const videoId = extractYoutubeId_(item.url);
  if (!item.judul || !videoId) throw new Error('Judul dan URL YouTube yang valid wajib diisi.');
  const status = item.status || found.values[5] || 'Aktif';
  getVideoKegiatanSheet_().getRange(found.row,1,1,6).setValues([[found.values[0], neutralizeFormula_(item.judul), sanitizeHtml_(item.deskripsi || ''), neutralizeFormula_(item.url), item.tanggal || found.values[4], status]]);
  logActivity_(requireSupabaseUser_(body.token), 'update', 'video_kegiatan', 'Memperbarui video kegiatan "' + item.judul + '"');
  invalidateData_('video_kegiatan');
  return json_({ok:true});
}

function toggleVideoKegiatan_(body) {
  requireMenuAccess_(body.token, 'videoKegiatan');
  const found = findVideoKegiatanRow_(body.id);
  if (!found) throw new Error('Video kegiatan tidak ditemukan.');
  const status = String(found.values[5]).toLowerCase() === 'aktif' ? 'Nonaktif' : 'Aktif';
  getVideoKegiatanSheet_().getRange(found.row,6).setValue(status);
  logActivity_(requireSupabaseUser_(body.token), 'toggle', 'video_kegiatan', 'Mengubah status video kegiatan "' + found.values[1] + '" ke ' + status);
  invalidateData_('video_kegiatan');
  return json_({ok:true, status:status});
}

function deleteVideoKegiatan_(body) {
  requireMenuAccess_(body.token, 'videoKegiatan');
  const found = findVideoKegiatanRow_(body.id);
  if (!found) throw new Error('Video kegiatan tidak ditemukan.');
  getVideoKegiatanSheet_().deleteRow(found.row);
  logActivity_(requireSupabaseUser_(body.token), 'delete', 'video_kegiatan', 'Menghapus video kegiatan "' + found.values[1] + '"');
  invalidateData_('video_kegiatan');
  return json_({ok:true, message:'Video kegiatan berhasil dihapus.'});
}

function listNews_(body) {
  requireSupabaseUser_(body.token);
  return json_({ok:true, news:cachedData_('list_news', DATA_CACHE_TTL, function(){ return getTableRows_(getNewsSheet_(), 7).map(newsRowToObject_); })});
}

function createNews_(body) {
  requireMenuAccess_(body.token, 'berita');
  const item = body.news || {};
  if (!item.judul || !item.category || !item.isi) throw new Error('Judul, kategori, dan isi berita wajib diisi.');
  const sheet = getNewsSheet_();
  const id = nextId_(getTableRows_(sheet, 7).map(r => r.values), 'BRT-');
  const foto = saveDriveImage_(item, NEWS_DRIVE_FOLDER_ID, item.judul);
  sheet.appendRow([id, neutralizeFormula_(item.judul), neutralizeFormula_(item.category), sanitizeHtml_(item.isi), item.tanggal || today_(), foto, item.status || 'Aktif']);
  logActivity_(requireSupabaseUser_(body.token), 'create', 'berita', 'Menambah berita "' + item.judul + '"');
  invalidateData_('berita');
  return json_({ok:true, id:id});
}

function updateNews_(body) {
  requireMenuAccess_(body.token, 'berita');
  const item = body.news || {}, found = findTableRow_(getNewsSheet_(), item.id, 7);
  if (!found) throw new Error('Berita tidak ditemukan.');
  const foto = saveDriveImage_(item, NEWS_DRIVE_FOLDER_ID, item.judul) || item.foto || found.values[5] || '';
  getNewsSheet_().getRange(found.row,1,1,7).setValues([[found.values[0], neutralizeFormula_(item.judul), neutralizeFormula_(item.category), sanitizeHtml_(item.isi), item.tanggal, foto, item.status]]);
  logActivity_(requireSupabaseUser_(body.token), 'update', 'berita', 'Memperbarui berita "' + item.judul + '"');
  invalidateData_('berita');
  return json_({ok:true});
}

function toggleNews_(body) {
  requireMenuAccess_(body.token, 'berita');
  const found = findTableRow_(getNewsSheet_(), body.id, 7);
  if (!found) throw new Error('Berita tidak ditemukan.');
  const status = String(found.values[6]).toLowerCase() === 'aktif' ? 'Nonaktif' : 'Aktif';
  getNewsSheet_().getRange(found.row,7).setValue(status);
  logActivity_(requireSupabaseUser_(body.token), 'toggle', 'berita', 'Mengubah status berita "' + found.values[1] + '" ke ' + status);
  invalidateData_('berita');
  return json_({ok:true, status:status});
}

function deleteNews_(body) {
  requireMenuAccess_(body.token, 'berita');
  const found = findTableRow_(getNewsSheet_(), body.id, 7);
  if (!found) throw new Error('Berita tidak ditemukan.');
  getNewsSheet_().deleteRow(found.row);
  logActivity_(requireSupabaseUser_(body.token), 'delete', 'berita', 'Menghapus berita "' + found.values[1] + '"');
  invalidateData_('berita');
  return json_({ok:true});
}

function listGalleryAlbums_(body) {
  requireSupabaseUser_(body.token);
  return json_({ ok: true, albums: galleryAlbumsWithCounts_() });
}

function galleryAlbumsWithCounts_() {
  return cachedData_('list_gallery_albums', GALLERY_CACHE_TTL, function () {
    const rows = getGalleryRows_();
    const albums = rows.map(galleryRowToObject_);
    const sheet = getGallerySheet_();
    const backfill = [];
    for (let i = 0; i < albums.length; i++) {
      const album = albums[i];
      album.photoCount = album.photoCountStored || 0;
      album.thumbnailUrl = '';
      if (!album.folderId) continue;
      if (album.photoCountStored === null) {
        try {
          const folder = DriveApp.getFolderById(album.folderId);
          const files = folder.getFiles();
          let count = 0, firstFile = null;
          while (files.hasNext()) {
            const f = files.next();
            if (count === 0) firstFile = f;
            count++;
          }
          album.photoCount = count;
          if (firstFile) album.thumbnailId = firstFile.getId();
          backfill.push({ row: rows[i].row, count: count, thumbnailId: album.thumbnailId });
        } catch (e) {
          album.photoCount = 0;
          album.thumbnailUrl = '';
          continue;
        }
      }
      album.thumbnailUrl = album.thumbnailId ? 'https://drive.google.com/thumbnail?id=' + album.thumbnailId + '&sz=w400' : '';
    }
    backfill.forEach(function (b) {
      try {
        sheet.getRange(b.row, 7).setValue(b.count || 0);
        if (b.thumbnailId) sheet.getRange(b.row, 8).setValue(b.thumbnailId);
      } catch (e) {}
    });
    return albums;
  });
}

function createGalleryAlbum_(body) {
  requireMenuAccess_(body.token, 'galeri');
  const item = body.album || {};
  if (!item.nama) throw new Error('Nama album wajib diisi.');
  const parentFolder = DriveApp.getFolderById(GALLERY_DRIVE_FOLDER_ID);
  const subFolder = parentFolder.createFolder(sanitizeFileName_(item.nama));
  const sheet = getGallerySheet_();
  const id = nextId_(getGalleryRows_().map(r => r.values), 'GAL-');
  sheet.appendRow([id, neutralizeFormula_(item.nama), neutralizeFormula_(item.deskripsi || ''), subFolder.getId(), today_(), item.status || 'Aktif', 0, '']);
  invalidateData_('galeri');
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
  invalidateData_('galeri');
  return json_({ ok: true, message: 'Album berhasil dihapus.' });
}

function listGalleryPhotos_(body) {
  requireMenuAccess_(body.token, 'galeri');
  const folder = assertGalleryFolder_(body.folderId);
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
  if (!body.dataUrl || !body.fileName) throw new Error('File dan nama file wajib diisi.');
  const match = String(body.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Format file gambar tidak valid.');
  const allowed = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  if (allowed.indexOf(match[1]) < 0) throw new Error('Gunakan file SVG, PNG, JPG, WebP, atau GIF.');
  const folder = assertGalleryFolder_(body.folderId);
  const safeName = sanitizeFileName_(body.fileName);
  const blob = Utilities.newBlob(Utilities.base64Decode(match[2]), match[1], safeName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const albumRows = getGalleryRows_();
  const idx = albumRows.findIndex(r => String(r.values[3]) === String(body.folderId));
  if (idx >= 0) {
    try {
      const sheet = getGallerySheet_();
      const rowNum = albumRows[idx].row;
      const cur = parseInt(albumRows[idx].values[6] || '0', 10) + 1;
      sheet.getRange(rowNum, 7).setValue(cur);
      if (!String(albumRows[idx].values[7] || '')) sheet.getRange(rowNum, 8).setValue(file.getId());
    } catch (e) {
      console.warn('Metadata album gagal diperbarui: ' + e.message);
    }
  }
  invalidateData_('galeri');
  return json_({ ok: true, message: 'Foto berhasil diupload.', fileId: file.getId(), url: file.getUrl() });
}

// ============================================================================
//  UPLOAD FOTO UNTUK MODUL YANG DATANYA ADA DI SUPABASE
// ============================================================================
//  Himbauan, pengumuman, fasilitas, organisasi, dan kas kini datanya tinggal
//  di PostgreSQL. Tapi fotonya tetap di Google Drive, dan Drive hanya bisa
//  ditulis lewat Apps Script (butuh kredensial akun RW, bukan token browser).
//
//  Aksi ini menjembatani keduanya: browser mengunggah ke sini, file masuk ke
//  folder Drive modul tersebut, dan Apps Script mengembalikan fileId. Portal
//  admin lalu menyimpan fileId itu ke Supabase lewat PostgREST.
//
//  TIGA LAPIS PERLINDUNGAN, semuanya wajib ada:
//    1. Modul harus ada di DRIVE_FOLDER_BY_MODULE. Modul yang tidak terdaftar
//       tidak bisa menulis ke folder mana pun. Tanpa daftar ini, parameter
//       'module' bisa dipakai untuk menulis ke folder kas dengan hak akses kas.
//    2. requireMenuAccess_ memeriksa token Supabase DAN hak modul.
//    3. Daftar tipe MIME dibatasi.
//
//  Tanpa nomor 1 dan 2, Web App yang dideploy "Anyone" akan menjadi endpoint
//  upload publik yang bisa dipakai siapa saja untuk menimpa folder mana pun.
const DRIVE_FOLDER_BY_MODULE = {
  himbauan: HIMBAUAN_DRIVE_FOLDER_ID,
  fasilitas: FASUM_DRIVE_FOLDER_ID,
  organisasi: ORG_DRIVE_FOLDER_ID,
  kas: KAS_DRIVE_FOLDER_ID
};

const IMAGE_MIME_ALLOWED = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'];

function uploadDriveImage_(body) {
  const moduleKey = String((body && body.module) || '').trim();
  const folderId = DRIVE_FOLDER_BY_MODULE[moduleKey];
  if (!folderId) {
    throw new Error('Modul "' + moduleKey + '" tidak punya folder Drive.');
  }

  const user = requireMenuAccess_(body.token, moduleKey);

  const item = (body && body.item) || {};
  if (!item.dataUrl) throw new Error('Data gambar kosong.');

  const match = String(item.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Format data gambar tidak valid.');

  const mime = match[1];
  // Bukti kas boleh PDF, modul lain tidak. Ini meniru perilaku lama di mana
  // modul kas tidak punya pembatasan MIME sama sekali (Code.gs:1439-1448).
  const allowed = moduleKey === 'kas'
    ? IMAGE_MIME_ALLOWED.concat(['application/pdf'])
    : IMAGE_MIME_ALLOWED;
  if (allowed.indexOf(mime) < 0) {
    throw new Error('Tipe file tidak diizinkan: ' + mime);
  }

  const subtype = mime.split('/')[1] || 'bin';
  const ext = subtype === 'jpeg' ? 'jpg' : subtype;
  const baseName = String(item.name || 'gambar').replace(/\.[A-Za-z0-9]+$/, '');
  const safeName = sanitizeFileName_(baseName + '.' + ext);

  const blob = Utilities.newBlob(Utilities.base64Decode(match[2]), mime, safeName);
  const file = DriveApp.getFolderById(folderId).createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  console.log('uploadDriveImage module=' + moduleKey + ' oleh=' + user.nama + ' file=' + file.getId());

  return json_({
    ok: true,
    fileId: file.getId(),
    url: file.getUrl(),
    viewUrl: 'https://drive.google.com/uc?export=view&id=' + file.getId(),
    name: safeName
  });
}

function deleteGalleryPhoto_(body) {
  requireMenuAccess_(body.token, 'galeri');
  if (!body.fileId) throw new Error('File ID wajib diisi.');
  let file;
  try { file = DriveApp.getFileById(body.fileId); } catch (e) { throw new Error('Foto tidak ditemukan.'); }
  const parents = file.getParents();
  if (!parents.hasNext()) throw new Error('Foto tidak berada dalam album galeri.');
  const parentFolderId = parents.next().getId();
  assertGalleryFolder_(parentFolderId);
  file.setTrashed(true);
  const albumRows = getGalleryRows_();
  const idx = albumRows.findIndex(r => String(r.values[3]) === parentFolderId);
  if (idx >= 0) {
    try {
      const sheet = getGallerySheet_();
      const rowNum = albumRows[idx].row;
      const cur = Math.max(0, parseInt(albumRows[idx].values[6] || '0', 10) - 1);
      sheet.getRange(rowNum, 7).setValue(cur);
      if (String(albumRows[idx].values[7] || '') === String(body.fileId)) {
        const files = DriveApp.getFolderById(parentFolderId).getFiles();
        let thumbnailId = '';
        while (files.hasNext()) {
          const thumb = files.next();
          if (thumb.getMimeType().startsWith('image/')) {
            thumbnailId = thumb.getId();
            break;
          }
        }
        sheet.getRange(rowNum, 8).setValue(thumbnailId);
      }
    } catch (e) {
      console.warn('Metadata album gagal diperbarui: ' + e.message);
    }
  }
  invalidateData_('galeri');
  return json_({ ok: true, message: 'Foto berhasil dihapus.' });
}

function getGallerySheet_(create) { return openSheet_(GALLERY_SPREADSHEET_ID, GALLERY_SHEET_NAME, create); }

function getGalleryRows_() {
  const sheet = getGallerySheet_(), last = sheet.getLastRow();
  if (last < 2) return [];
  const width = Math.max(6, Math.min(8, sheet.getLastColumn()));
  const values = sheet.getRange(2, 1, last - 1, width).getDisplayValues();
  return values.map((v, i) => ({ row: i + 2, values: v })).filter(r => r.values[0]);
}

function findGalleryRow_(id) {
  const rows = getGalleryRows_(), index = rows.findIndex(r => String(r.values[0]) === String(id));
  return index < 0 ? null : rows[index];
}

function assertGalleryFolder_(folderId) {
  const id = String(folderId || '');
  if (!id) throw new Error('Album tidak valid.');
  const registered = getGalleryRows_().some(r => String(r.values[3] || '') === id);
  if (!registered) throw new Error('Album tidak ditemukan.');
  const folder = DriveApp.getFolderById(id);
  const parents = folder.getParents();
  if (!parents.hasNext() || parents.next().getId() !== GALLERY_DRIVE_FOLDER_ID) {
    throw new Error('Folder di luar galeri.');
  }
  return folder;
}

function galleryRowToObject_(row) {
  const v = row.values;
  const countRaw = v[6];
  return {
    id: v[0],
    nama: v[1],
    deskripsi: v[2],
    folderId: v[3],
    tanggal: v[4],
    status: v[5],
    photoCountStored: (countRaw !== undefined && countRaw !== '') ? parseInt(countRaw, 10) : null,
    thumbnailId: v[7] !== undefined ? String(v[7] || '') : ''
  };
}

function getNewsSheet_(create) { return openSheet_(INFO_SPREADSHEET_ID, NEWS_SHEET_NAME, create); }
function getVideoSheet_(create) { return openSheet_(INFO_SPREADSHEET_ID, VIDEO_SHEET_NAME, create); }
function getVideoKegiatanSheet_(create) { return openSheet_(GALLERY_SPREADSHEET_ID, VIDEO_KEGIATAN_SHEET_NAME, create); }
const _sheetMemo = {};
function openSheet_(spreadsheetId, sheetName, createIfMissing) {
  const memoKey = spreadsheetId + '|' + sheetName;
  if (_sheetMemo[memoKey] !== undefined) return _sheetMemo[memoKey];
  const ss = SpreadsheetApp.openById(spreadsheetId);
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    if (createIfMissing !== true) {
      throw new Error('Sheet "' + sheetName + '" belum ada. Jalankan setupAllSheets() satu kali di editor Apps Script.');
    }
    sheet = ss.insertSheet(sheetName);
  }
  _sheetMemo[memoKey] = sheet;
  return sheet;
}
function ensureHeader_(sheet, headers) { if (sheet.getLastRow() === 0) sheet.getRange(1,1,1,headers.length).setValues([headers]); if (sheet.getFrozenRows() === 1) return; sheet.setFrozenRows(1); sheet.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#d9ead3'); }
function getTableRows_(sheet, width, needFormulas) { const last=sheet.getLastRow(); if(last<2)return []; const range=sheet.getRange(2,1,last-1,width); const values=range.getDisplayValues(); const formulas = needFormulas === false ? null : range.getFormulas(); return values.map((v,i)=>({row:i+2,values:v,formulas:formulas?formulas[i]:null})).filter(r=>r.values[0]); }
function findTableRow_(sheet, id, width) { const rows=getTableRows_(sheet, width), index=rows.findIndex(r=>String(r.values[0])===String(id)); return index<0?null:rows[index]; }
function getVideoRows_() { return getTableRows_(getVideoSheet_(), 7, false); }
function findVideoRow_(id) { const rows=getVideoRows_(), index=rows.findIndex(r=>String(r.values[0])===String(id)); return index<0?null:rows[index]; }
function videoRowToObject_(row) { const v=row.values; const ap=String(v[6]||'').toLowerCase(); return {id:v[0],judul:v[1],deskripsi:v[2],url:v[3],tanggal:v[4],status:v[5],autoplay:ap==='ya'||ap==='true'||ap==='1',videoId:extractYoutubeId_(v[3])}; }
function getVideoKegiatanRows_() { return getTableRows_(getVideoKegiatanSheet_(), 6, false); }
function findVideoKegiatanRow_(id) { const rows=getVideoKegiatanRows_(), index=rows.findIndex(r=>String(r.values[0])===String(id)); return index<0?null:rows[index]; }
function videoKegiatanRowToObject_(row) { const v=row.values; return {id:v[0],judul:v[1],deskripsi:v[2],url:v[3],tanggal:v[4],status:v[5],videoId:extractYoutubeId_(v[3])}; }
function clearAllVideoAutoplay_(){ const sheet=getVideoSheet_(), last=sheet.getLastRow(); if(last<2) return; const n=last-1; const vals=sheet.getRange(2,7,n,1).getValues(); let dirty=false; for(let i=0;i<n;i++){ if(String(vals[i][0]).trim()!==''){ vals[i][0]=''; dirty=true; } } if(dirty) sheet.getRange(2,7,n,1).setValues(vals); }
function extractYoutubeId_(url) {
  const text = String(url || '');
  const m = text.match(/(?:youtube\.com\/(?:watch\?.*?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : '';
}
function newsRowToObject_(row) { const v=row.values, foto=extractUrl_((row.formulas && row.formulas[5]) || v[5]); const fileId=extractFileId_(foto); const cat=String(v[2]||'').trim()||'Informasi'; return {id:v[0],judul:v[1],category:cat,kategori:cat,isi:v[3],tanggal:v[4],foto:foto,imageUrl:fileId?'https://drive.google.com/thumbnail?id='+fileId+'&sz=w1200':foto,fileId:fileId,status:v[6]}; }
function isActive_(item) { return String(item.status || 'Aktif').toLowerCase() === 'aktif'; }
function nextId_(rows, prefix) { const max=rows.reduce((m,r)=>Math.max(m,parseInt(String(r[0]).replace(/\D/g,''),10)||0),0); return prefix + String(max+1).padStart(prefix ? 3 : 1, '0'); }
function saveDriveImage_(item, folderId, label) { if (!item.dataUrl) return ''; const match=String(item.dataUrl).match(/^data:([^;]+);base64,(.+)$/); if(!match) throw new Error('Format file gambar tidak valid.'); const allowed=['image/svg+xml','image/png','image/jpeg','image/webp','image/gif']; if(allowed.indexOf(match[1])<0) throw new Error('Gunakan file SVG, PNG, JPG, WebP, atau GIF.'); const safeName=sanitizeFileName_(item.fileName || label || 'foto'); const blob=Utilities.newBlob(Utilities.base64Decode(match[2]),match[1],safeName); const file=DriveApp.getFolderById(folderId).createFile(blob); file.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW); const driveUrl='https://drive.google.com/file/d/'+file.getId()+'/view?usp=drive_link'; return '=HYPERLINK("' + driveUrl + '";"' + String(label || safeName).replace(/"/g,'""') + '")'; }
function extractUrl_(value) { const text=String(value || ''); const formula=text.match(/HYPERLINK\("([^"]+)"/i); if(formula)return formula[1]; const url=text.match(/https?:\/\/[^",\s)]+/); return url?url[0]:text; }
function extractFileId_(url) { const text=String(url || ''); const byPath=text.match(/\/d\/([a-zA-Z0-9_-]+)/); if(byPath)return byPath[1]; const byId=text.match(/[?&]id=([a-zA-Z0-9_-]+)/); return byId?byId[1]:''; }
function sanitizeFileName_(name) { return String(name || 'himbauan.svg').replace(/[\\/:*?"<>|]/g,'-').slice(0,120); }
function neutralizeFormula_(value) {
  const text = String(value || '');
  return /^[=+\-@\t]/.test(text) ? "'" + text : text;
}
function sanitizeHtml_(html) {
  let text = String(html || '');
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '');
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, '');
  text = text.replace(/<embed\b[^>]*>/gi, '');
  text = text.replace(/<form\b[^>]*>[\s\S]*?<\/form>/gi, '');
  text = text.replace(/<input\b[^>]*>/gi, '');
  text = text.replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  text = text.replace(/(?:href|src|action)\s*=\s*(?:"|')?\s*(?:javascript|vbscript|data):[^"'\s>]*/gi, '');
  return text;
}
function escapeHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function today_() { return Utilities.formatDate(new Date(),Session.getScriptTimeZone() || 'Asia/Jakarta','dd/MM/yyyy'); }
function formatDate_(date) { return Utilities.formatDate(date,Session.getScriptTimeZone() || 'Asia/Jakarta','dd/MM/yyyy HH:mm'); }
function json_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }