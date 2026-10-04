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

      // ---- Operasi auth. Butuh kunci service_role yang TIDAK BOLEH ada di
      //      browser, jadi tetap lewat Apps Script yang menyimpannya di
      //      Script Properties. ----
      case 'createUser': return createSupabaseUser_(body);
      case 'updateUser': return updateSupabaseUser_(body);
      //  Sengaja TIDAK memakai updateUser - lihat catatan panjang di
      //  setPasswordUser_: payload yang hanya berisi password akan membuat
      //  role dan menu_access ikut tertimpa.
      case 'setPasswordUser': return setPasswordUser_(body);
      case 'deleteUser': return deleteSupabaseUser_(body);

      // ---- Reset password mandiri ----
      //  PENTING: tiga aksi di bawah TIDAK memanggil requireSupabaseUser_().
      //  Itu disengaja, bukan kelalaian. Saat_reset password yang diminta,
      //  orang BELUM punya sesi - itulah sebabnya dia tidak bisa login. Yang
      //  menggantikannya adalah token 256-bit yang hanya ada di emailnya.
      //
      //  Konsekuensinya, tiga aksi ini adalah satu-satunya titik masuk yang
      //  terbuka untuk siapa saja tanpa login. Pertahanannya:
      //    - token 256-bit, single-use, berlaku 60 menit
      //    - yang tersimpan di database hanya hash SHA-256-nya
      //    - cooldown 60 detik per email
      //    - jawaban "dikirim"/"tidak dikirim" selalu sama, sehingga tidak
      //      bisa dipakai menebak email mana yang terdaftar
      case 'requestPasswordReset': return requestPasswordReset_(body);
      case 'checkPasswordResetToken': return checkPasswordResetToken_(body);
      case 'resetPassword': return resetPassword_(body);

      // ---- Pemeriksaan email (Super Admin) ----
      //  Berbeda dari tiga aksi di atas, ini mengembalikan kesalahan apa adanya.
      //  Amannya tetap: butuh sesi Super Admin dan hanya mengirim ke email
      //  miliknya sendiri.
      case 'tesKirimResetEmail': return tesKirimResetEmail_(body);

      // ---- Upload foto untuk modul yang datanya ada di Supabase ----
      case 'uploadDriveImage': return uploadDriveImage_(body);

      default: throw new Error('Aksi API tidak dikenal.');
    }
  } catch (err) {
    return json_({ ok: false, message: err.message || 'Terjadi kesalahan server.' });
  }
}

// ============================================================================
//  MANAJEMEN PENGGUNA
// ============================================================================
//  Tiga operasi ini TIDAK bisa dilakukan dari browser. Membuat atau menghapus
//  akun Supabase Auth menuntut kunci service_role, sedangkan kunci itu tidak
//  boleh pernah masuk ke kode yang dikirim ke pengguna. Jadi Keyscript
//  File ini menjadi perantara: menyimpan kunci di Script Properties, memvalidasi
//  pengirim lewat token Supabase, lalu meneruskan permintaan ke Supabase
//  Admin API.
//
//  Yang BOLEH dilakukan langsung dari browser (lewat RLS):
//    - membaca daftar pengguna
//    - mengubah role, status, menu akses, nama, nomor HP
//  Yang TIDAK boleh, dan karena itu ada di file ini:
//    - membuat akun
//    - menghapus akun
//    - mengganti email / password
/**
 * Panggil Supabase lewat service_role.
 *
 * PENTING - kenapa header Prefer selalu dikirimkan:
 * ----------------------------------------------------
 * PostgREST membalas 204 No Content untuk PATCH/POST/PUT/DELETE yang tidak
 * meminta apa-apa. Bahaya itu datangnya diam-diam: pemanggil yang
 * mengharapkan baris akan menerima `{}`, dan karena `{}` itu bukan error,
 * kode lanjut ke cabang "data tidak ditemukan".
 *
 * Contoh nyata yang pernah merusak reset password:
 *
 *     const diklaim = supabaseAdmin_('patch', '/rest/v1/password_reset_tokens?...');
 *     if (!Array.isArray(diklaim) || !diklaim.length) throw new Error('token tidak berlaku');
 *
 * PATCH-nya SUKSES - token sudah ditandai terpakai di database - tapi responsnya
 * kosong, jadi kodenya melempar "token tidak berlaku". Efeknya: setiap reset
 * gagal padahal tokennya benar, DAN token yang barusan diklaim ikut hangus
 * sehingga percobaan berikutnya juga ditolak.
 *
 * `return=representation` memaksa PostgREST mengembalikan baris yang terdampak.
 * Header ini diabaikan oleh GET dan oleh DELETE yang memang tidak mengembalikan
 * apa pun, jadi aman dipasang di sini untuk semua method.
 */
function supabaseAdmin_(method, path, payload) {
  const cfg = supabaseConfig_();
  if (!cfg.url || !cfg.serviceRoleKey) {
    throw new Error('Konfigurasi Supabase belum dipasang. Jalankan setupSupabaseConfig_().');
  }
  const options = {
    method: method,
    headers: {
      apikey: cfg.serviceRoleKey,
      Authorization: 'Bearer ' + cfg.serviceRoleKey,
      'Content-Type': 'application/json',
      // Tanpa baris ini, PATCH/POST/PUT membalas 204 dengan body kosong.
      Prefer: 'return=representation'
    },
    muteHttpExceptions: true
  };
  if (payload !== undefined) options.payload = JSON.stringify(payload);
  const res = UrlFetchApp.fetch(cfg.url + path, options);
  const text = res.getContentText();
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    let msg = text;
    try { msg = JSON.parse(text).msg || JSON.parse(text).message || text; } catch (e) { /* biarkan teks */ }
    throw new Error('Supabase menolak: ' + msg);
  }
  return text ? JSON.parse(text) : {};
}

function supabaseRoleFilter_(role) {
  return ['Super Admin', 'Admin', 'Editor'].indexOf(String(role || '')) >= 0 ? role : 'Editor';
}

/**
 * Ubah apa pun yang datang dari form menjadi daftar id menu.
 *
 * BENTUK YANG HARUS DITANGANI
 * ---------------------------
 * Dua-duanya sah, dan keduanya benar-benar dipakai di proyek ini:
 *
 *   - ARRAY biasa   : dikirim index.html, hasil pengumpulan nilai checkbox
 *                     yang ber-Type String. Ini yang terjadi di produksi.
 *   - TEKS JSON     : bentuk lama, masih dipakai bila ada pemanggil lain.
 *
 * Versi sebelumnya HANYA menerima teks JSON: ia selalu menjalankan
 * JSON.parse(String(raw)). Untuk array, String(['himbauan','kas']) menjadi
 * "himbauan,kas" - yang bukan JSON, jadi JSON.parse melempar error dan catch
 * mengembalikan [].
 *
 * Akibatnya SETIAP penyimpanan pengguna Editor menghapus seluruh akses
 * menunya, tanpa error dan tanpa pesan - server tetap menjawab "Data pengguna
 * diperbarui". Kolom Akses Menu di daftar pun selalu kosong, dan itu membuat
 * gejalanya terlihat seperti fitur yang tidak bekerja, bukan bug.
 *
 * Fungsi ini sengaja tidak membuang id yang tidak dikenal. Menu yang dihapus
 * dari ALL_MENUS tapi masih tersimpan akan tetap terlihat di daftar admin,
 * sehingga bisa dibersihkan - dan bukan hilang tanpa jejak.
 */
function parseMenuAkses_(raw) {
  try {
    var daftar = raw;
    if (typeof daftar === 'string') {
      daftar = JSON.parse(daftar || '[]');
    }
    if (!Array.isArray(daftar)) return [];
    // map(String) membersihkan angka atau objek yang mungkin terkirim, filter
    // membuang string kosong dari checkbox yang nilainya kosong.
    return daftar.map(String).filter(function (id) { return id !== ''; });
  } catch (e) {
    // DIWARNINGKAN, bukan ditelan diam-diam. Kalau bentuk datanya lagi
    // berubah, ini satu-satunya tempat yang mengatakannya.
    console.warn('menuAkses tidak bisa dibaca, diisi kosong: ' + (e && e.message));
    return [];
  }
}

