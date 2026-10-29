/**
 * MathQuest SMP Kelas VII – Backend Google Apps Script
 * --------------------------------------------------------------
 * Fungsi: menyimpan LKM & nilai ke Google Sheets, autentikasi PIN guru,
 * serta melayani pembacaan data (JSONP) untuk panel guru.
 *
 * CARA PASANG (ringkas):
 * 1. Buat Google Sheet baru → Extensions → Apps Script → tempel file ini.
 * 2. Isi NEW_PIN di bawah (4–12 karakter), jalankan fungsi `setup` lalu `aturPinGuru`
 *    (izinkan akses saat diminta). Setelah itu KOSONGKAN kembali NEW_PIN.
 * 3. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 * 4. Salin URL (berakhiran /exec) ke CONFIG.GAS_URL di script.js.
 * Setiap mengubah kode, buat deployment versi baru.
 */

const CFG = {
  SPREADSHEET_ID: '',            // kosongkan bila script dibuat dari dalam Sheet (container-bound)
  SHEET_LKM: 'LKM',
  SHEET_NILAI: 'Nilai',
  TOKEN_TTL: 7200,               // detik (maks 21600)
  MAX_FAIL: 5,                   // batas percobaan PIN salah
  FAIL_WINDOW: 600,              // detik jendela penguncian
  MAX_BODY: 100000,              // batas ukuran payload (karakter)
  TZ: 'Asia/Jakarta',
};
const NEW_PIN = '';              // isi sementara, jalankan aturPinGuru(), lalu kosongkan lagi

const H_LKM = ['id', 'ts', 'waktu', 'nama', 'kelas', 'skor', 'status', 'hipotesis_1', 'hipotesis_2', 'kesimpulan', 'data_json'];
const H_NILAI = ['id', 'ts', 'waktu', 'nama', 'kelas', 'mode', 'skor', 'benar', 'total', 'level', 'durasi_detik', 'bantuan'];

/* ---------------- Setup ---------------- */
function ss_() { return CFG.SPREADSHEET_ID ? SpreadsheetApp.openById(CFG.SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name, headers) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e8ecff');
  }
  return sh;
}

function setup() {
  sheet_(CFG.SHEET_LKM, H_LKM);
  sheet_(CFG.SHEET_NILAI, H_NILAI);
  Logger.log('Sheet siap. Selanjutnya isi NEW_PIN lalu jalankan aturPinGuru().');
}

