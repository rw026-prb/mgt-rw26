/* ============================================================================
 *  rw26-api.js  —  Jembatan antara portal admin dan Supabase
 * ============================================================================
 *  File ini menggantikan fungsi apiRequest() yang tadinya menembak Google Apps
 *  Script untuk semua modul. Sekarang permintaan dialihkan:
 *
 *    - Galeri, Berita, Video  -> tetap Google Apps Script
 *    - Modul lain             -> Supabase (PostgREST / RPC)
 *    - Operasi auth admin     -> Google Apps Script (butuh service_role)
 *
 *  BENTUK RESPONS DIPERTAHANKAN
 *  -----------------------------
 *  index.html punya sekitar 200 baris fungsi render yang membaca properti
 *  seperti data.himbauan[0].imageUrl atau data.user.role. Supabase memakai
 *  nama kolom yang berbeda (snake_case, dan tanggal format YYYY-MM-DD).
 *
 *  Daripada mengubah semua fungsi render, file ini MENERJEMAHKAN nama kolom
 *  dan format tanggal kembali ke bentuk lama. Result: bagian render di
 *  index.html tidak berubah satu baris pun.
 *
 *  Kalau nanti nama kolom di database diubah, cukup ubah file ini.
 * ============================================================================ */

window.RW26 = (function () {
  'use strict';

  var cfg = window.RW26_CONFIG || {};
  var client = null;
  var profile = null;      // baris tabel profiles milik user yang sedang login
  var readyResolve;
  var ready = new Promise(function (r) { readyResolve = r; });

  // -------------------------------------------------------------------------
  //  Daftar aksi: mana yang milik Apps Script, mana yang milik Supabase
  // -------------------------------------------------------------------------
  var APPS_SCRIPT_ACTIONS = new Set([
    // Galeri Foto
    'listGalleryAlbums', 'createGalleryAlbum', 'deleteGalleryAlbum',
    'listGalleryPhotos', 'uploadGalleryPhoto', 'deleteGalleryPhoto',
    // Berita
    'listNews', 'createNews', 'updateNews', 'toggleNews', 'deleteNews',
    // Video Sambutan
    'listVideos', 'createVideo', 'updateVideo', 'toggleVideo',
    'setVideoAutoplay', 'clearVideoAutoplay', 'deleteVideo',
    // Video Kegiatan
    'listVideoKegiatan', 'createVideoKegiatan', 'updateVideoKegiatan',
    'toggleVideoKegiatan', 'deleteVideoKegiatan',
    // Jembatan upload foto untuk modul Supabase
    'uploadDriveImage',
    // Operasi auth. Butuh kunci service_role yang TIDAK BOLEH ada di browser,
    // jadi tetap lewat Apps Script yang menyimpannya di Script Properties.
    'createUser', 'updateUser', 'deleteUser',
    // Mengganti password pengguna lain. Butuh service_role karena Supabase Auth
    // hanya menerima penulisan password lewat Admin API. Sengaja aksi terpisah
    // dari updateUser - lihat catatan di setPasswordUser_ (Code.gs).
    'setPasswordUser'
  ]);

  // -------------------------------------------------------------------------
  //  Utilitas
  // -------------------------------------------------------------------------
  function configured() {
    return typeof cfg.SUPABASE_URL === 'string'
      && cfg.SUPABASE_URL.startsWith('https://')
      && typeof cfg.SUPABASE_ANON_KEY === 'string'
      && cfg.SUPABASE_ANON_KEY.length > 20;
  }

  function bootError(message) {
    var e = new Error(message);
    e.isConfigError = true;
    return e;
  }

  function supabase() {
    if (!configured()) {
      throw bootError('Konfigurasi Supabase belum diisi pada config.js '
        + '(SUPABASE_URL dan SUPABASE_ANON_KEY).');
    }
    if (!client) client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    return client;
  }

  /** Buka hasil PostgREST: lempar error bila ada. */
  function unwrap(res, context) {
    if (res && res.error) {
      var e = new Error(res.error.message || 'Permintaan ditolak database.');
      e.code = res.error.code;
      throw e;
    }
    return res ? res.data : null;
  }

  var BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

  /** 'YYYY-MM-DD' -> 'DD/MM/YYYY'. kebalikan dari yang dilakukan portal. */
  function toDdMmYyyy(iso) {
    if (!iso) return '';
    var s = String(iso).slice(0, 10);
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[3] + '/' + m[2] + '/' + m[1] : s;
  }

  /**
   * 'DD/MM/YYYY' -> 'YYYY-MM-DD'. Nilai yang diketik user di form kas.
   *
   * PERHATIKAN URUTAN. Regex di bawah menangkap:
   *   m[1] = HARI, m[2] = BULAN, m[3] = TAHUN
   *
   * Kolom `tanggal` di tabel kas bertipe date, jadi(PostgreSQL) bentuknya
   * harus TAHUN-BULAN-HARI. Dua basis penghitungan tidak boleh tertukar:
   *
   *   05/10/2026 (5 Oktober) -> 2026-10-05
   *
   * Versi lama menulis m[1] sebagai bulan dan m[2] sebagai hari, sehingga
   * 05/10/2026 tersimpan jadi 2026-05-10. Nilai itu tidak error - Postgres
   * menerimaanya sebagai 10 Mei - lalu list_kas menampilkannya kembali sebagai
   * 10/05/2026. Efeknya di layar: tanggal dan bulan seolah bertukar tanpa
   * ada pesan apa pun. Itu lebih buruk daripada ditolak.
   */
  function toIsoDate(ddmmyyyy) {
    var m = String(ddmmyyyy || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    return m[3] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
  }

  /**
   * timestamptz -> 'DD/MM/YYYY HH:MM' dalam waktu Indonesia (WIB, UTC+7).
   *
   * BUG YANG DIPERBAIKI DI SINI
   * --------------------------
   * Versi lama menggeser waktu secara manual:
   *
   *     var o = d.getTimezoneOffset() * 60000;
   *     var l = new Date(d.getTime() - o - 7 * 3600000);
   *     l.getUTCDate() ...
   *
   * Dua masalah bertumpuk:
   *
   * 1. `getTimezoneOffset()` sudahemove offset lokal, lalu `- 7 * 3600000`
   *    menggeser 7 jam LAGI. Untuk pengguna yang browsernya sudah di WIB,
   *    offset-nya -420 menit (= -7 jam), jadi total geserannya 14 jam. Jam 23.30
   *    WIB became 09.30 dua hari kemudian.
   *
   * 2. Nilai yang benar bergantung pada tempat peramban berada. Admin yang
   *    membuka portal dari komputer di WIB dan dari komputer di UTC akan
   *    melihat angka berbeda untuk baris yang sama - dan tidak ada yang bisa
   *   .managementkan mana yang benar.
   *
   * Sekarang konversinya diserahkan ke timeZone bawaan peramban
   * (Asia/Jakarta), yang selalu menghasilkan WIB apa pun lokasi peramban.
   */
  function toTanggalWaktu(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    try {
      // id-ID menghasilkan HH.mm, jadi jamnya dirakit sendiri dari bagian jam
      // dan menit supaya formatnya persis 'HH:MM' seperti yang dipakai portal.
      var bagian = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      }).formatToParts(d);
      var ambil = function (tipe) {
        for (var i = 0; i < bagian.length; i++) {
          if (bagian[i].type === tipe) return bagian[i].value;
        }
        return '';
      };
      var jam = ambil('hour');
      // locale id-ID bisa menuliskan midnight sebagai "24" - ubah ke "00".
      if (jam === '24') jam = '00';
      return ambil('day') + '/' + ambil('month') + '/' + ambil('year')
        + ' ' + jam + ':' + ambil('minute');
    } catch (e) {
      // Peramban lama tanpa Dukungan timeZone: tetap tampilkan apa adanya
      // daripada membuat kolom kosong.
      return d.toISOString().slice(0, 16).replace('T', ' ').replace(/-/g, '/');
    }
  }

  function driveThumb(fileId, size) {
    return fileId ? 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=' + (size || 'w1200') : '';
  }

  // -------------------------------------------------------------------------
  //  Pemetaan baris database -> bentuk lama
  // -------------------------------------------------------------------------
  function mapHimbauan(r) {
    return {
      id: r.id,
      judul: r.judul,
      kategori: r.kategori,
      gambar: r.image_url || '',
      status: r.status,
      driveUrl: r.image_url || '',
      imageUrl: r.image_file_id
        ? 'https://drive.google.com/uc?export=view&id=' + r.image_file_id
        : (r.image_url || ''),
      fileId: r.image_file_id || ''
    };
  }

  function mapPengumuman(r) {
    return {
      id: r.id,
      judul: r.judul,
      kategori: r.kategori,
      ringkasan: r.ringkasan,
      tanggal: toDdMmYyyy(r.tanggal),
      status: r.status
    };
  }

  function mapFasum(r) {
    return {
      id: r.id,
      nama: r.nama,
      deskripsi: r.deskripsi,
      foto: r.foto_url || '',
      imageUrl: driveThumb(r.foto_file_id, 'w1200') || (r.foto_url || ''),
      fileId: r.foto_file_id || '',
      maps: r.maps_url || ''
    };
  }

  function mapOrg(r) {
    return {
      group: r.grup,
      id: r.legacy_id,
      jabatan: r.jabatan,
      nama: r.nama,
      foto: r.foto_url || '',
      imageUrl: driveThumb(r.foto_file_id, 'w800') || (r.foto_url || ''),
      fileId: r.foto_file_id || ''
    };
  }

  function mapStatistik(r) {
    return {
      id: r.id,
      nama: r.nama_kategori,
      nilai: Number(r.nilai) || 0,
      keterangan: r.keterangan,
      updatedAt: r.updated_at
    };
  }

  /**
   * Bentuk lama satu baris profiles untuk index.html.
   *
   * `emailByLegacyId` diisi dari hasil RPC list_users_dengan_email(). Emailnya
   * dibaca pakai legacy_id (mis. "RW-0001"), bukan id uuid, supaya konsisten
   * dengan kunci yang dibuat pemanggil.
   *
   * Kalau peta tidak diberikan, pakai kolom `email` di baris itu sendiri kalau
   * ada. Itu penting untuk updateMyProfile: baris hasil RPC tidak memuat email,
   * dan tanpa fallback ini session.user.email jadi kosong setiap kali profil
   * disimpan - field email di form profil ikut terkosongkan.
   */
  function mapUser(r, emailByLegacyId) {
    var email = '';
    if (r && r.email) {
      email = r.email;
    } else if (emailByLegacyId && r && r.legacy_id) {
      email = emailByLegacyId[r.legacy_id] || '';
    }
    return {
      userId: r.legacy_id,
      nama: r.nama,
      email: email,
      noHp: r.no_hp || '',
      role: r.role,
      wilayah: r.wilayah,
      status: r.status,
      loginTerakhir: toTanggalWaktu(r.login_terakhir),
      tanggalDibuat: toTanggalWaktu(r.tanggal_dibuat),
      // Diperlakukan sebagai TEKS JSON, bukan array, karena index.html
      // melakukan JSON.parse(user.menuAkses).
      menuAkses: JSON.stringify(Array.isArray(r.menu_access) ? r.menu_access : [])
    };
  }

  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  var handlers = {

    // ======================= KELUAR =======================
    // Tidak perlu ada permintaan ke server. Supabase Auth sudah membuang sesi
    // di sisi klien; token di server dicabut karena berbasis JWT tanpa state.
    async logout() {
      try { await supabase().auth.signOut(); } catch (e) { /* abaikan */ }
      return { ok: true };
    },

    // ======================= PENGGUNA =======================
    // createUser / updateUser / deleteUser ditangani Apps Script (butuh
    // service_role). toggleUser cukup mengubah profiles.status, jadi aman
    // dilakukan langsung dari browser karena RLS mengizinkan Admin/Super Admin.

    async toggleUser(p) {
      var id = p.userId;
      var rows = unwrap(await supabase().from('profiles').select('status').eq('legacy_id', id).limit(1));
      if (!rows || !rows.length) throw new Error('Pengguna tidak ditemukan.');
      var next = rows[0].status === 'Aktif' ? 'Nonaktif' : 'Aktif';
      unwrap(await supabase().from('profiles').update({ status: next }).eq('legacy_id', id));
      return { ok: true, status: next };
    },

    async listUsers() {
      // Email TIDAK ada di tabel profiles - yang menyimpannya adalah
      // auth.users, dan tabel itu tidak bisa dibaca langsung dari browser
      // memakai kunci anon. Karena itu daftar diambil lewat RPC
      // list_users_dengan_email(), yang menjoin keduanya di sisi database.
      //
      // Sebelumnya email di sini SELALU kosong: tidak ada permintaan email
      // sama sekali, `emails` langsung diisi objek kosong. Kolomnya kosong di
      // layar, bukan karena datanya tidak ada.
      //
      // Kalau RPC-nya belum ada di database, daftar TETAP dimuat tanpa email -
      // email yang hilang lebih baik daripada seluruh halaman manajemen user
      // ikut gagal.
      var rows = [];
      var emails = {};
      try {
        rows = unwrap(await supabase().rpc('list_users_dengan_email')) || [];
        var byId = {};
        rows.forEach(function (r) { byId[r.legacy_id] = r.email || ''; });
        emails = byId;
      } catch (e) {
        console.warn('list_users_dengan_email gagal, email ditampilkan kosong: ' + e.message);
        try {
          rows = unwrap(await supabase().from('profiles')
            .select('*').order('legacy_id', { ascending: true })) || [];
        } catch (e2) {
          throw e2;
        }
      }
      return { ok: true, users: rows.map(function (r) { return mapUser(r, emails); }) };
    },

    // ======================= HIMBAUAN =======================
    async listHimbauan() {
      var rows = unwrap(await supabase().from('himbauan').select('*').order('id', { ascending: true }));
      return { ok: true, himbauan: (rows || []).map(mapHimbauan) };
    },

    async createHimbauan(p) {
      var item = p.himbauan || p.item || p;
      var up = await uploadFotoIfAny(item, 'himbauan');
      var row = unwrap(await supabase().from('himbauan').insert({
        judul: String(item.judul || '').trim(),
        kategori: String(item.kategori || 'Informasi').trim(),
        image_file_id: up.fileId || null,
        image_url: up.url || null,
        status: item.status || 'Aktif'
      }).select('id').single());
      return { ok: true, message: 'Himbauan berhasil disimpan.', id: row.id };
    },

    async toggleHimbauan(p) {
      var next = await toggleStatus('himbauan', p.id);
      return { ok: true, status: next };
    },

    async deleteHimbauan(p) {
      // Penting: filter by id. Tanpa filter, PostgREST akan MENGHAPUS SELURUH
      // tabel.
      unwrap(await supabase().from('himbauan').delete().eq('id', p.id));
      return { ok: true, message: 'Himbauan berhasil dihapus.' };
    },

    // ======================= PENGUMUMAN =======================
    async listAnnouncements() {
      var rows = unwrap(await supabase().from('pengumuman').select('*').order('id', { ascending: true }));
      return { ok: true, announcements: (rows || []).map(mapPengumuman) };
    },

    async createAnnouncement(p) {
      var item = p.announcement || p.item || p;
      var row = unwrap(await supabase().from('pengumuman').insert({
        judul: String(item.judul || '').trim(),
        kategori: String(item.kategori || 'Informasi').trim(),
        ringkasan: cleanRichText(item.ringkasan || ''),
        tanggal: toIsoDate(item.tanggal) || new Date().toISOString().slice(0, 10),
        status: item.status || 'Aktif'
      }).select('id').single());
      return { ok: true, id: row.id };
    },

    async updateAnnouncement(p) {
      var item = p.announcement || p.item || {};
      var patch = {
        judul: String(item.judul || '').trim(),
        kategori: String(item.kategori || 'Informasi').trim(),
        ringkasan: cleanRichText(item.ringkasan || ''),
        tanggal: toIsoDate(item.tanggal) || new Date().toISOString().slice(0, 10),
        status: item.status || 'Aktif'
      };
      unwrap(await supabase().from('pengumuman').update(patch).eq('id', item.id));
      return { ok: true };
    },

    async toggleAnnouncement(p) {
      return { ok: true, status: await toggleStatus('pengumuman', p.id) };
    },

    async deleteAnnouncement(p) {
      unwrap(await supabase().from('pengumuman').delete().eq('id', p.id));
      return { ok: true, message: 'Pengumuman berhasil dihapus.' };
    },

    // ======================= FASILITAS =======================
    async listFacilities() {
      var rows = unwrap(await supabase().from('fasum').select('*').order('id', { ascending: true }));
      return { ok: true, facilities: (rows || []).map(mapFasum) };
    },

    async createFacility(p) {
      var item = p.facility || p.item || p;
      var up = await uploadFotoIfAny(item, 'fasilitas');
      var row = unwrap(await supabase().from('fasum').insert({
        nama: String(item.nama || '').trim(),
        deskripsi: plainText(item.deskripsi || ''),
        foto_file_id: up.fileId || null,
        foto_url: up.url || null,
        maps_url: String(item.maps || '').trim()
      }).select('id').single());
      return { ok: true, id: row.id };
    },

    async updateFacility(p) {
      var item = p.facility || p.item || {};
      var up = await uploadFotoIfAny(item, 'fasilitas');
      var patch = {
        nama: String(item.nama || '').trim(),
        deskripsi: plainText(item.deskripsi || ''),
        maps_url: String(item.maps || '').trim(),
        // Tanpa file baru, foto lama tetap dipakai.
        foto_url: up.fileId ? up.url : (item.foto || null)
      };
      if (up.fileId) patch.foto_file_id = up.fileId;
      unwrap(await supabase().from('fasum').update(patch).eq('id', item.id));
      return { ok: true };
    },

    async deleteFacility(p) {
      unwrap(await supabase().from('fasum').delete().eq('id', p.id));
      return { ok: true, message: 'Fasilitas berhasil dihapus.' };
    },

    // ======================= ORGANISASI =======================
    async listOrganization() {
      var rows = unwrap(await supabase().from('organisasi')
        .select('*').order('sort_order', { ascending: true }).order('legacy_id', { ascending: true }));
      var groups = { rw: [], posyandu: [], pkk: [], 'bank-sampah': [], pokmas: [] };
      (rows || []).forEach(function (r) {
        if (groups[r.grup]) groups[r.grup].push(mapOrg(r));
      });
      return { ok: true, organization: groups };
    },

    async createOrgMember(p) {
      var item = p.member || p.item || p;
      var up = await uploadFotoIfAny(item, 'organisasi');
      // legacy_id boleh dikosongkan: trigger di database (0006) mengisinya
      // dengan ORG-NNN berikutnya untuk grup tersebut.
      var legacyId = String(item.id || '').trim();
      unwrap(await supabase().from('organisasi').insert({
        grup: item.group || item.grup || 'rw',
        legacy_id: legacyId || null,
        jabatan: String(item.jabatan || '').trim(),
        nama: String(item.nama || '').trim(),
        foto_file_id: up.fileId || null,
        foto_url: up.url || null
      }));
      return { ok: true };
    },

    async updateOrgMember(p) {
      var item = p.member || p.item || {};
      var up = await uploadFotoIfAny(item, 'organisasi');
      var patch = {
        jabatan: String(item.jabatan || '').trim(),
        nama: String(item.nama || '').trim(),
        foto_url: up.fileId ? up.url : (item.foto || null)
      };
      if (up.fileId) patch.foto_file_id = up.fileId;
      var q = supabase().from('organisasi')
        .update(patch)
        .eq('grup', item.group || item.grup)
        .eq('legacy_id', item.id);
      unwrap(await q);
      return { ok: true };
    },

    async deleteOrgMember(p) {
      var item = p.member || p.item || p;
      unwrap(await supabase().from('organisasi').delete()
        .eq('grup', item.group || item.grup)
        .eq('legacy_id', item.id));
      return { ok: true, message: 'Anggota organisasi berhasil dihapus.' };
    },

    // ======================= STATISTIK =======================
    async listStatistik() {
      var rows = unwrap(await supabase().from('statistik_warga')
        .select('*').order('id', { ascending: true }));
      return { ok: true, data: (rows || []).map(mapStatistik) };
    },

    async createStatistik(p) {
      var item = p.statistik || p.item || p;
      var row = unwrap(await supabase().from('statistik_warga').insert({
        nama_kategori: String(item.nama || '').trim(),
        nilai: Number(item.nilai) || 0,
        keterangan: String(item.keterangan || '')
      }).select('id').single());
      return { ok: true, id: row.id };
    },

    async updateStatistik(p) {
      var item = p.statistik || p.item || {};
      unwrap(await supabase().from('statistik_warga').update({
        nama_kategori: String(item.nama || '').trim(),
        nilai: Number(item.nilai) || 0,
        keterangan: String(item.keterangan || '')
      }).eq('id', item.id));
      return { ok: true };
    },

    async deleteStatistik(p) {
      unwrap(await supabase().from('statistik_warga').delete().eq('id', p.id));
      return { ok: true, message: 'Statistik berhasil dihapus.' };
    },

    // ======================= KAS =======================
    async listKas(p) {
      var out = unwrap(await supabase().rpc('list_kas', {
        p_page: p.page || 1,
        p_perpage: p.perPage || p.perpage || 10,
        p_q: p.q || '',
        p_status: p.status || null
      }));
      return Object.assign({ ok: true }, out);
    },

    async getKasDashboard() {
      var out = unwrap(await supabase().rpc('kas_dashboard'));
      return Object.assign({ ok: true }, out);
    },

    async getKasReport(p) {
      var out = unwrap(await supabase().rpc('kas_report', {
        p_bulan: p.bulan, p_tahun: p.tahun
      }));
      return out;
    },

    async getKasCashFlow(p) {
      var out = unwrap(await supabase().rpc('kas_cash_flow', {
        p_bulan_awal: p.bulanAwal, p_tahun_awal: p.tahunAwal,
        p_bulan_akhir: p.bulanAkhir, p_tahun_akhir: p.tahunAkhir
      }));
      return out;
    },

    async createKas(p) {
      var k = p.kas || {};
      var up = await uploadFotoIfAny(k, 'kas');
      var tanggal = toIsoDate(k.tanggal);
      if (!tanggal) throw new Error('Tanggal transaksi tidak valid.');
      var row = unwrap(await supabase().from('kas').insert({
        tanggal: tanggal,
        uraian: String(k.uraian || '').trim(),
        pj: null,
        metode: ['Tunai', 'Transfer'].indexOf(k.metode) >= 0 ? k.metode : 'Tunai',
        masuk: k.jenis_form === 'masuk' ? toInt(k.nominal) : 0,
        keluar: k.jenis_form === 'keluar' ? toInt(k.nominal) : 0,
        keterangan: String(k.keterangan || '').trim() || null,
        bukti_file_id: up.fileId || null,
        bukti_url: up.url || null
      }).select('id').single());
      return { ok: true, id: row.id };
    },

    async updateKas(p) {
      var k = p.kas || {};
      var up = await uploadFotoIfAny(k, 'kas');
      var tanggal = toIsoDate(k.tanggal);
      if (!tanggal) throw new Error('Tanggal transaksi tidak valid.');
      // Field mana yang terisi ditentukan oleh jenis form, bukan oleh nilai
      // nominal: pengguna mengetik nominal di kolom yang sama untuk keduanya.
      var isMasuk = k.jenis_form === 'masuk';
      var patch = {
        tanggal: tanggal,
        uraian: String(k.uraian || '').trim(),
        metode: ['Tunai', 'Transfer'].indexOf(k.metode) >= 0 ? k.metode : 'Tunai',
        masuk: isMasuk ? toInt(k.nominal) : 0,
        keluar: isMasuk ? 0 : toInt(k.nominal),
        keterangan: String(k.keterangan || '').trim() || null
      };
      if (up.fileId) { patch.bukti_file_id = up.fileId; patch.bukti_url = up.url; }
      if (k.status) patch.status = k.status;
      unwrap(await supabase().from('kas').update(patch).eq('id', k.id));
      return { ok: true };
    },

    async deleteKas(p) {
      unwrap(await supabase().from('kas').delete().eq('id', p.id));
      return { ok: true, message: 'Transaksi berhasil dihapus.' };
    },

    async approveKas(p) {
      unwrap(await supabase().from('kas').update({ status: 'Disetujui' }).eq('id', p.id));
      return { ok: true, message: 'Transaksi disetujui.' };
    },

    async rejectKas(p) {
      unwrap(await supabase().from('kas')
        .update({ status: 'Ditolak', alasan_ditolak: String(p.alasan || '').trim() })
        .eq('id', p.id));
      return { ok: true, message: 'Transaksi ditolak.' };
    },

    async refreshKas() { return { ok: true }; },

    // ======================= DASHBOARD =======================
    async dashboardData() {
      // news tetap dari Apps Script (tab berita), sisanya dari Supabase.
      var sb = supabase();
      var hasil = await Promise.all([
        sb.from('statistik_warga').select('*').order('id', { ascending: true }),
        sb.from('pengumuman').select('*').order('id', { ascending: true }),
        sb.rpc('kas_dashboard')
      ]);
      unwrap(hasil[0], 'statistik');
      unwrap(hasil[1], 'pengumuman');
      var kas = unwrap(hasil[2], 'kas');
      var news = await callAppsScript('listNews');
      return {
        ok: true,
        statistik: (hasil[0].data || []).map(mapStatistik),
        announcements: (hasil[1].data || []).map(mapPengumuman),
        news: news.news || [],
        kasDashboard: kas
      };
    },

    // ======================= PENGUNJUNG =======================
    async getVisitorStats() {
      return unwrap(await supabase().rpc('visitor_stats'));
    },

    async getVisitorLogs(p) {
      return unwrap(await supabase().rpc('visitor_logs', {
        p_page: p.page || 1,
        p_limit: p.limit || 20,
        p_search: p.search || null,
        p_from: p.from || null,
        p_to: p.to || null
      }));
    },

    // ======================= AKTIVITAS =======================
    async listActivity(p) {
      var rows = unwrap(await supabase().from('activity_log')
        .select('*').order('created_at', { ascending: false })
        .limit(Math.min(100, (p && p.limit) || 20)));
      return {
        ok: true,
        data: (rows || []).map(function (r) {
          return {
            timestamp: toTanggalWaktu(r.created_at),
            actor: r.actor_name || 'System',
            role: r.actor_role || '-',
            action: r.action || '',
            module: r.module || '',
            description: r.description || ''
          };
        })
      };
    },

    // ======================= PROFIL =======================
    async updateMyProfile(p) {
      var f = p.profile || {};
      // Email TIDAK diubah lewat sini. Mengganti email berarti mengganti identitas
      // login, dan itu harus lewat Supabase (verify ulang). Untuk sekarang
      // hanya nama dan nomor HP yang bisa diubah sendiri.
      var row = unwrap(await supabase().rpc('update_my_profile', {
        p_nama: String(f.nama || '').trim(),
        p_no_hp: String(f.noHp || '').trim()
      }));

      if (f.newPassword) {
        if (String(f.newPassword).length < 8) {
          throw new Error('Password baru minimal 8 karakter.');
        }
        if (f.newPassword !== f.confirmPassword) {
          throw new Error('Konfirmasi password tidak sama.');
        }
        var r = await supabase().auth.updateUser({ password: String(f.newPassword) });
        if (r.error) throw new Error('Gagal mengganti password: ' + r.error.message);
      }
      // Email tidak ada di baris hasil RPC (tinggalnya di auth.users). Tanpa
      // injecting ulang, session.user.email jadi kosong dan field email di form
      // profil terkosongkan setiap kali profil disimpan.
      var profilBaru = mapUser(Object.assign({}, row, { email: (profile && profile.email) || '' }));
      return { ok: true, message: 'Profil berhasil diperbarui.', user: profilBaru };
    }
  };

  // -------------------------------------------------------------------------
  //  Helper
  // -------------------------------------------------------------------------
  function toInt(v) {
    var n = parseInt(String(v == null ? '' : v).replace(/[^0-9-]/g, ''), 10);
    return isNaN(n) ? 0 : n;
  }

  async function toggleStatus(table, id) {
    var rows = unwrap(await supabase().from(table).select('status').eq('id', id).limit(1));
    if (!rows || !rows.length) throw new Error('Data tidak ditemukan.');
    var next = rows[0].status === 'Aktif' ? 'Nonaktif' : 'Aktif';
    unwrap(await supabase().from(table).update({ status: next }).eq('id', id));
    return next;
  }

  /** Bersihkan HTML kaya sebelum masuk database (meniru sanitizeHtml_). */
  function cleanRichText(html) {
    var d = document.createElement('div');
    d.innerHTML = String(html || '');
    d.querySelectorAll('script,style,iframe,object,embed,form,input').forEach(function (n) { n.remove(); });
    d.querySelectorAll('*').forEach(function (n) {
      Array.from(n.attributes).forEach(function (a) {
        var name = a.name.toLowerCase();
        if (name.indexOf('on') === 0) n.removeAttribute(a.name);
        if ((name === 'href' || name === 'src' || name === 'action')
            && !/^(https?:|mailto:)/i.test(a.value)) n.removeAttribute(a.name);
      });
    });
    return d.innerHTML;
  }

  /** Ambil teks polos dari HTML. */
  function plainText(html) {
    var d = document.createElement('div');
    d.innerHTML = String(html || '');
    return (d.textContent || '').trim();
  }

  /**
   * Unggah foto ke Google Drive lewat Apps Script bila ada file baru.
   *
   * Dua hal yang perlu diperhatikan:
   *
   * 1. Nama field tidak seragam di portal. Modul himbauan, fasilitas, dan
   *    organisasi mengirim `dataUrl`; modul kas mengirim `fileData`. Keduanya
   *    diterima di sini supaya index.html tidak perlu disentuh.
   *
   * 2. `item.foto` berisi URL foto LAMA. Kalau tidak ada file baru, URL itu
   *    harus dipertahankan. Kalau tidak, mengubah Facility hanya untuk
   *    mengganti deskripsi akan menghapus fotonya tanpa jejak.
   */
  async function uploadFotoIfAny(item, module) {
    var dataUrl = (item && (item.fileData || item.dataUrl)) || '';
    if (!dataUrl) return { fileId: null, url: (item && item.foto) || null };
    var out = await callAppsScript('uploadDriveImage', {
      module: module,
      item: { dataUrl: dataUrl, name: item.fileName || module }
    });
    return { fileId: out.fileId || null, url: out.url || out.viewUrl || null };
  }

  /** Panggil Google Apps Script dengan access token Supabase. */
  async function callAppsScript(action, payload) {
    if (!cfg.APPS_SCRIPT_URL || !cfg.APPS_SCRIPT_URL.startsWith('https://script.google.com/')) {
      throw bootError('URL Google Apps Script belum diatur pada config.js.');
    }
    var token = await getAccessToken();
    var response = await fetch(cfg.APPS_SCRIPT_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action: action, token: token }, payload || {}))
    });
    var text = await response.text();
    var data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error('Server sedang sibuk, coba lagi beberapa saat.'); }
    if (!data.ok) {
      var err = new Error(data.message || 'Permintaan gagal.');
      // Tandai HANYA untuk kegagalan yang benar-benar soal autentikasi.
      //
      // Dulu index.html memakai pemeriksaan teks longgar yang mencocokkan kata
      // "token" di pesan apa pun. Itu memicu keluar-pakai-tanpa-signOut,
      // dan karena sesi Supabase masih hidup, halaman login mengarahkan balik
      // ke portal. Pengunjung terlempar bolak-balik tanpa henti.
      if (/Sesi berakhir|Token tidak valid|belum login|Wajib login/i.test(data.message || '')) {
        err.isAuthError = true;
      }
      throw err;
    }
    return data;
  }

  /**
   * Keluar dari Supabase Auth.
   *
   * WAJIB dipanggil setiap kali keluar dari portal. Kalau sesi dibiarkan
   * hidup, halaman login akan melihat sesi itu masih sah lalu langsung
   * mengarahkan balik ke portal - padahal yang baru saja dikeluarkan. Akibatnya
   * pengunjung terlempar bolak-balik tanpa henti.
   */
  async function signOut() {
    try {
      var c = client;
      if (!c && configured()) c = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
      if (c) await c.auth.signOut();
    } catch (e) {
      console.warn('Gagal keluar dari Supabase:', e.message);
    }
  }

  function getAccessToken() {
    if (!client) supabase();
    return client.auth.getSession().then(function (r) {
      if (r.error || !r.data || !r.data.session) {
        var e = new Error('Sesi berakhir. Silakan login kembali.');
        e.isAuthError = true;
        throw e;
      }
      return r.data.session.access_token;
    });
  }

  // -------------------------------------------------------------------------
  //  Pintu masuk
  // -------------------------------------------------------------------------
  async function apiRequest(action, payload) {
    if (APPS_SCRIPT_ACTIONS.has(action)) {
      return callAppsScript(action, payload || {});
    }
    var fn = handlers[action];
    if (!fn) throw new Error('Aksi "' + action + '" tidak dikenal oleh jembatan Supabase.');
    return fn(payload || {});
  }

  /** Sesi dalam bentuk yang DIMBAWA index.html (supaya kode render tak berubah). */
  function legacySession() {
    if (!profile) return null;
    return {
      token: null,   // diambil otomatis dari Supabase saat dibutuhkan
      expiresAt: Date.now() + 3600000,
      user: {
        userId: profile.legacy_id,
        nama: profile.nama,
        email: profile.email || '',
        role: profile.role,
        wilayah: profile.wilayah,
        status: profile.status,
        noHp: profile.no_hp || '',
        menuAkses: JSON.stringify(profile.menu_access || [])
      }
    };
  }

  /**
   * Tutup jalur keluar dari bootstrap().
   *
   * `ready` WAJIB diselesaikan di setiap jalur keluar. Kalau tidak, promise
   * itu menggantung selamanya, `await window.RW26.ready` di index.html ikut
   * menggantung, dan portal tampil dengan menu kosong tanpa pesan apa pun.
   *
   * Diselesaikan dengan nilai falsy supaya index.html berhenti sendiri lewat
   * `if (!window.RW26_SESSION) return;` - jadi halaman tidak juga menggantung
   * kalau perpindahan halaman tertahan.
   */
  function stopAndRedirect(url) {
    readyResolve(null);
    location.replace(url);
  }

  async function bootstrap() {
    try {
      if (!configured() || !window.supabase) {
        stopAndRedirect('login.html?err=konfigurasi');
        return;
      }
      client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

      // getSession() async, jadi HARUS di-await. Tanpa await, sb.data selalu
      // undefined dan setiap orang akan tendang balik ke login.html.
      var sb = await client.auth.getSession();
      if (sb.error || !sb.data || !sb.data.session) {
        stopAndRedirect('login.html');
        return;
      }
      var token = sb.data.session.access_token;
      var email = sb.data.session.user.email;

      var rows = await client.from('profiles').select('*').eq('id', sb.data.session.user.id).limit(1);
      if (rows.error) {
        stopAndRedirect('login.html?err=profil');
        return;
      }
      if (!rows.data || !rows.data.length) {
        stopAndRedirect('login.html?err=profil-kosong');
        return;
      }
      profile = rows.data[0];
      profile.email = email;

      if (String(profile.status).toLowerCase() !== 'aktif') {
        stopAndRedirect('login.html?err=nonaktif');
        return;
      }

      // Saat migrasi, setiap akun diberi password acak. Flag ini memastikan
      // password itu diganti sebelum orang bisa memakai portal.
      if (profile.must_change_pw) {
        // Penanda `?alasan=` itu penting. Tanpa itu, orang yang telah diarahkan
        // ke sini akan menekan "Kembali ke Login", lalu login.html melihat
        // sesi masih hidup dan mengirimnya BALIK ke index.html - yang
        // mengarahkan lagi ke halaman ini. Putaran tanpa henti.
        //
        // Penanda itu memberi tahu login.html: orang ini memang tidak boleh
        // masuk ke portal, jadi jangan diteruskan. Halaman update-password.html
        // yang akan menangani pertukaran password-nya.
        stopAndRedirect('update-password.html?alasan=login-awal');
        return;
      }

      // Sesi kadaluarsa → langsung putuskan, jangan biarkan token basi
      // terkirim ke Apps Script.
      client.auth.onAuthStateChange(function (event) {
        if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
          if (event === 'TOKEN_REFRESHED') return;
          stopAndRedirect('login.html');
        }
      });

      window.RW26_SESSION = legacySession();
      window.RW26_PROFILE = profile;
      void token;
      readyResolve(profile);
    } catch (e) {
      // Jaringan putus, Supabase tidak menjawab, atau galat lain yang tidak
      // terduga. Tanpa blok ini `ready` menggantung dan gejalanya persis
      // seperti bug lama: portal terbuka, menu kosong, tidak ada pesan.
      console.error('Gagal menyiapkan portal:', e);
      stopAndRedirect('login.html?err=jaringan');
    }
  }

  var api = {
    ready: ready,
    apiRequest: apiRequest,
    bootstrap: bootstrap,
    signOut: signOut,
    legacySession: legacySession,
    cleanRichText: cleanRichText,
    plainText: plainText,
    toDdMmYyyy: toDdMmYyyy,
    toIsoDate: toIsoDate,
    BULAN: BULAN,
    get profile() { return profile; },
    isAppsScriptAction: function (a) { return APPS_SCRIPT_ACTIONS.has(a); }
  };

  // Jalankan begitu DOM siap.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { api.bootstrap(); });
  } else {
    api.bootstrap();
  }

  return api;
})();