function createSupabaseUser_(body) {
  // Hanya Super Admin yang boleh menambah pengguna.
  const actor = requireSupabaseUser_(body.token);
  if (actor.role !== 'Super Admin') {
    throw new Error('Hanya Super Admin yang dapat menambah pengguna.');
  }

  const u = body.user || {};
  const email = String(u.email || '').trim().toLowerCase();
  const nama = String(u.nama || '').trim();
  const password = String(u.password || '');
  if (!email || email.indexOf('@') < 1) throw new Error('Email wajib diisi dengan benar.');
  if (!nama) throw new Error('Nama wajib diisi.');
  if (password.length < 8) throw new Error('Password minimal 8 karakter.');

  const role = supabaseRoleFilter_(u.role);
  const status = String(u.status || 'Aktif').toLowerCase() === 'aktif' ? 'Aktif' : 'Nonaktif';

  // Perhitung menu SEBELUM email dan profiles ditulis, supaya penyimpangan
  // ketahuan tanpa meninggalkan keadaan setengah jadi.
  //
  // Kalau form mengirim daftar yang TIDAK kosong tapi hasil bacanya kosong,
  // berarti bentuk datanya tidak seperti yang diharapkan di sini. Dulu
  // keadaan itu berakhir dengan [] yang ditulis diam-diam - semua akses menu
  // Editor hilang, dan server tetap menjawab "berhasil". Sekarang itu
  // ditolak: lebih baik Super Admin melihat error daripada akses Editor
  // hilang tanpa jejak.
  const menuAccess = parseMenuAkses_(u.menuAkses);
  if (role === 'Editor' && menuAccess.length === 0 && u.menuAkses
      && typeof u.menuAkses !== 'string' && Array.isArray(u.menuAkses)
      && u.menuAkses.length > 0) {
    throw new Error('Daftar akses menu tidak bisa dibaca, jadi tidak ada yang disimpan. '
      + 'Perubahan lain tidak disimpan.');
  }

  // 1. Buat akun di auth.users. Baris profiles dibuat otomatis oleh trigger
  //    tg_auth_user_created yang terpasang di 0002_rls.sql.
  let created;
  try {
    created = supabaseAdmin_('post', '/auth/v1/admin/users', {
      email: email,
      password: password,
      email_confirm: true,
      user_metadata: { nama: nama },
      app_metadata: { role: role, wilayah: String(u.wilayah || 'RW026') }
    });
  } catch (e) {
    if (/already|registered|exists/i.test(e.message)) {
      throw new Error('Email tersebut sudah terdaftar. Gunakan email lain.');
    }
    throw e;
  }
  if (!created || !created.id) throw new Error('Supabase tidak mengembalikan id pengguna.');

  // 2. Isi sisa kolom profiles. Kolom legacy_id dibiarkan kosong supaya
  //    trigger mengisinya dengan RW-NNNN berikutnya.
  try {
    supabaseAdmin_('patch', '/rest/v1/profiles?id=eq.' + encodeURIComponent(created.id), {
      nama: nama,
      no_hp: String(u.noHp || '') || null,
      role: role,
      wilayah: String(u.wilayah || 'RW026'),
      status: status,
      // menuAccess sudah divalidasi bentuknya di atas, jadi di sini cukup
      // memakainya - tidak ada dua tempat yang mengurai data yang sama.
      menu_access: role === 'Editor' ? menuAccess : [],
      must_change_pw: true
    });
  } catch (e) {
    // Dulu kegagalan di sini hanya ditulis ke console.warn, lalu fungsi tetap
    // menjawab "berhasil". Akibatnya akun terlihat benar padahal role,
    // status, dan menu_access-nya TIDAK tersimpan - dan yang salah itu baru
    // ketahuan saat Editor mengeluh tidak bisa membuka menu.
    //
    // Kegagalan ini tidak bisa dipulihkan sendiri: baris profiles sudah
    // dibuat oleh trigger, jadi memunculkan error membuat Super Admin tahu
    // ada yang perlu diperbaiki manual - jauh lebih baik daripada diam-diam
    // menyimpan data yang separuh.
    console.error('GAGAL menyimpan profil ' + email + ': ' + e.message);
    logActivity_(actor, 'create', 'users',
      'GAGAL menyimpan data profil ' + email + ': ' + e.message);
    throw new Error('Akun ' + email + ' dibuat, tetapi data hak aksesnya gagal disimpan: '
      + e.message + '\nPerbaiki menu akses dan status akun ini secara manual.');
  }

  logActivity_(actor, 'create', 'users', 'Menambah pengguna ' + nama + ' (' + role + ')');
  return json_({ ok: true, message: 'Pengguna berhasil ditambahkan.', userId: created.id });
}