function hash_(pin, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function aturPinGuru() {
  if (!/^[A-Za-z0-9]{4,12}$/.test(NEW_PIN)) throw new Error('NEW_PIN harus 4–12 huruf/angka.');
  const salt = Utilities.getUuid();
  const props = PropertiesService.getScriptProperties();
  props.setProperty('PIN_SALT', salt);
  props.setProperty('PIN_HASH', hash_(NEW_PIN, salt));
  Logger.log('PIN guru tersimpan (sebagai hash). Kosongkan NEW_PIN di kode.');
}

/* ---------------- Utilitas ---------------- */
function out_(obj, cb) {
  const json = JSON.stringify(obj);
  if (cb && /^[A-Za-z_][A-Za-z0-9_.]{0,60}$/.test(cb)) {
    return ContentService.createTextOutput(cb + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function safe_(v, max) {           // cegah formula injection di Sheets & batasi panjang
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v == null ? '' : v).slice(0, max || 300);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}
function num_(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function waktu_(ts) { return Utilities.formatDate(new Date(ts), CFG.TZ, 'yyyy-MM-dd HH:mm:ss'); }

function findRow_(sh, id) {         // mengembalikan nomor baris (1-based) atau 0
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return 0;
}

function validToken_(t) {
  if (!t || typeof t !== 'string' || t.length < 20) return false;
  return CacheService.getScriptCache().get('tok_' + t) === '1';
}

/* ---------------- POST: simpan data siswa ---------------- */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '';
    if (!raw || raw.length > CFG.MAX_BODY) return out_({ ok: false, error: 'Payload tidak valid' });
    const body = JSON.parse(raw), d = body.data;
    if (!d || typeof d !== 'object' || !/^[A-Za-z0-9_\-]{3,150}$/.test(String(d.id || ''))) return out_({ ok: false, error: 'ID tidak valid' });
    const ts = num_(d.ts) || Date.now();

    if (body.kind === 'lkm') {
      const sh = sheet_(CFG.SHEET_LKM, H_LKM), row = findRow_(sh, d.id);
      if (row && num_(sh.getRange(row, 2).getValue()) > ts) return out_({ ok: true, skipped: true });
      const json = JSON.stringify(d).slice(0, 49000);
      const vals = [d.id, ts, waktu_(ts), safe_(d.nama, 60), safe_(d.kelas, 20), num_(d.skor), safe_(d.status || 'Terkumpul', 30),
        safe_(d.hip1, 1500), safe_(d.hip2, 1500), safe_(d.concl, 2000), json];
      if (row) sh.getRange(row, 1, 1, vals.length).setValues([vals]); else sh.appendRow(vals);
      return out_({ ok: true });
    }
    if (body.kind === 'nilai') {
      const sh = sheet_(CFG.SHEET_NILAI, H_NILAI);
      if (findRow_(sh, d.id)) return out_({ ok: true, skipped: true });
      sh.appendRow([d.id, ts, waktu_(ts), safe_(d.nama, 60), safe_(d.kelas, 20), safe_(d.mode, 20), num_(d.skor), num_(d.benar), num_(d.total), num_(d.level), num_(d.durasi), num_(d.bantuan)]);
      return out_({ ok: true });
    }
    return out_({ ok: false, error: 'Jenis data tidak dikenal' });
  } catch (err) {
    return out_({ ok: false, error: 'Server: ' + err.message });
  } finally {
    try { lock.releaseLock(); } catch (x) { /* abaikan */ }
  }
}

/* ---------------- GET: ping, exists, auth, list ---------------- */
function doGet(e) {
  const p = (e && e.parameter) || {}, cb = p.callback;
  try {
    switch (p.action) {
      case 'ping':
        return out_({ ok: true, ts: Date.now() }, cb);

      case 'exists': {                           // dipakai klien untuk memastikan data sudah masuk
        const name = p.kind === 'lkm' ? CFG.SHEET_LKM : p.kind === 'nilai' ? CFG.SHEET_NILAI : null;
        if (!name) return out_({ ok: false, error: 'kind tidak valid' }, cb);
        const sh = sheet_(name, p.kind === 'lkm' ? H_LKM : H_NILAI), row = findRow_(sh, String(p.id || ''));
        return out_({ ok: true, exists: row > 0, ts: row ? num_(sh.getRange(row, 2).getValue()) : 0 }, cb);
      }

      case 'auth': {
        const cache = CacheService.getScriptCache();
        const fails = Number(cache.get('pinfail') || 0);
        if (fails >= CFG.MAX_FAIL) return out_({ ok: false, error: 'Terlalu banyak percobaan. Coba lagi ± 10 menit.' }, cb);
        const props = PropertiesService.getScriptProperties(), salt = props.getProperty('PIN_SALT'), stored = props.getProperty('PIN_HASH');
        if (!salt || !stored) return out_({ ok: false, error: 'PIN guru belum diatur (jalankan aturPinGuru).' }, cb);
        if (hash_(String(p.pin || ''), salt) === stored) {
          const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
          cache.put('tok_' + token, '1', Math.min(CFG.TOKEN_TTL, 21600));
          cache.remove('pinfail');
          return out_({ ok: true, token: token }, cb);
        }
        cache.put('pinfail', String(fails + 1), CFG.FAIL_WINDOW);
        return out_({ ok: false, error: 'PIN salah.' }, cb);
      }

      case 'list': {
        if (!validToken_(p.token)) return out_({ ok: false, error: 'Sesi tidak valid atau berakhir.' }, cb);
        if (p.kind === 'lkm') {
          const sh = sheet_(CFG.SHEET_LKM, H_LKM), v = sh.getDataRange().getValues(), rows = [];
          for (let i = 1; i < v.length; i++) {
            let data = null;
            try { data = JSON.parse(v[i][10]); } catch (x) { data = null; }
            rows.push({ id: v[i][0], ts: v[i][1], nama: v[i][3], kelas: v[i][4], skor: v[i][5], status: v[i][6], data: data });
          }
          return out_({ ok: true, rows: rows }, cb);
        }
        if (p.kind === 'nilai') {
          const sh = sheet_(CFG.SHEET_NILAI, H_NILAI), v = sh.getDataRange().getValues(), rows = [];
          for (let i = 1; i < v.length; i++) {
            rows.push({ id: v[i][0], ts: v[i][1], nama: v[i][3], kelas: v[i][4], mode: v[i][5], skor: v[i][6], benar: v[i][7], total: v[i][8], level: v[i][9], durasi: v[i][10], bantuan: v[i][11] });
          }
          return out_({ ok: true, rows: rows }, cb);
        }
        return out_({ ok: false, error: 'kind tidak valid' }, cb);
      }

      case 'del':
      case 'clear': {                            // hapus data (wajib token guru)
        if (!validToken_(p.token)) return out_({ ok: false, error: 'Sesi tidak valid atau berakhir.' }, cb);
        const isDel = p.action === 'del';
        if (isDel && (!p.nama || !p.kelas)) return out_({ ok: false, error: 'Nama/kelas kosong' }, cb);
        const nama = isDel ? safe_(p.nama, 60) : '', kelas = isDel ? safe_(p.kelas, 20) : '';
        const lock = LockService.getScriptLock();
        lock.waitLock(20000);
        try {
          let n = 0;
          [[CFG.SHEET_LKM, H_LKM], [CFG.SHEET_NILAI, H_NILAI]].forEach(function (x) {
            const sh = sheet_(x[0], x[1]), last = sh.getLastRow();
            if (last < 2) return;
            if (!isDel) { sh.deleteRows(2, last - 1); n += last - 1; return; }
            const v = sh.getDataRange().getValues();
            for (let i = v.length - 1; i >= 1; i--) {
              if (String(v[i][3]) === nama && String(v[i][4]) === kelas) { sh.deleteRow(i + 1); n++; }
            }
          });
          return out_({ ok: true, deleted: n }, cb);
        } finally { lock.releaseLock(); }
      }

      default:
        return out_({ ok: true, app: 'MathQuest SMP VII', hint: 'Gunakan parameter action=ping|exists|auth|list|del|clear' }, cb);
    }
  } catch (err) {
    return out_({ ok: false, error: 'Server: ' + err.message }, cb);
  }
}