function updateSupabaseUser_(body) {
  const actor = requireSupabaseUser_(body.token);
  if (actor.role !== 'Super Admin' && actor.role !== 'Admin') {
    throw new Error('Anda tidak memiliki akses untuk tindakan ini.');
  }

  const u = body.user || {};
  const legacyId = String(u.userId || '').trim();
  if (!legacyId) throw new Error('ID pengguna wajib diisi.');

  const cfg = supabaseConfig_();
  const found = fetchSupabaseProfileByLegacyId_(cfg, legacyId);
  if (!found) throw new Error('Pengguna tidak ditemukan.');

  const role = supabaseRoleFilter_(u.role);

  // ATURAN HAK AKSES ADMIN
  // -----------------------
  // Admin boleh mengubah APAPUN pada akun Editor - nama, email, nomor HP,
  // role, status, menu akses, semuanya.
  //
  // Admin TIDAK boleh menyentuh akun Admin lain, maupun akun Super Admin.
  //  Intinya satu kalimat: "Admin hanya mengelola Editor". Dulu aturan ini
  // hanya melarang Super Admin, jadi Admin masih bisa mengedit sesama Admin -
  // termasuk memindahkan email-nya, yang membuat akun itu tidak lagi bisa
  // masuk dengan email lamanya.
  //
  // Pemeriksaan dilakukan terhadap `found.role` (peran yang DIMILIKI akun
  // tersebut sekarang) sebelum perubahan apa pun ditulis, jadi tidak ada
  // keadaan setengah jadi kalau ditolak.
  if (actor.role === 'Admin' && found.role !== 'Editor') {
    throw new Error('Admin hanya dapat mengubah pengguna dengan peran Editor. '
      + 'Akun ' + legacyId + ' berperan ' + found.role + ', jadi hanya Super Admin yang boleh mengubahnya.');
  }

  // Admin juga tidak boleh menaikkan hak akses apa pun menjadi Super Admin,
  // termasuk akun Editor-nya sendiri.
  if (actor.role === 'Admin' && role === 'Super Admin') {
    throw new Error('Admin tidak dapat memberikan peran Super Admin.');
  }

  // Tidak boleh mengubah role sendiri - supaya tidak pernah mengunci dirinya
  // sendiri di luar portal.
  if (actor.id === found.id && role !== actor.role) {
    throw new Error('Anda tidak dapat mengubah role sendiri.');
  }

  const status = String(u.status || 'Aktif').toLowerCase() === 'aktif' ? 'Aktif' : 'Nonaktif';

  // Perhitung menu SEBELUM email dan profiles ditulis, supaya penyimpangan
  // ketahuan tanpa meninggalkan keadaan setengah jadi.
  //
  // Kalau form mengirim daftar yang TIDAK kosong tapi hasil bacanya kosong,
  // berarti bentuk datanya tidak seperti yang diharapkan di sini. Dulu
  // keadaan itu berakhir dengan [] yang ditulis diam-diam - semua akses menu
  // Editor hilang, dan server tetap menjawab "berhasil". Sekarang itu
  // ditolak: lebih baik Super Admin melihat error daripada akses Editor
  // hilang tanpa jejak.
  const menuAccess = parseMenuAkses_(u.menuAkses);
  if (role === 'Editor' && menuAccess.length === 0 && u.menuAkses
      && typeof u.menuAkses !== 'string' && Array.isArray(u.menuAkses)
      && u.menuAkses.length > 0) {
    throw new Error('Daftar akses menu tidak bisa dibaca, jadi tidak ada yang disimpan. '
      + 'Perubahan lain tidak disimpan.');
  }

  // ---------------------------------------------------------------------------
  //  EMAIL
  // ---------------------------------------------------------------------------
  //  Email TIDAK ada di tabel profiles - yang menyimpannya adalah auth.users.
  //  Dulu aksi ini sama sekali tidak membaca u.email, padahal kolomnya ada di
  //  form dan bisa diketik. Akibatnya Super Admin mengubah email, melihat
  //  "Data pengguna diperbarui", lalu emailnya tetap yang lama - dan itu
  //  lebih buruk daripada error, karena orang mengira semuanya sudah beres.
  //
  //  Urutan: Auth dulu, baru profiles. Kalau email gagal, profiles belum
  //  tersentuh, jadi tidak ada keadaan setengah jadi yang tidak diketahui.
  //
  //  Boleh oleh Super Admin, dan oleh Admin selama akun yang dituju berperan
  //  Editor - itu sudah dipastikan gate di atas. Karena itu tidak perlu
  //  pemeriksaan role tambahan di sini: kalau akunnya bukan Editor, kode sudah
  //  berhenti sebelum mencapai baris ini.
  const emailBaru = String(u.email || '').trim().toLowerCase();
  let emailBerubah = false;
  if (emailBaru) {
    if (emailBaru.indexOf('@') < 1) {
      throw new Error('Format email tidak benar. Perubahan lain tidak disimpan.');
    }
    const emailLama = ambilEmailUser_(cfg, found.id);
    if (emailLama && emailLama.toLowerCase() !== emailBaru) {
      try {
        // email_confirm: true karena inilah yang membuat orang bisa langsung
        // login dengan email baru. Tanpa itu email baru harus dikonfirmasi
        // dulu dan akun terkunci sampai tautan konfirmasi clicked.
        supabaseAdmin_('put', '/auth/v1/admin/users/' + encodeURIComponent(found.id), {
          email: emailBaru,
          email_confirm: true
        });
        emailBerubah = true;
      } catch (e) {
        throw new Error('Gagal mengubah email: ' + e.message
          + '\nPerubahan lain tidak disimpan.');
      }
    }
  }

  const terpakai = supabaseAdmin_('patch', '/rest/v1/profiles?id=eq.' + encodeURIComponent(found.id), {
    nama: String(u.nama || found.nama).trim(),
    no_hp: String(u.noHp || '') || null,
    role: role,
    wilayah: String(u.wilayah || found.wilayah || 'RW026'),
    status: status,
    menu_access: role === 'Editor' ? menuAccess : []
  });

  // PATCH yang tidak menyentuh satu baris pun TETAP membalas 200. Tanpa
  // pemeriksaan ini, filter yang salah ketemu (mis. id-nya berubah format)
  // akan terlihat sebagai "berhasil" padahal tidak ada yang berubah - pola
  // kegagalan senyap yang sama seperti kasus email di atas.
  if (!Array.isArray(terpakai) || !terpakai.length) {
    throw new Error('Tidak ada baris profil ' + legacyId + ' yang diperbarui. '
      + 'Data tidak berubah.'
      + (emailBerubah ? '\nNB: email sudah berhasil diubah.' : ''));
  }

  if (u.password) {
    if (String(u.password).length < 8) throw new Error('Password minimal 8 karakter.');
    supabaseAdmin_('put', '/auth/v1/admin/users/' + encodeURIComponent(found.id), {
      password: String(u.password)
    });
  }

  logActivity_(actor, 'update', 'users', 'Memperbarui pengguna ' + legacyId
    + (emailBerubah ? ' (email diubah)' : ''));
  return json_({
    ok: true,
    message: 'Data pengguna diperbarui.',
    emailDiubah: emailBerubah
  });
}

/**
 * Super Admin menetapkan password seorang pengguna secara langsung.
 *
 * KAPAN DIPAKAI
 * -------------
 * User tidak bisa login sama sekali, jadi alur tautan reset dari email tidak
 * bisa menjadi jalan: kalau dia tidak bisa masuk, kemungkinan besar
 * dia juga tidak punya akses ke mailbox-nya. Dalam keadaan itu satu-satunya
 * jalan adalah Super Admin yang mengaturnya dari sini.
 *
 * Kenapa bukan memakai updateUser
 * ------------------------------
 * updateSupabaseUser_ menulis SELURUH kolom profil dari payload: nama, no_hp,
 * role, wilayah, status, menu_access. Kalau aksi ini mengirim payload yang
 * hanya berisi userId + password, dua hal rusak diam-diam:
 *
 *   1. role. supabaseRoleFilter_(undefined) mengembalikan 'Editor', jadi
 *      setiap Super Admin/Admin yang Password-nya diganti akan SENYAP turun
 *      menjadi Editor.
 *   2. menu_access. Kalau role-nya tidak ikut dikirim, daftar menu ikut
 *      dikosongkan.
 *
 * Jadi aksi ini SENGAJA terpisah: hanya menyentuh password di Supabase Auth
 * dan satu flag di profiles. Tidak ada kolom lain yang bisa tersentuh, jadi
 * tidak mungkin ada efek samping di luar yang terlihat di form.
 *
 * Yang juga diurus di sini: turunkan must_change_pw.
 *
 * Tanpa itu, password yang baru ditetapkan TIDAK akan membuat orang itu bisa
 * masuk. rw26-api.js akan mengarahkan dia ke update-password.html setiap kali
 * login - dan di sana ia butuh tautan reset yang tidak pernah dia terima.
 * Persis jebakan yang membuat user "nyangkut" sejak awal.
 */
function setPasswordUser_(body) {
  const actor = requireSupabaseUser_(body.token);
  if (actor.role !== 'Super Admin') {
    throw new Error('Hanya Super Admin yang dapat mengatur password pengguna lain.');
  }

  const u = body.user || {};
  const legacyId = String(u.userId || '').trim();
  const password = String(u.password || '');
  if (!legacyId) throw new Error('ID pengguna wajib diisi.');
  if (password.length < 8) throw new Error('Password minimal 8 karakter.');

  const cfg = supabaseConfig_();
  const found = fetchSupabaseProfileByLegacyId_(cfg, legacyId);
  if (!found) throw new Error('Pengguna tidak ditemukan.');

  // Email ikut dikembalikan supaya Super Admin bisa menyalinnya danzt memberitahu
  // ke yang bersangkutan. Tanpa ini, orang biasanya tidak tahu email mana
  // yang dipakai untuk login - login hanya menerima email, bukan User ID
  // (lihat 0008_login_dengan_user_id.sql).
  const email = ambilEmailUser_(cfg, found.id);
  if (!email) {
    throw new Error('Email pengguna ' + legacyId + ' tidak terbaca. Password tidak diubah.');
  }

  // Tulis password ke Supabase Auth.
  supabaseAdmin_('put', '/auth/v1/admin/users/' + encodeURIComponent(found.id), {
    password: password
  });

  // Naikkan penanda login pertama. Tanpa langkah ini akun yang tadinya
  // `must_change_pw = true` akan terus diarahkan ke halaman ganti password.
  try {
    supabaseAdmin_('patch', '/rest/v1/profiles?id=eq.' + encodeURIComponent(found.id), {
      must_change_pw: false
    });
  } catch (e) {
    // Password SUDAH terganti di sini. Melempar error tanpa penjelasan akan
    // membuat Super Admin mengira seluruhnya gagal lalu mengulangi - padahal
    // mengulangi aman. Pesannya harus jujur soal apa yang sudah berhasil.
    console.error('GAGAL menurunkan must_change_pw untuk ' + legacyId + ': ' + e.message);
    throw new Error('Password untuk ' + legacyId + ' sudah diganti, tetapi penanda "login pertama" '
      + 'belum turun. Pengguna akan diminta mengganti password lagi di login berikutnya. '
      + 'Hubungi Super Admin lain atau perbaiki manual di database. '
      + 'Detail: ' + e.message);
  }

  logActivity_(actor, 'update', 'users', 'Super Admin menetapkan password ' + legacyId + ' (' + email + ')');
  return json_({
    ok: true,
    message: 'Password ' + legacyId + ' berhasil diganti.',
    email: email
  });
}

/**
 * Hapus sebuah akun.
 *
 * HAK AKSES
 * ---------
 * Super Admin : boleh menghapus siapa pun, kecuali dirinya sendiri dan kecuali
 *               akun Super Admin lain (yang hanya bisa dinonaktifkan).
 * Admin       : boleh menghapus akun berperan EDITOR saja.
 *
 * Aturan Admin ini sengaja sama dengan aturan edit-nya: "Admin hanya mengelola
 * Editor". Kalau hapus boleh untuk semua role sementara edit tidak, Admin bisa
 * menentukan siapa yang boleh kehilangan akses lewat jalur yang lebih kasar -
 * menghapus Akun Editor, lalu membuat ulang dengan email yang sama untuk
 * mengambil alihnya.
 *
 * Karena itu pemeriksaan dilakukan terhadap `found.role` -
 * peran yang DIMILIKI akun tersebut sekarang - dan selesai sebelum ada satu
 * pun penulisan. Kalau ditolak, tidak ada keadaan setengah jadi.
 */
function deleteSupabaseUser_(body) {
  const actor = requireSupabaseUser_(body.token);
  if (actor.role !== 'Super Admin' && actor.role !== 'Admin') {
    throw new Error('Anda tidak memiliki akses untuk tindakan ini.');
  }

  const legacyId = String(body.userId || '').trim();
  if (!legacyId) throw new Error('ID pengguna wajib diisi.');

  const cfg = supabaseConfig_();
  const found = fetchSupabaseProfileByLegacyId_(cfg, legacyId);
  if (!found) throw new Error('Pengguna tidak ditemukan.');
  if (found.id === actor.id) throw new Error('Anda tidak dapat menghapus akun sendiri.');
  if (found.role === 'Super Admin') {
    throw new Error('Pengguna Super Admin hanya dapat dinonaktifkan, tidak dihapus.');
  }
  if (actor.role === 'Admin' && found.role !== 'Editor') {
    // Pakai legacyId dari body, bukan found.legacy_id: nilainya sudah
    // divalidasi di atas, dan pesan error tidak boleh menampilkan "undefined"
    // kalau suatu saat kolomnya ternyata tidak ikut terpilih.
    throw new Error('Admin hanya dapat menghapus pengguna dengan peran Editor. '
      + 'Akun ' + legacyId + ' berperan ' + found.role + ', jadi hanya Super Admin yang boleh menghapusnya.');
  }

  // Hapus dari auth.users lebih dulu. Baris profiles ikut terhapus karena
  // kolomnya memakai ON DELETE CASCADE.
  //
  // Tindakan ini tidak bisa dibatalkan: tidak ada tempat untuk memulihkannya, dan
  // jejak activity_log tetap ada meski akunnya hilang.
  supabaseAdmin_('delete', '/auth/v1/admin/users/' + encodeURIComponent(found.id));

  logActivity_(actor, 'delete', 'users', 'Menghapus pengguna ' + legacyId + ' (' + found.role + ')');
  return json_({ ok: true, message: 'Pengguna ' + legacyId + ' berhasil dihapus.' });
}

function fetchSupabaseProfileByLegacyId_(cfg, legacyId) {
  const url = cfg.url + '/rest/v1/profiles'
    + '?select=id,legacy_id,nama,role,status,wilayah,menu_access'
    + '&legacy_id=eq.' + encodeURIComponent(legacyId);
  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { apikey: cfg.serviceRoleKey, Authorization: 'Bearer ' + cfg.serviceRoleKey },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) return null;
  const rows = JSON.parse(res.getContentText());
  return (Array.isArray(rows) && rows.length) ? rows[0] : null;
}

// ============================================================================
//  RESET PASSWORD MANDIRI
// ============================================================================
//  Alurnya, dari samping:
//    1. Halaman login memanggil requestPasswordReset.
//    2. Kode menerbitkan token 256-bit, menyimpan HASH-nya ke
//       public.password_reset_tokens, lalu mengirim tautannya lewat MailApp
//       (Gmail milik pemilik proyek Apps Script).
//    3. Tautan membuka update-password.html?token=... yang memanggil
//       checkPasswordResetToken, lalu resetPassword saat formulir dikirim.
//
//  Kenapa tidak pakai supabase.auth.resetPasswordForEmail?
//  ------------------------------------------------------------
//  Email Supabase berisi tautan ke Site URL proyek. Kalau Site URL itu tidak
//  sesuai dengan domain yang sedang dipakai, tautannya mendarat di localhost
//  dan tidak bisa dibuka - persis keluhan yang terjadi. Dengan tautan yang
//  dibuat sendiri, alamat tujuannya kita yang menentukan.
//
//  Supabase Auth tetap menjadi penyimpan password. Yang diganti hanya cara
//  link dibuat dan dikirim.
//
//  TIGA ATURAN YANG TIDAK BOLEH DILEWATI
//  --------------------------------------
//  1. Jawabannya SELALU sama, apa pun hasilnya. Kalau "tidak terdaftar"
//     dibedakan dari "terkirim", form ini jadi alat menebak email mana yang
//     punya akun.
//  2. Alamat dasar tautan TIDAK boleh diambil dari permintaan. Kalau berasal
//     dari body, penyerang bisa mengirim permintaan atas nama korban dengan
//     alamat domain miliknya, sehingga korban menerima tautan ke situs
//     penyerang. Karena itu alamatnya dibaca dari Script Property.
//  3. Kegagalan mengirim TIDAK boleh dilaporkan sebagai error. Kalau MailApp
//     kehabisan kuota dan itu muncul sebagai pesan gagal, keadaan kuota yang
//     habis berubah jadi oracle: email terdaftar (gagal kirim) bisa
//     dibedakan dari email tidak terdaftar (berhasil diam-diam).
//     Kegagalan dicatat ke log eksekusi, yang hanya dilihat admin.
// ============================================================================

const RESET_TOKEN_MENIT = 60;
const RESET_COOLDOWN_DETIK = 60;
const RESET_PANGKAS_HARI = 7;
const RESET_SENDER_NAMA = 'RW 26 Pengasinan Rawalumbu';

// Pesan yang sama persis untuk email terdaftar, tidak terdaftar, nonaktif,
// cooldown, dan email saat kuota MailApp habis.
function pesanResetUmum_() {
  return 'Jika email tersebut terdaftar, link reset password sudah kami kirim. '
    + 'Periksa juga folder spam sebelum mencari-cari email lain.';
}

/**
 * Alamat dasar portal, untuk menyusun tautan di dalam email.
 *
 * Dibaca dari Script Property PUBLIC_BASE_URL. Kalau kosong, memakai domain
 * produksi sebagai cadangan - supaya portal tetap berfungsi kalau property-nya
 * lupa dipasang. Yang penting bukan diambil dari permintaan.
 */
function publicBaseUrl_() {
  const props = PropertiesService.getScriptProperties();
  const tersimpan = String(props.getProperty('PUBLIC_BASE_URL') || '').trim().replace(/\/+$/, '');
  return tersimpan || 'https://mgt.rw026.my.id';
}

/** 256 bit acak: dua UUID tanpa tanda hubung, jadi 64 karakter heksadesimal. */
function tokenResetAcak_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

/**
 * Hash SHA-256 dari token, dalam bentuk heksadesimal.
 *
 * Bentuk heksadesimal dipilih supaya aman dipakai langsung di query string
 * PostgREST. base64 bisa memuat '+', '/', dan '=' yang harus di-encode, dan
 * satu karakter yang lupa di-encode akan membuat query gagal diam-diam.
 *
 * Perbandingan token SELALU dilakukan lewat kolom token_hash, bukan dengan
 * membandingkan string di JavaScript - yang dibandingkan hanya hash-nya.
 */
function hashToken_(token) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, String(token), Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    // computeDigest bisa mengembalikan byte negatif; & 0xff mengembalikannya
    // ke 0..255 sebelum jadi dua digit heksa.
    return ('0' + (b & 0xff).toString(16)).slice(-2);
  }).join('');
}

/** Panggil fungsi PostgreSQL lewat PostgREST, memakai kunci service_role. */
function supabaseRpc_(cfg, namaFungsi, argumen) {
  const res = UrlFetchApp.fetch(cfg.url + '/rest/v1/rpc/' + encodeURIComponent(namaFungsi), {
    method: 'post',
    headers: {
      apikey: cfg.serviceRoleKey,
      Authorization: 'Bearer ' + cfg.serviceRoleKey,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(argumen || {}),
    muteHttpExceptions: true
  });
  const teks = res.getContentText();
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    throw new Error('Supabase menolak RPC ' + namaFungsi + ': ' + String(teks).slice(0, 200));
  }
  // Fungsi yang mengembalikan skalar dikirim PostgREST apa adanya (mis. "null"
  // atau "\"uuid\""), bukan array. Nilai kosong berarti tidak ketemu - itu
  // jawaban yang sah, bukan kegagalan.
  if (!teks || teks === 'null') return null;
  try { return JSON.parse(teks); } catch (e) { return teks; }
}

/** Ambil email pemilik akun dari Supabase Auth. */
function ambilEmailUser_(cfg, userId) {
  try {
    const u = supabaseAdmin_('get', '/auth/v1/admin/users/' + encodeURIComponent(userId));
    return (u && u.email) ? String(u.email) : '';
  } catch (e) {
    console.warn('ambilEmailUser gagal untuk ' + userId + ': ' + e.message);
    return '';
  }
}

/**
 * Minta link reset. Dijawab dengan pesan yang sama apa pun hasilnya.
 */
function requestPasswordReset_(body) {
  const email = String(body.email || '').trim().toLowerCase();

  // Bentuk email tidak benar. Tetap dijawab dengan pesan yang sama supaya
  // bentuk input juga tidak menambah informasi apa pun.
  if (!email || email.indexOf('@') < 1) return json_({ ok: true, message: pesanResetUmum_() });

  // Cooldown per email, 60 detik. Tanpa ini, form ini bisa dipakai untuk
  // membanjiri kotak masuk orang dan menghabiskan kuota MailApp.
  const kunciCooldown = 'rst_cd_' + hashToken_(email);
  if (cacheGet_(kunciCooldown) !== undefined) {
    return json_({ ok: true, message: pesanResetUmum_() });
  }
  cacheSet_(kunciCooldown, '1', RESET_COOLDOWN_DETIK);

  const cfg = supabaseConfig_();
  if (!cfg.url || !cfg.serviceRoleKey) {
    throw new Error('Konfigurasi Supabase belum dipasang. Jalankan setupSupabaseConfig_().');
  }

  // Pangkas token lama. Dilakukan SETELAH diketahui emailnya terdaftar, jadi
  // permintaan untuk email yang tidak dikenal tidak menyentuh tabel ini.
  //
  // Email tidak ada, atau akunnya sudah dinonaktifkan. Fungsi
  // cari_user_id_by_email sengaja tidak membedakan keduanya, dan jawaban
  // ke peramban tetap sama.
  let userId = null;
  try {
    userId = supabaseRpc_(cfg, 'cari_user_id_by_email', { p_email: email }) || null;
  } catch (e) {
    console.warn('cari_user_id_by_email gagal: ' + e.message);
  }
  if (!userId) {
    // Sengaja TIDAK menulis ke activity_log.
    //
    // Aksi ini terbuka tanpa login, jadi siapa pun bisa memanggilnya dengan
    // email sembarang. Kalau setiap permintaan menulis satu baris, penyerang
    // bisa mengisi activity_log dengan sampah - dan tabel itu tidak pernah
    // dipangkas (dulu dipangkas jadi 101 baris terakhir, sekarang tidak).
    // Catatan cukup di log eksekusi, yang hanya bisa dilihat admin.
    console.warn('Permintaan reset untuk email yang tidak terdaftar atau nonaktif.');
    return json_({ ok: true, message: pesanResetUmum_() });
  }

  try {
    const batas = new Date(Date.now() - RESET_PANGKAS_HARI * 86400000).toISOString();
    supabaseAdmin_('delete', '/rest/v1/password_reset_tokens?tanggal_dibuat=lt.' + encodeURIComponent(batas));
  } catch (e) {
    console.warn('pangkas token lama gagal: ' + e.message);
  }

  // Batalkan token yang masih hidup milik user ini. Satu permintaan terbaru
  // saja yang berlaku; permintaan berikutnya menggantikan yang lama.
  try {
    supabaseAdmin_('patch',
      '/rest/v1/password_reset_tokens?user_id=eq.' + encodeURIComponent(userId) + '&tanggal_dipakai=is.null',
      { tanggal_dipakai: new Date().toISOString() });
  } catch (e) {
    console.warn('pembatalan token lama gagal untuk ' + userId + ': ' + e.message);
  }

  // Terbitkan token baru. Yang tersimpan hanya hash-nya.
  const token = tokenResetAcak_();
  const kedaluwarsa = new Date(Date.now() + RESET_TOKEN_MENIT * 60000).toISOString();
  supabaseAdmin_('post', '/rest/v1/password_reset_tokens', {
    user_id: userId,
    token_hash: hashToken_(token),
    tanggal_kedaluwarsa: kedaluwarsa
  });

  const link = publicBaseUrl_() + '/update-password.html?token=' + encodeURIComponent(token);

  let terkirim = false;
  try {
    kirimResetEmail_(email, link, kedaluwarsa);
    terkirim = true;
  } catch (e) {
    // Sengaja ditelan UNTUK PERAMBAN. Lihat aturan ke-3 di kepala modul ini:
    // menampilkan kegagalan kirim akan membedakan email terdaftar dari tidak
    // terdaftar, tepat ketika kuota MailApp sedang habis.
    //
    // Dicatat ke activity_log supaya Super Admin bisa melihat penyebabnya di
// portal. Tanpa ini, kegagalan MailApp tidak bisa dibedakan dari "email
    // masuk spam" hanya dari sisi server - dan satu-satunya cara yang tersisa
    // adalah menebak. activity_log hanya bisa dibaca Super Admin dan hanya
    // tertulis bila emailnya memang terdaftar, jadi ini tidak menambah
    // informasi apa pun ke penyerang.
    //
    // Alasan yang paling sering muncul di sini:
    //   - "Daily quota exceeded"  -> kuota MailApp akun habis (100/hari
    //                                untuk @gmail.com biasa, 1500/hari untuk
    //                                Google Workspace)
    //   - "Authorization is required to perform that action"
    //                              -> proyek Apps Script belum pernah di-Run
    //                                 di editor setelah MailApp ditambahkan,
    //                                 sehingga scope script.send_mail belum
    //                                 diotorisasi. Perbaiki dari editor.
    const alasan = String((e && e.message) || e);
    console.error('GAGAL KIRIM reset ke ' + email + ' (token tetap berlaku): ' + alasan);
    logActivity_(null, 'reset', 'users', 'GAGAL KIRIM link reset ke ' + email + ' - ' + alasan);

    // Cooldown dilepas supaya orang bisa langsung mencoba lagi, bukan menunggu
    // 60 detik untuk jawaban "sudah kami kirim" yang tetap salah. Tanpa ini,
    // satu kegagalan membuat dua percobaan berikutnya ditolak diam-diam.
    try { CacheService.getScriptCache().remove(kunciCooldown); } catch (e2) {
      console.warn('pelepasan cooldown gagal: ' + e2.message);
    }
  }

  logActivity_(null, 'reset', 'users', (terkirim ? 'Mengirim' : 'Meminta')
    + ' link reset password ke ' + email);
  return json_({ ok: true, message: pesanResetUmum_() });
}

/**
 * Coba kirim satu email percobaan dan laporkan hasilnya apa adanya.
 *
 * Hanya untuk Super Admin, dan hanya ke email miliknya sendiri. Tujuannya
 * menjawab satu pertanyaan yang tidak bisa dijawab alur reset biasa: apakah
 * MailApp benar-benar bisa mengirim, atau gagal karena kuota harian habis /
 * scope script.send_mail belum diotorisasi.
 *
 * Kenapa galat di sini boleh dikembalikan, sedangkan di requestPasswordReset_
 * tidak: pemanggilnya Super Admin yang sudah login dan alamatnya adalah
 * alamatnya sendiri. Tidak ada informasi soal email warga lain yang bisa
 * bocor. Alur reset email warga sendiri tetap dijawab "dikirim" apa pun
 * hasilnya.
 */
function tesKirimResetEmail_(body) {
  // body undefined HANYA kalau fungsi ini dijalankan dari tombol Run di editor
  // Apps Script (editor tidak mengirim argumen). Tanpa guard di sini hasilnya
  // TypeError yang tidak menjelaskan apa pun.
  const b = body || {};
  const actor = requireSupabaseUser_(b.token);
  if (actor.role !== 'Super Admin') {
    throw new Error('Hanya Super Admin yang dapat menjalankan pemeriksaan ini.');
  }
  const email = String((actor && actor.email) || '').trim();
  if (!email) throw new Error('Email akun ini tidak terbaca.');

  const kedaluwarsa = new Date(Date.now() + RESET_TOKEN_MENIT * 60000).toISOString();

  // PENTING: email uji TIDAK memakai tautan reset sungguhan.
  //
  // Token di bawah ini tidak pernah dimasukkan ke password_reset_tokens, jadi
  // kalau tautannya diklik, checkPasswordResetToken_ pasti menolaknya dengan
  // "Token Tidak Valid". Itu bukan bug - itu konsekuensi token palsu, dan
  // persis membingungkan orang yang sedang mencari tahu apakah alurnya rusak.
  //
  // Karena itu email uji sengaja dibuat terlihat berbeda: subjeknya ditandai,
  // dan isinya mengatakan terus terang bahwa tautannya tidak berlaku. Email
  // ini hanya membuktikan MailApp bisa mengirim - tidak untuk dicoba dipakai.
  try {
    kirimEmailUji_(email);
    return json_({ ok: true, message: 'Email PERCOBAAN terkirim ke ' + email
      + '. Email ini bukan permintaan reset - tombolnya sengaja tidak berlaku. '
      + 'Cek folder spam. Untuk menguji alur sebenarnya, minta link reset dari halaman login.' });
  } catch (e) {
    throw new Error('Gagal mengirim: ' + (e && e.message ? e.message : String(e)));
  }
}

/**
 * Email percobaan. Sengaja TIDAK memakai emailResetHtml_ dan tidak memuat
 * tautan reset, supaya mustahil disalahartikan sebagai link yang bisa dipakai.
 */
function kirimEmailUji_(email) {
  MailApp.sendEmail({
    to: email,
    subject: '[PERCOBAAN] Tes kirim email - Portal RW 26 (abaikan)',
    body: 'Ini email percobaan otomatis, BUKAN permintaan ganti password.\n\n'
      + 'Tujuannya hanya memeriksa apakah server able mengirim email.\n'
      + 'Tidak ada yang perlu Anda lakukan, dan tidak ada tautan yang bisa dipakai di sini.\n\n'
      + 'Kalau Anda menerima email seperti ini tanpa memintanya, abaikan saja.',
    name: RESET_SENDER_NAMA
  });
}

/**
 * Cek apakah MailApp benar-benar bisa mengirim, TANPA login dan TANPA token.
 *
 * Fungsi ini sengaja dibuat bisa dijalankan langsung dari editor Apps Script
 * (pilih di dropdown fungsi, lalu klik Run). Tujuannya satu: melihat
 * kesalahan MailApp apa adanya di layar, karena alur reset password memang
 * tidak boleh membocorkan kegagalan itu ke pemanggil.
 *
 * Email tujuan dibaca dari Script Property UJI_EMAIL. Kalau kosong, memakai
 * email pemilik proyek Apps Script.
 */
function ujiKirimEmail() {
  const props = PropertiesService.getScriptProperties();
  const ke = String(props.getProperty('UJI_EMAIL') || '').trim()
    || String(Session.getEffectiveUser().getEmail() || '').trim();
  if (!ke) {
    throw new Error('Email tujuan kosong. Isi Script Property UJI_EMAIL, atau jalankan dari akun Gmail.');
  }

  // Email uji TIDAK memuat tautan reset. Token percobaan tidak pernah masuk
  // password_reset_tokens, jadi tautannya pasti ditolak dengan "Token Tidak
  // Valid" - dan itu terlihat seperti alur reset rusak padahal tidak. Email
  // uji hanya boleh membuktikan satu hal: MailApp bisa mengirim.
  try {
    kirimEmailUji_(ke);
    Logger.log('BERHASIL: email percobaan terkirim ke ' + ke);
    return 'BERHASIL: email percobaan terkirim ke ' + ke
      + '. Periksa kotak masuk dan folder spam. Ini email PERCOBAAN, bukan permintaan reset.';
  } catch (e) {
    const pesan = String((e && e.message) || e);
    // Ditampilkan apa adanya, ini memang tujuannya.
    Logger.log('GAGAL: ' + pesan);
    throw new Error('GAGAL kirim ke ' + ke + ': ' + pesan);
  }
}

/**
 * Periksa apakah alur reset bisa bekerja dari ujung ke ujung, TANPA mengirim
 * email dan TANPA mengubah password siapa pun.
 *
 * Jalankan dari editor Apps Script (pilih di dropdown, klik Run), dengan
 * Script Property UJI_EMAIL diisi email yangDIETAHUI terdaftar.
 *
 * Yang diperiksa satu per satu, dengan alasan kalau gagal:
 *   1. apakah email itu terdaftar dan aktif (RPC cari_user_id_by_email)
 *   2. apakah token bisa diterbitkan ke database
 *   3. apakah token itu bisa dibaca kembali lewat checkPasswordResetToken_
 *   4. apakah tabelnya bisa ditulis sama sekali
 *
 * Token yang diterbitkan di sini langsung dibatalkan lagi di akhir, supaya
 * tidak meninggalkan token hidup yang tidak diketahui pemiliknya.
 */
function ujiAlurReset() {
  const props = PropertiesService.getScriptProperties();
  const email = String(props.getProperty('UJI_EMAIL') || '').trim().toLowerCase();
  if (!email) {
    throw new Error('Isi Script Property UJI_EMAIL dengan email yang terdaftar, lalu jalankan lagi.');
  }

  const cfg = supabaseConfig_();
  if (!cfg.url || !cfg.serviceRoleKey) {
    throw new Error('Konfigurasi Supabase belum dipasang. Jalankan setupSupabaseConfig_().');
  }

  // 1. Email terdaftar?
  let userId = null;
  try {
    userId = supabaseRpc_(cfg, 'cari_user_id_by_email', { p_email: email }) || null;
  } catch (e) {
    throw new Error('LANGKAH 1 GAGAL - RPC cari_user_id_by_email: ' + e.message
      + '\nKemungkinan migrasi 0009_reset_password_sendiri.sql belum dijalankan di database.');
  }
  if (!userId) {
    throw new Error('LANGKAH 1 GAGAL - email "' + email + '" tidak terdaftar atau statusnya bukan Aktif.\n'
      + 'Cocokkan email ini dengan yang tertera di auth.users. Password residents tidak tersimpan di tabel profiles.');
  }
  Logger.log('Langkah 1 OK: email terdaftar, user_id=' + userId);

  // 2. Terbitkan token.
  const token = tokenResetAcak_();
  const kedaluwarsa = new Date(Date.now() + RESET_TOKEN_MENIT * 60000).toISOString();
  let baris = null;
  try {
    baris = supabaseAdmin_('post', '/rest/v1/password_reset_tokens?select=id', {
      user_id: userId,
      token_hash: hashToken_(token),
      tanggal_kedaluwarsa: kedaluwarsa
    });
  } catch (e) {
    throw new Error('LANGKAH 2 GAGAL - tidak bisa menulis ke password_reset_tokens: ' + e.message
      + '\nKemungkinan tabelnya belum ada, atau GRANT untuk service_role belum dijalankan.');
  }
  Logger.log('Langkah 2 OK: token diterbitkan');

  try {
    // 3. Token bisa dibaca kembali? Ini persis jalur yang dipakai update-password.html.
    const rows = supabaseAdmin_('get',
      '/rest/v1/password_reset_tokens?select=user_id,tanggal_kedaluwarsa'
      + '&token_hash=eq.' + encodeURIComponent(hashToken_(token))
      + '&tanggal_dipakai=is.null'
      + '&tanggal_kedaluwarsa=gt.' + encodeURIComponent(new Date().toISOString()));

    if (!Array.isArray(rows) || !rows.length) {
      throw new Error('LANGKAH 3 GAGAL - token baru diterbitkan tapi tidak bisa dibaca kembali.\n'
        + 'Ini berarti hash atau filter tanggalnya tidak cocok - alur reset akan selalu gagal.');
    }
    Logger.log('Langkah 3 OK: token bisa dibaca kembali');
    Logger.log('Hash token (64 hex, cocok dengan yang tersimpan): ' + hashToken_(token));
  } finally {
    // 4. Batalkan token uji, apa pun hasilnya.
    try {
      supabaseAdmin_('patch',
        '/rest/v1/password_reset_tokens?token_hash=eq.' + encodeURIComponent(hashToken_(token)),
        { tanggal_dipakai: new Date().toISOString() });
      Logger.log('Token uji sudah dibatalkan.');
    } catch (e) {
      Logger.log('PERINGATAN: token uji gagal dibatalkan: ' + e.message);
    }
  }

  return 'ALUR RESET SEHAT.\n'
    + 'Token bisa diterbitkan, dibaca, dan dibatalkan.\n'
    + 'Kalau reset dari halaman login tetap gagal, masalahnya ada di sisi penyampaian email '
    + '(spam/quota), bukan di token.';
}

/** Periksa token sebelum menampilkan formulir password baru. */
function checkPasswordResetToken_(body) {
  const token = String(body.token || '').trim();
  if (!token) throw new Error('Token reset tidak ditemukan di tautan.');

  const cfg = supabaseConfig_();
  if (!cfg.url || !cfg.serviceRoleKey) {
    throw new Error('Konfigurasi Supabase belum dipasang. Jalankan setupSupabaseConfig_().');
  }

  const sekarang = new Date().toISOString();
  const rows = supabaseAdmin_('get',
    '/rest/v1/password_reset_tokens?select=user_id,tanggal_kedaluwarsa'
    + '&token_hash=eq.' + encodeURIComponent(hashToken_(token))
    + '&tanggal_dipakai=is.null'
    + '&tanggal_kedaluwarsa=gt.' + encodeURIComponent(sekarang));

  const baris = (Array.isArray(rows) && rows.length) ? rows[0] : null;
  if (!baris) {
    throw new Error('Tautan reset sudah tidak berlaku. Minta link baru dari halaman login.');
  }

  return json_({
    ok: true,
    email: ambilEmailUser_(cfg, baris.user_id),
    kedaluwarsa: baris.tanggal_kedaluwarsa
  });
}

/**
 * Ganti password memakai token, lalu matikan tokennya.
 *
 * Token diklaim DULU, baru password diganti. Urutan itu yang membuat token
 * hanya bisa dipakai sekali: klaimnya berupa UPDATE berkondisi
 * `tanggal_dipakai IS NULL`, jadi permintaan kedua tidak menemukan baris
 * untuk diambil dan langsung ditolak.
 */
function resetPassword_(body) {
  const token = String(body.token || '').trim();
  const password = String(body.newPassword || '');
  if (!token) throw new Error('Token reset tidak ditemukan di tautan.');
  if (password.length < 8) throw new Error('Password baru minimal 8 karakter.');

  const cfg = supabaseConfig_();
  if (!cfg.url || !cfg.serviceRoleKey) {
    throw new Error('Konfigurasi Supabase belum dipasang. Jalankan setupSupabaseConfig_().');
  }

  // Klaim token. Nol baris terpakai berarti token sudah dipakai atau sudah
  // kedaluwarsa.
  const sekarang = new Date().toISOString();
  const diklaim = supabaseAdmin_('patch',
    // id ikut diminta karena baris hasil klaim dikembalikan ke pemanggil
    // (dipakai untuk membatalkan klaim bila ada masalah setelahnya).
    '/rest/v1/password_reset_tokens?select=id,user_id'
    + '&token_hash=eq.' + encodeURIComponent(hashToken_(token))
    + '&tanggal_dipakai=is.null'
    + '&tanggal_kedaluwarsa=gt.' + encodeURIComponent(sekarang),
    { tanggal_dipakai: sekarang });

  const baris = (Array.isArray(diklaim) && diklaim.length) ? diklaim[0] : null;
  if (!baris) {
    throw new Error('Tautan reset sudah tidak berlaku. Minta link baru dari halaman login.');
  }
  const userId = baris.user_id;

/**
   * Kembalikan klaim token kalau ada masalah setelahnya.
   *
   * Dipakai sedemikian rupa karena ada dua jenis kegagalan yang harus dibedakan
   * oleh pemanggil:
   *
   *   - "password gagal diganti" -> kembalikan klaimnya, supaya orang yang
   *     benar-benar punya akses ke mailbox tidak kehilangan haknya karena
   *     masalah server.
   *   - "respons server tidak seperti yang diharapkan" -> token SUDAH tercatat
   *     terpakai di database, padahal kodenya belum sempat mengganti password.
   *     Kalau dibiarkan begitu, orang tersebut tidak bisa lagi memakai tautan
   *     yang sama dan harus meminta link baru.
   *
   * Baris `id` dibutuhkan di sini, jadi select harus menyertakannya. Itu
   * bergantung pada PostgREST mengembalikan baris yang terpengaruh, lewat
   * `Prefer: return=representation` di supabaseAdmin_.
   */
  const kembalikanKlaim = function (alasan) {
    try {
      supabaseAdmin_('patch', '/rest/v1/password_reset_tokens?id=eq.' + encodeURIComponent(baris.id),
        { tanggal_dipakai: null });
    } catch (e2) {
      console.error('GAGAL membatalkan klaim token untuk ' + userId + ': ' + e2.message);
    }
    console.error('Klaim token dikembalikan untuk ' + userId + ': ' + alasan);
  };

  // Yakin baris yang diklaim benar-benar punya id. Tanpa ini, kembalikanKlaim
  // akan memakai `undefined` dan membatalkan klaim baris yang SALAH - atau
  // tidak membatalkan apa pun sama sekali.
  if (!baris.id) {
    kembalikanKlaim('baris hasil PATCH tidak memuat id');
    throw new Error('Permintaan gagal diproses. Minta link reset yang baru dari halaman login.');
  }

  try {
    supabaseAdmin_('put', '/auth/v1/admin/users/' + encodeURIComponent(userId), { password: password });
  } catch (e) {
    kembalikanKlaim(e.message);
    throw e;
  }

  // Password sudah diganti. Turunkan penanda must_change_pw supaya index.html
  // tidak mengarahkan orang ini balik ke halaman ganti password.
  //
  // BUKAN lewat RPC complete_password_change() seperti di alur Supabase.
  // RPC itu membaca auth.uid(), sedangkan di alur ini tidak ada sesi
  // Supabase sama sekali - yang memegang identitas hanya token. Karena itu
  // kolomnya ditulis langsung lewat service_role.
  try {
    supabaseAdmin_('patch', '/rest/v1/profiles?id=eq.' + encodeURIComponent(userId), {
      must_change_pw: false,
      login_terakhir: sekarang
    });
  } catch (e) {
    console.error('GAGAL turunkan must_change_pw untuk ' + userId + ': ' + e.message);
  }

  // Paksa keluar dari semua perangkat. Mengganti password di Supabase tidak
  // otomatis membatalkan sesi yang sudah dibuat - sesi yang dibuat dengan
  // password lama akan tetap hidup kalau langkah ini dilewati.
  try {
    supabaseAdmin_('post', '/auth/v1/admin/users/' + encodeURIComponent(userId) + '/logout',
      { scope: 'global' });
  } catch (e) {
    console.warn('logout global gagal untuk ' + userId + ': ' + e.message);
  }

  logActivity_(null, 'update', 'users', 'Password diganti lewat tautan reset mandiri');
  return json_({ ok: true, message: 'Password berhasil diganti.' });
}

/**
 * Kirim email reset lewat MailApp.
 *
 * Pengirimnya adalah Gmail pemilik proyek Apps Script dan tidak bisa diubah
 * per pesan - MailApp dan GmailApp sama-sama mengirim sebagai akun itu.
 * Yang bisa diubah hanya nama tampilan lewat parameter `name`.
 *
 * Kuota MailApp sekitar 100 email per hari untuk akun @gmail.com biasa, dan
 * 1500 per hari untuk Google Workspace.
 */
function kirimResetEmail_(email, link, kedaluwarsaIso) {
  const jam = formatDate_(new Date(kedaluwarsaIso));

  const teks = 'Halo,\n\n'
    + 'Ada permintaan untuk mengganti password akun Anda di Portal Manajemen RW 26\n'
    + 'Pengasinan Rawalumbu.\n\n'
    + 'Gunakan tautan ini untuk membuat password baru:\n' + link + '\n\n'
    + 'Tautan berlaku sampai ' + jam + ' dan hanya bisa dipakai satu kali.\n\n'
    + 'Kalau Anda tidak meminta ini, abaikan saja email ini. Password Anda tidak\n'
    + 'berubah sampai tautannya benar-benar dipakai.\n\n'
    + 'RW 26 Pengasinan Rawalumbu';

  MailApp.sendEmail({
    to: email,
    subject: 'Ganti password Portal RW 26',
    body: teks,
    htmlBody: emailResetHtml_(link, jam),
    name: RESET_SENDER_NAMA
  });
}

/**
 * Bentuk HTML email.
 *
 * Gmail membuang tag <style> di dalam tubuh email, jadi semua gaya ditulis
 * sebagai atribut style langsung. Tabel, bukan flex/grid - sama alasannya.
 */
function emailResetHtml_(link, jam) {
  const tombol = '<table role="presentation" cellpadding="0" cellspacing="0" border="0"'
    + ' style="border-collapse:separate;"><tr><td align="center" bgcolor="#0a6c50"'
    + ' style="border-radius:12px;"><a href="' + escapeHtml_(link) + '"'
    + ' style="display:inline-block;padding:14px 32px;font-family:Helvetica,Arial,sans-serif;'
    + 'font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:12px;">'
    + 'Buat Password Baru</a></td></tr></table>';

  return '<!doctype html><html lang="id"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'
    + '<body style="margin:0;padding:0;background:#f3f7f5;font-family:Helvetica,Arial,sans-serif;color:#1f2d28;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"'
    + ' style="background:#f3f7f5;"><tr><td align="center" style="padding:28px 14px;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"'
    + ' style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;">'

    + '<tr><td style="background:#0a6c50;padding:22px 28px;color:#ffffff;">'
    + '<div style="font-size:18px;font-weight:bold;letter-spacing:.5px;">RW 26</div>'
    + '<div style="font-size:12px;opacity:.85;letter-spacing:.6px;">PENGASINAN &middot; RAWALUMBU</div>'
    + '</td></tr>'

    + '<tr><td style="padding:28px;">'
    + '<div style="font-size:12px;font-weight:bold;color:#0a6c50;letter-spacing:.6px;'
    + 'padding-bottom:6px;">GANTI PASSWORD</div>'
    + '<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#12211c;">'
    + 'Buat password baru</h1>'
    + '<p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#4a5b54;">'
    + 'Ada permintaan untuk mengganti password akun Anda di Portal Manajemen RW 26. '
    + 'Tekan tombol di bawah, lalu buat password baru.</p>'
    + tombol
    + '<p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#6b7d75;">'
    + 'Kalau tombolnya tidak berfungsi, salin tautan ini ke peramban:<br>'
    + '<span style="color:#0a6c50;word-break:break-all;">' + escapeHtml_(link) + '</span></p>'
    + '</td></tr>'

    + '<tr><td style="padding:0 28px 24px;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"'
    + ' style="background:#fff8e6;border-left:4px solid #e9b949;border-radius:8px;">'
    + '<tr><td style="padding:14px 16px;font-size:13px;line-height:1.6;color:#5a4a1c;">'
    + 'Tautan ini berlaku sampai <strong>' + escapeHtml_(jam) + '</strong> dan hanya bisa '
    + 'dipakai satu kali. Kalau Anda tidak meminta ganti password, abaikan saja email ini '
    + '- password Anda tidak berubah sampai tautannya benar-benar dipakai.'
    + '</td></tr></table>'
    + '</td></tr>'

    + '<tr><td style="padding:18px 28px;background:#f7faf9;border-top:1px solid #e6efeb;'
    + 'font-size:12px;color:#7d8d86;">'
    + '&copy; 2026 RW 26 Pengasinan &middot; Rawalumbu'
    + '</td></tr>'

    + '</table></td></tr></table></body></html>';
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
 *
 * Parameter keempat (publicBaseUrl) boleh dikosongkan kalau Script Property
 * PUBLIC_BASE_URL sudah diisi lewat UI. Isi dengan alamat portal TANPA garis
 * miring di akhir, mis. "https://mgt.rw026.my.id".
 */
function setupSupabaseConfig_(url, anonKey, serviceRoleKey, publicBaseUrl) {
  const props = PropertiesService.getScriptProperties();
  if (url) props.setProperty('SUPABASE_URL', String(url).trim());
  if (anonKey) props.setProperty('SUPABASE_ANON_KEY', String(anonKey).trim());
  if (serviceRoleKey) props.setProperty('SUPABASE_SERVICE_ROLE_KEY', String(serviceRoleKey).trim());
  if (publicBaseUrl) props.setProperty('PUBLIC_BASE_URL', String(publicBaseUrl).trim().replace(/\/+$/, ''));
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
