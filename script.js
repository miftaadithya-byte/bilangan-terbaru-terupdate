'use strict';
/* =====================================================================
   MathQuest SMP Kelas VII – Bilangan Bulat
   Logika frontend: canvas garis bilangan, discovery learning, LKM,
   latihan/kuis adaptif, sinkronisasi Google Sheets, panel guru, PDF/CSV.
   ===================================================================== */

/* ===================== KONFIGURASI ===================== */
const CONFIG = {
  GAS_URL: '',                 // Tempel URL Web App Google Apps Script (berakhiran /exec)
  LOCAL_TEACHER_PIN: 'guru123',// HANYA dipakai bila GAS_URL kosong (mode lokal, tanpa keamanan nyata)
  QUIZ_LENGTH: 10,
  PRACTICE_LENGTH: 8,
};

/* ===================== UTILITAS ===================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt = n => (n < 0 ? '−' + Math.abs(n) : String(n));
const par = n => (n < 0 ? `(${fmt(n)})` : fmt(n));
const exprOf = (a, op, b) => `${fmt(a)} ${op === '+' ? '+' : '−'} ${par(b)}`;
const calc = (a, op, b) => (op === '+' ? a + b : a - b);
const slug = s => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const parseNum = s => { const t = String(s).trim().replace(/[−–—]/g, '-'); return /^-?\d+$/.test(t) ? parseInt(t, 10) : NaN; };
const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fmtTime = ts => { const d = new Date(ts); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

let user = load('mq_user', null);
const uid = () => (user ? slug(user.nama) + '__' + slug(user.kelas) : 'tamu');
const K = n => `mq_${n}_${uid()}`;

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function openModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }

const easeInOut = p => (p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
function animate(ms, fn) {
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const d = reduce ? 0 : ms;
  return new Promise(res => {
    const t0 = performance.now();
    (function f(now) {
      const p = d ? Math.min(1, (now - t0) / d) : 1;
      fn(easeInOut(p));
      if (p < 1) requestAnimationFrame(f); else res();
    })(t0);
  });
}

/* ===================== CANVAS: GARIS BILANGAN ===================== */
class NumberLine {
  constructor(canvas) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.token = 0; this.w = 0; this.h = 0;
    this.onNote = null; this.view = { min: -10, max: 10 };
    this.reset(0);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement);
    this.resize();
  }
  resize() {
    const w = Math.floor(this.c.parentElement.clientWidth);
    if (w < 80) return;
    const h = Math.round(Math.min(280, Math.max(220, w * 0.38)));
    if (w === this.w && h === this.h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.w = w; this.h = h;
    this.c.style.width = w + 'px'; this.c.style.height = h + 'px';
    this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }
  calcView(vals) {
    const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    const pad = Math.max(2, Math.ceil((hi - lo) * 0.18));
    let min = lo - pad, max = hi + pad;
    if (max - min < 12) { const e = (12 - (max - min)) / 2; min -= e; max += e; }
    return { min: Math.floor(min), max: Math.ceil(max) };
  }
  points(extra = []) {
    const p = [this.start, this.pos, ...extra];
    this.segs.forEach(s => p.push(s.from, s.to));
    if (this.result !== null) p.push(this.result);
    if (this.wrong !== null) p.push(this.wrong);
    return p.filter(v => typeof v === 'number');
  }
  reset(start) {
    this.token++;
    this.start = start; this.pos = start; this.face = 1; this.faceV = 1;
    this.segs = []; this.live = null; this.result = null; this.wrong = null;
    this.view = this.calcView([start]);
    this.draw();
  }
  async setView(t) {
    const tok = this.token, a = { ...this.view };
    await animate(450, p => { if (tok !== this.token) return; this.view.min = a.min + (t.min - a.min) * p; this.view.max = a.max + (t.max - a.max) * p; this.draw(); });
  }
  async turn() {
    const tok = this.token, from = this.faceV; this.face = -this.face; const to = this.face;
    await animate(520, p => { if (tok !== this.token) return; this.faceV = from + (to - from) * p; this.draw(); });
  }
  async moveTo(x, { expand = false } = {}) {
    const tok = this.token, from = this.pos;
    if (from === x) return;
    if (expand) {
      const t = this.calcView(this.points([x]));
      if (t.min < this.view.min - .01 || t.max > this.view.max + .01) {
        await this.setView({ min: Math.min(this.view.min, t.min), max: Math.max(this.view.max, t.max) });
        if (tok !== this.token) return;
      }
    }
    this.live = { from, to: from };
    await animate(Math.min(1500, 400 + Math.abs(x - from) * 90), p => {
      if (tok !== this.token) return;
      this.pos = from + (x - from) * p; this.live.to = this.pos; this.draw();
    });
    if (tok !== this.token) return;
    this.segs.push({ from, to: x }); this.live = null; this.pos = x; this.draw();
  }
  async play(a, op, b, { wrong = null } = {}) {
    this.reset(a);
    const tok = this.token, res = calc(a, op, b), note = t => this.onNote && this.onNote(t);
    this.wrong = wrong;
    this.view = this.calcView([a, res, 0, ...(wrong !== null ? [wrong] : [])]);
    this.draw();
    note(`Roket mulai di ${fmt(a)} dan menghadap arah positif (kanan).`);
    await sleep(700); if (tok !== this.token) return;
    if (op === '-') {
      note('Tanda “−” → roket putar balik (menghadap kiri).');
      await this.turn(); if (tok !== this.token) return;
      await sleep(350); if (tok !== this.token) return;
    }
    if (b !== 0) {
      note(`${b > 0 ? 'Bilangan positif → maju' : 'Bilangan negatif → mundur'} ${Math.abs(b)} langkah.`);
      await this.moveTo(res); if (tok !== this.token) return;
    }
    this.result = res; this.draw();
    note(`Roket berhenti di ${fmt(res)}. Jadi ${exprOf(a, op, b)} = ${fmt(res)}.`);
    return res;
  }
  draw() {
    const { ctx, w, h } = this; if (!w) return;
    ctx.clearRect(0, 0, w, h);
    const pad = 26, ay = Math.round(h * 0.54), { min, max } = this.view;
    const ppu = (w - 2 * pad) / (max - min), X = v => pad + (v - min) * ppu;
    const FONT = '600 11px "Plus Jakarta Sans",system-ui,sans-serif';
    // sumbu
    ctx.lineCap = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = '#5b6bb5';
    ctx.beginPath(); ctx.moveTo(8, ay); ctx.lineTo(w - 8, ay); ctx.stroke();
    // tanda & label (auto-scaling label)
    const ls = [1, 2, 5, 10, 20, 50, 100, 200, 500].find(s => s * ppu >= 30) || 1000;
    ctx.font = FONT; ctx.textAlign = 'center';
    for (let v = Math.ceil(min); v <= Math.floor(max); v++) {
      const major = v % ls === 0;
      if (ppu < 5 && !major) continue;
      const x = X(v);
      ctx.strokeStyle = v === 0 ? '#22d3ee' : '#6f7fc0'; ctx.lineWidth = v === 0 ? 3 : 1.5;
      ctx.beginPath(); ctx.moveTo(x, ay - (major ? 8 : 4)); ctx.lineTo(x, ay + (major ? 8 : 4)); ctx.stroke();
      if (major) { ctx.fillStyle = v === 0 ? '#22d3ee' : '#c5cffa'; ctx.fillText(fmt(v), x, ay + 24); }
    }
    // panah langkah (hijau = ke kanan/positif, merah = ke kiri/negatif)
    const all = this.segs.slice(); if (this.live && this.live.to !== this.live.from) all.push(this.live);
    all.forEach((s, i) => this.arrow(X(s.from), X(s.to), ay - 26, 26 + (i % 3) * 16, s.to > s.from, s.to - s.from));
    // penanda bawah
    const tag = (v, label, color, row) => {
      const x = X(v), tx = Math.min(w - 34, Math.max(34, x));
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, ay + 30); ctx.lineTo(x - 5, ay + 39); ctx.lineTo(x + 5, ay + 39); ctx.closePath(); ctx.fill();
      ctx.font = '700 11px "Plus Jakarta Sans",system-ui,sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(label, tx, ay + 52 + row * 14);
    };
    ctx.beginPath(); ctx.fillStyle = '#60a5fa'; ctx.arc(X(this.start), ay, 6, 0, 7); ctx.fill();
    tag(this.start, 'Mulai ' + fmt(this.start), '#60a5fa', 0);
    if (this.result !== null) {
      ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(X(this.result), ay, 10, 0, 7); ctx.stroke();
      tag(this.result, 'Hasil ' + fmt(this.result), '#fbbf24', 1);
    }
    if (this.wrong !== null) {
      ctx.strokeStyle = '#fb923c'; ctx.lineWidth = 2.5; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.arc(X(this.wrong), ay, 10, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      tag(this.wrong, 'Jawabanmu ' + fmt(this.wrong), '#fb923c', 2);
    }
    this.rocket(X(this.pos), ay - 12, this.faceV);
  }
  arrow(x1, x2, y, hgt, positive, delta) {
    const { ctx } = this, col = positive ? '#34d399' : '#fb7185';
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 3;
    const cx = (x1 + x2) / 2, cy = y - 2 * hgt;
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.quadraticCurveTo(cx, cy, x2, y); ctx.stroke();
    const ang = Math.atan2(y - cy, x2 - cx);
    ctx.beginPath(); ctx.moveTo(x2, y);
    ctx.lineTo(x2 - 10 * Math.cos(ang - .45), y - 10 * Math.sin(ang - .45));
    ctx.lineTo(x2 - 10 * Math.cos(ang + .45), y - 10 * Math.sin(ang + .45)); ctx.closePath(); ctx.fill();
    if (Math.abs(x2 - x1) > 34) {
      ctx.font = '700 11px "Plus Jakarta Sans",system-ui,sans-serif'; ctx.textAlign = 'center';
      ctx.fillText((delta > 0 ? '+' : '−') + Math.abs(Math.round(delta * 100) / 100), cx, y - hgt - 5);
    }
  }
  rocket(x, y, fv) {
    const { ctx } = this;
    ctx.save(); ctx.translate(x, y); ctx.scale(fv, 1);
    ctx.fillStyle = '#ffb020'; ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(-21, -4); ctx.lineTo(-17, 0); ctx.lineTo(-21, 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fb7185';
    ctx.beginPath(); ctx.moveTo(-9, -6); ctx.lineTo(-15, -13); ctx.lineTo(-3, -6); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-9, 6); ctx.lineTo(-15, 13); ctx.lineTo(-3, 6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e8ecff'; ctx.beginPath(); ctx.moveTo(16, 0); ctx.quadraticCurveTo(8, -9, -10, -7); ctx.lineTo(-10, 7); ctx.quadraticCurveTo(8, 9, 16, 0); ctx.fill();
    ctx.fillStyle = '#22d3ee'; ctx.beginPath(); ctx.arc(3, 0, 3.2, 0, 7); ctx.fill();
    ctx.restore();
  }
}

/* ===================== BANK SOAL ===================== */
// Jawaban dihitung otomatis dari a, op, b. lv = tingkat kesulitan (1-3).
const BANK = {
  hitung: [
    [6, '+', -2, 1], [3, '-', 5, 1], [-4, '+', 7, 1], [5, '-', 8, 1], [-2, '-', 3, 1],
    [4, '-', -3, 2], [-6, '+', -4, 2], [-3, '-', -7, 2], [2, '+', -9, 2], [-8, '-', -5, 2],
    [-12, '-', -15, 3], [9, '-', -14, 3], [-17, '+', 11, 3], [-20, '-', -8, 3], [15, '+', -23, 3],
  ].map((q, i) => ({ id: 'h' + (i + 1), a: q[0], op: q[1], b: q[2], lv: q[3], t: null, u: '' })),
  cerita: [
    ['Suhu di dalam freezer mula-mula 4°C. Setelah pintu dibiarkan terbuka, suhu turun 7°C. Berapa suhu freezer sekarang?', 4, '-', 7, 1, '°C'],
    ['Seorang pengunjung berada di lantai basement −2 (dua lantai di bawah tanah). Ia naik lift 5 lantai ke atas. Di lantai berapa ia sekarang?', -2, '+', 5, 1, ''],
    ['Rani berutang Rp5.000 (ditulis −5 dalam ribuan rupiah). Ia lalu menerima uang Rp8.000. Berapa keadaan uang Rani sekarang (dalam ribuan rupiah)?', -5, '+', 8, 1, ''],
    ['Seorang penyelam berada 8 meter di bawah permukaan laut (−8 m). Ia naik 3 meter. Pada posisi berapa ia sekarang?', -8, '+', 3, 1, ' m'],
    ['Dalam sebuah permainan, Doni memiliki 3 poin. Ia terkena penalti sehingga poinnya dikurangi 6. Berapa poin Doni sekarang?', 3, '-', 6, 1, ' poin'],
    ['Kapal selam berada di kedalaman 30 m (−30 m). Kapal itu naik 12 m. Pada posisi berapa kapal selam sekarang?', -30, '+', 12, 2, ' m'],
    ['Suhu pagi di puncak gunung −3°C. Siang hari badai membuat suhu turun 9°C lagi. Berapa suhu sekarang?', -3, '-', 9, 2, '°C'],
    ['Tim biru mendapat −6 poin karena pelanggaran. Wasit lalu membatalkan sanksi senilai −4 poin itu (poin −4 dikurangkan dari total). Berapa total poin tim biru sekarang?', -6, '-', -4, 2, ' poin'],
    ['Elang terbang pada ketinggian 40 m di atas permukaan laut, sedangkan ikan yang diincarnya berada 12 m di bawah permukaan (−12 m). Berapa jarak vertikal elang dan ikan? (ketinggian elang dikurangi ketinggian ikan)', 40, '-', -12, 2, ' m'],
    ['Saldo koperasi Rina −15 (ribu rupiah; artinya berutang). Pengurus menghapus catatan utang senilai −8 dari saldo tersebut (saldo dikurangi −8). Berapa saldo Rina sekarang (ribu rupiah)?', -15, '-', -8, 2, ''],
    ['Suhu di Kutub A adalah −18°C dan di Kutub B −32°C. Berapa selisih suhu Kutub A terhadap Kutub B (suhu A dikurangi suhu B)?', -18, '-', -32, 3, '°C'],
    ['Puncak bukit berada 350 m di atas permukaan laut dan dasar lembah 120 m di bawah permukaan laut (−120 m). Berapa beda tinggi puncak bukit dan dasar lembah?', 350, '-', -120, 3, ' m'],
    ['Selisih gol Tim A adalah −7. Setelah pertandingan terakhir (kalah lebih banyak), selisih golnya bertambah dengan −5. Berapa selisih gol Tim A sekarang?', -7, '+', -5, 3, ''],
    ['Lift berada di lantai 12. Lift bergerak −19 lantai menuju area parkir bawah tanah. Di lantai berapa lift berhenti?', 12, '+', -19, 3, ''],
    ['Cairan P bersuhu −25°C dan cairan Q bersuhu −40°C. Berapa selisih suhu P terhadap Q (suhu P dikurangi suhu Q)? Perkirakan juga: hasilnya di sebelah kiri atau kanan nol?', -25, '-', -40, 3, '°C'],
  ].map((q, i) => ({ id: 'c' + (i + 1), t: q[0], a: q[1], op: q[2], b: q[3], lv: q[4], u: q[5] })),
};

function hintFor(q) {
  const { a, op, b } = q;
  if (op === '+') return b >= 0 ? `Menambah bilangan positif: roket menghadap kanan lalu maju ${b} langkah.` : `Menambah bilangan negatif: roket menghadap kanan lalu mundur ${Math.abs(b)} langkah.`;
  return `Ubah dulu menjadi penjumlahan dengan lawan bilangan: ${exprOf(a, op, b)} = ${fmt(a)} + ${par(-b)}.`;
}
function explainSteps(a, op, b, ans) {
  const res = calc(a, op, b), s = [`Mulai dari ${fmt(a)} pada garis bilangan (titik biru).`];
  if (op === '+') s.push(b >= 0 ? `Menambah ${fmt(b)}: roket menghadap kanan, maju ${b} langkah (panah hijau).` : `Menambah ${fmt(b)}: roket menghadap kanan, mundur ${Math.abs(b)} langkah (panah merah).`);
  else {
    s.push(`Mengurangi ${par(b)} sama dengan menambah lawannya: ${exprOf(a, op, b)} = ${fmt(a)} + ${par(-b)}.`);
    s.push(`Roket putar balik, lalu ${b > 0 ? 'maju' : 'mundur'} ${Math.abs(b)} langkah → bergerak ke ${res < a ? 'kiri (panah merah)' : 'kanan (panah hijau)'}.`);
  }
  s.push(`Hasil: ${exprOf(a, op, b)} = ${fmt(res)}.`);
  if (typeof ans === 'number' && ans !== res) s.push(`Jawabanmu (${fmt(ans)}) berjarak ${Math.abs(ans - res)} satuan dari hasil yang benar.`);
  return s;
}

/* ===================== SINKRONISASI (localStorage + Google Sheets) ===================== */
function jsonp(params, timeout = 12000) {
  return new Promise((res, rej) => {
    const url = CONFIG.GAS_URL.trim();
    if (!url) return rej(new Error('no-url'));
    const cb = 'mqcb_' + Math.random().toString(36).slice(2);
    const s = document.createElement('script');
    const cleanup = () => { clearTimeout(timer); delete window[cb]; s.remove(); };
    const timer = setTimeout(() => { cleanup(); rej(new Error('timeout')); }, timeout);
    window[cb] = d => { cleanup(); res(d); };
    s.onerror = () => { cleanup(); rej(new Error('network')); };
    s.src = url + (url.includes('?') ? '&' : '?') + new URLSearchParams({ ...params, callback: cb }).toString();
    document.head.appendChild(s);
  });
}
const Sync = {
  busy: false,
  get on() { return !!CONFIG.GAS_URL.trim(); },
  queue() { return load('mq_queue', []); },
  async push(item) {
    const q = this.queue().filter(x => !(x.kind === item.kind && x.id === item.id));
    q.push(item); save('mq_queue', q); this.badge();
    return this.flush();
  },
  async flush() {
    if (!this.on || this.busy || !navigator.onLine) { this.badge(); return; }
    this.busy = true;
    try {
      const remain = [];
      for (const it of this.queue()) {
        try {
          await fetch(CONFIG.GAS_URL.trim(), { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ kind: it.kind, data: it.data }) });
          await sleep(1200);
          const r = await jsonp({ action: 'exists', kind: it.kind, id: it.id });
          if (r && r.ok && r.exists && Number(r.ts) >= Number(it.data.ts)) this.markSynced(it); else remain.push(it);
        } catch { remain.push(it); }
      }
      save('mq_queue', remain);
    } finally { this.busy = false; this.badge(); LKM.renderStatus(); }
  },
  markSynced(it) {
    if (it.kind === 'lkm') { const k = `mq_lkmsaved_${it.id.replace(/^lkm_/, '')}`; const v = load(k, null); if (v && v.ts === it.data.ts) { v.synced = true; save(k, v); } }
    else { const arr = load('mq_scores', []); const e = arr.find(x => x.id === it.id); if (e) { e.synced = true; save('mq_scores', arr); } }
  },
  badge() {
    const b = $('#syncBadge'), n = this.queue().length;
    if (!this.on) b.textContent = '💾 Lokal';
    else b.textContent = n ? `⏳ ${n} menunggu` : '☁️ Tersinkron';
  },
};

/* ===================== NAVIGASI & PENGGUNA ===================== */
function showTab(id) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + id));
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (id === 'lkm') LKM.onEnter();
  if (id === 'summary') Summary.render();
  setTimeout(() => [Lab.nl, Summary.nl, Fb.nl].forEach(n => n && n.resize()), 60);
}
function updateUserChip() { $('#userName').textContent = user ? `${user.nama} · ${user.kelas}` : 'Tamu'; }
function bootUser() {
  updateUserChip(); Lab.load(); Hyp.load(); LKM.load(); Explore.render(); Summary.render(); Play.home(); Sync.badge();
}

/* ===================== EKSPLORASI: LAB ROKET ===================== */
const PAIRS = [
  { id: 'p1', x: [3, '-', 5], y: [3, '+', -5] },
  { id: 'p2', x: [2, '-', -4], y: [2, '+', 4] },
  { id: 'p3', x: [-3, '-', -5], y: [-3, '+', 5] },
];
const rowKey = (a, op, b) => `${a}|${op}|${b}`;
const Lab = {
  nl: null, rows: [], hint: 0, cur: null, busy: false,
  init() {
    this.nl = new NumberLine($('#labCanvas'));
    this.nl.onNote = t => { $('#labNote').textContent = t; };
    $('#btnPrep').onclick = () => this.prep();
    $('#btnLabReset').onclick = () => this.prep();
    $('#btnTurn').onclick = () => this.turn();
    $('#btnForward').onclick = () => this.move(1);
    $('#btnBackward').onclick = () => this.move(-1);
    $('#btnRecord').onclick = () => this.record();
    $('#btnAuto').onclick = () => this.auto();
    $('#btnClearObs').onclick = () => { if (confirm('Kosongkan tabel pengamatan?')) { this.rows = []; this.persist(); this.renderObs(); Explore.render(); } };
  },
  load() {
    const d = load(K('lab'), { rows: [], hint: 0 }); this.rows = d.rows || []; this.hint = d.hint || 0;
    this.cur = null; this.nl.reset(0); $('#labLog').innerHTML = ''; $('#labPos').textContent = '–'; $('#labNote').textContent = 'Tekan “Siapkan Roket” untuk memulai.';
    this.renderObs();
  },
  persist() { save(K('lab'), { rows: this.rows, hint: this.hint }); },
  read() {
    const a = parseNum($('#labA').value), b = parseNum($('#labB').value), op = $('#labOp').value;
    if (isNaN(a) || isNaN(b) || Math.abs(a) > 99 || Math.abs(b) > 99) { toast('Isi a dan b dengan bilangan bulat antara −99 dan 99.'); return null; }
    return { a, op, b };
  },
  prep(p) {
    if (p) { $('#labA').value = fmt(p.a).replace('−', '-'); $('#labB').value = fmt(p.b).replace('−', '-'); $('#labOp').value = p.op; }
    const q = this.read(); if (!q) return;
    this.cur = q; this.nl.reset(q.a);
    $('#labExprChip').textContent = `${exprOf(q.a, q.op, q.b)} = ?`;
    $('#labLog').innerHTML = ''; $('#labPos').textContent = fmt(q.a);
    $('#labNote').textContent = `Roket di ${fmt(q.a)}, menghadap kanan (arah positif). Gerakkan roket sesuai aturan!`;
  },
  log(t) { const li = document.createElement('li'); li.textContent = t; const ul = $('#labLog'); ul.prepend(li); },
  ensure() { if (!this.cur) { toast('Tekan “Siapkan Roket” dulu.'); return false; } return true; },
  async turn() {
    if (!this.ensure() || this.busy) return; this.busy = true;
    try { await this.nl.turn(); this.log(`Putar balik → menghadap ${this.nl.face === 1 ? 'kanan (+)' : 'kiri (−)'}`); this.nl.onNote(`Roket kini menghadap ${this.nl.face === 1 ? 'kanan' : 'kiri'}.`); } finally { this.busy = false; }
  },
  async move(dir) {
    if (!this.ensure() || this.busy) return;
    const n = Math.max(1, Math.min(30, parseInt($('#labN').value, 10) || 1)); this.busy = true;
    try {
      const x = this.nl.pos + this.nl.face * dir * n;
      await this.nl.moveTo(x, { expand: true });
      $('#labPos').textContent = fmt(this.nl.pos);
      this.log(`${dir > 0 ? 'Maju' : 'Mundur'} ${n} → posisi ${fmt(this.nl.pos)}`);
      this.nl.onNote(`Roket ${dir > 0 ? 'maju' : 'mundur'} ${n} langkah. Posisi: ${fmt(this.nl.pos)}.`);
    } finally { this.busy = false; }
  },
  record() {
    if (!this.ensure()) return;
    const { a, op, b } = this.cur, ok = this.nl.pos === calc(a, op, b);
    if (!ok) { toast('Posisi roket belum tepat. Ingat: tanda “−” → putar balik; bilangan positif → maju, negatif → mundur.', 4200); return; }
    const key = rowKey(a, op, b), r = { key, a, op, b, hasil: this.nl.pos };
    const i = this.rows.findIndex(x => x.key === key); if (i >= 0) this.rows[i] = r; else this.rows.push(r);
    this.persist(); this.renderObs(); Explore.render(); toast('Tercatat ✓');
  },
  async auto() {
    const q = this.read(); if (!q || this.busy) return;
    this.busy = true; this.cur = q; this.hint++; this.persist();
    $('#labExprChip').textContent = `${exprOf(q.a, q.op, q.b)} = ?`;
    try { await this.nl.play(q.a, q.op, q.b); $('#labPos').textContent = fmt(this.nl.pos); } finally { this.busy = false; }
  },
  renderObs() {
    const html = this.rows.length
      ? this.rows.map(r => `<tr><td>${esc(exprOf(r.a, r.op, r.b))}</td><td><b>${esc(fmt(r.hasil))}</b></td></tr>`).join('')
      : '<tr><td colspan="2" class="muted">Belum ada data. Catat hasil dari laboratorium roket.</td></tr>';
    $('#obsBody').innerHTML = html;
    const lk = $('#lkmObsBody'); if (lk) lk.innerHTML = html;
  },
  has(t) { return this.rows.find(r => r.key === rowKey(...t)); },
};

const Explore = {
  init() { this.renderQs(); },
  render() {
    const done = PAIRS.filter(p => Lab.has(p.x) && Lab.has(p.y)).length;
    // pasangan
    $('#pairList').innerHTML = PAIRS.map((p, i) => {
      const rx = Lab.has(p.x), ry = Lab.has(p.y);
      const st = r => (r ? `<span style="color:var(--ok)">✓ tercatat: ${esc(fmt(r.hasil))}</span>` : '<span>belum dicatat</span>');
      const cmp = rx && ry ? `<div class="cmp">Hasil: ${esc(fmt(rx.hasil))} dan ${esc(fmt(ry.hasil))} — ${rx.hasil === ry.hasil ? '<span style="color:var(--ok)">sama</span>' : '<span style="color:var(--bad)">berbeda</span>'}. Apa artinya?</div>` : '';
      return `<div class="pair"><b>Pasangan ${i + 1}</b>
        <div class="row"><button class="btn sm load" data-p="${i}" data-w="x" type="button">Muat ${esc(exprOf(...p.x))}</button> <span class="status">${st(rx)}</span></div>
        <div class="row"><button class="btn sm load" data-p="${i}" data-w="y" type="button">Muat ${esc(exprOf(...p.y))}</button> <span class="status">${st(ry)}</span></div>${cmp}</div>`;
    }).join('');
    $$('#pairList .load').forEach(b => b.onclick = () => { const p = PAIRS[+b.dataset.p][b.dataset.w]; Lab.prep({ a: p[0], op: p[1], b: p[2] }); window.scrollTo({ top: $('#labCanvas').getBoundingClientRect().top + scrollY - 140, behavior: 'smooth' }); });
    // progres
    const hasHyp = !!Hyp.v1 && !!Hyp.v2;
    const steps = [['Observasi', done >= 3], ['Hipotesis', hasHyp], ['Uji hipotesis', Hyp.attempts > 0], ['Rangkuman terbuka', Hyp.unlocked]];
    $('#progressSteps').innerHTML = steps.map(s => `<span class="step-chip ${s[1] ? 'done' : ''}">${s[1] ? '✓' : '○'} ${s[0]}</span>`).join('');
  },
  QS: [
    ['Bandingkan hasil 3 − 5 dan 3 + (−5). Sama atau berbeda?', 'Lihat tabel pengamatanmu. Kedua hasilnya berapa?'],
    ['Bandingkan 2 − (−4) dengan 2 + 4. Sama atau berbeda?', 'Hitung keduanya dengan roket, lalu bandingkan hasilnya.'],
    ['Saat tanda “−” diganti “+”, bilangan kedua berubah menjadi bilangan apa?', 'Perhatikan: 5 menjadi −5, dan −4 menjadi 4. Itu disebut lawan bilangan.'],
  ],
  renderQs() {
    $('#qList').innerHTML = this.QS.map((q, i) => `<li>${esc(q[0])}<button class="hint-btn" data-i="${i}" type="button" aria-label="Petunjuk ${i + 1}">💡</button></li>`).join('');
    $$('#qList .hint-btn').forEach(b => b.onclick = () => {
      const li = b.parentElement; let h = li.querySelector('.hint');
      if (h) { h.remove(); return; }
      h = document.createElement('span'); h.className = 'hint'; h.textContent = this.QS[+b.dataset.i][1]; li.appendChild(h);
    });
  },
};

/* ===================== HIPOTESIS ===================== */
function evalHyp(text) {
  const t = String(text).toLowerCase();
  const same = /\b(sama|setara|identik|serupa|ekuivalen|ekivalen)\b/.test(t);
  const op = /(tambah|menambah|menambahkan|ditambah|penjumlahan|\+)/.test(t);
  const opp = /(lawan|kebalikan|berlawanan|tanda.*(ganti|berubah|balik)|(negatif|positif|minus).*(jadi|menjadi|berubah))/.test(t);
  return { same, op, opp, score: [same, op, opp].filter(Boolean).length };
}
const HYP_TXT = { sendiri: 'bilangan itu sendiri', lawan: 'lawan bilangan itu', nol: 'nol' };
const Hyp = {
  v1: '', v2: '', h1: '', h2: '', attempts: 0, unlocked: false, assisted: false,
  init() {
    $('#btnTestHyp').onclick = () => this.test();
    $('#btnAssist').onclick = () => { this.unlocked = true; this.assisted = true; this.persist(); Explore.render(); toast('Rangkuman dibuka dengan bantuan.'); showTab('summary'); };
    ['#hyp1', '#hyp2'].forEach(s => $(s).addEventListener('change', () => { this.sync(); this.persist(); Explore.render(); }));
  },
  sync() {
    this.v1 = $('#hyp1').value; this.v2 = $('#hyp2').value;
    this.h1 = this.v1 ? `Mengurangi bilangan positif sama dengan menambah ${HYP_TXT[this.v1]}.` : '';
    this.h2 = this.v2 ? `Mengurangi bilangan negatif sama dengan menambah ${HYP_TXT[this.v2]}.` : '';
  },
  load() {
    Object.assign(this, { v1: '', v2: '', attempts: 0, unlocked: false, assisted: false }, load(K('hyp'), {}));
    $('#hyp1').value = HYP_TXT[this.v1] ? this.v1 : ''; $('#hyp2').value = HYP_TXT[this.v2] ? this.v2 : '';
    this.sync();
    $('#hypFeedback').hidden = true; $('#btnAssist').hidden = !(this.attempts >= 3 && !this.unlocked);
  },
  persist() { save(K('hyp'), { v1: this.v1, v2: this.v2, attempts: this.attempts, unlocked: this.unlocked, assisted: this.assisted }); },
  test() {
    this.sync();
    const fb = $('#hypFeedback'); fb.hidden = false;
    if (!this.v1 || !this.v2) { fb.className = 'feedback bad'; fb.textContent = 'Pilih jawaban untuk kedua kalimat dulu ya.'; return; }
    const done = PAIRS.filter(p => Lab.has(p.x) && Lab.has(p.y)).length;
    this.attempts++;
    const ok1 = this.v1 === 'lawan', ok2 = this.v2 === 'lawan';
    const tip1 = this.v1 === 'sendiri' ? '3 + 5 = 8, sedangkan 3 − 5 = −2. Hasilnya berbeda. Cek lagi di tabelmu.' : '3 + 0 = 3, sedangkan 3 − 5 = −2. Hasilnya berbeda. Cek lagi di tabelmu.';
    const tip2 = this.v2 === 'sendiri' ? '2 + (−4) = −2, sedangkan 2 − (−4) = 6. Hasilnya berbeda. Cek lagi di tabelmu.' : '2 + 0 = 2, sedangkan 2 − (−4) = 6. Hasilnya berbeda. Cek lagi di tabelmu.';
    let msg = `<p>${ok1 ? '✅' : '❌'} <b>3 − 5</b> — ${ok1 ? 'benar! 3 − 5 = 3 + (−5) = −2' : tip1}</p><p>${ok2 ? '✅' : '❌'} <b>2 − (−4)</b> — ${ok2 ? 'benar! 2 − (−4) = 2 + 4 = 6' : tip2}</p>`;
    if (done < 3) msg += `<p>📌 Catat dulu semua pasangan soal di tabel (baru ${done}/3) supaya jawabanmu ada buktinya.</p>`;
    const pass = done >= 3 && ok1 && ok2;
    if (pass) { this.unlocked = true; msg += '<p>🎉 <b>Kamu menemukannya!</b> Mengurangi sama dengan menambah <i>lawannya</i>: lawan 5 adalah −5, dan lawan −4 adalah 4. Rangkuman konsep sudah terbuka.</p><button class="btn primary go-tab" data-go="summary" type="button">Buka Rangkuman →</button>'; }
    fb.className = 'feedback ' + (pass ? 'ok' : 'bad'); fb.innerHTML = msg;
    const g = fb.querySelector('.go-tab'); if (g) g.onclick = () => showTab('summary');
    $('#btnAssist').hidden = !(this.attempts >= 3 && !this.unlocked);
    this.persist(); Explore.render();
  },
};

/* ===================== RANGKUMAN ===================== */
const Summary = {
  nl: null,
  init() {
    $$('.sum-demo').forEach(b => b.onclick = () => {
      if (!this.nl) { this.nl = new NumberLine($('#sumCanvas')); this.nl.onNote = t => { $('#sumNote').textContent = t; }; }
      this.nl.resize(); this.nl.play(+b.dataset.a, b.dataset.op, +b.dataset.b);
    });
  },
  render() {
    const u = Hyp.unlocked;
    $('#sumLocked').hidden = u; $('#sumContent').hidden = !u;
    if (u) $('#sumHyp').innerHTML = `<p><b>Dugaan 1:</b> ${esc(Hyp.h1 || '(kosong)')}</p><p><b>Dugaan 2:</b> ${esc(Hyp.h2 || '(kosong)')}</p>${Hyp.assisted ? '<p class="muted">(Dibuka dengan bantuan — coba perbaiki dugaanmu setelah membaca rangkuman.)</p>' : ''}`;
  },
};

/* ===================== LKM ===================== */
const EXP_KEYS = ['a', 'b', 'r1', 'r2', 'r3', 'r4'];
const LKM = {
  step: 0, d: null,
  blank() { return { o1: '', o2: '', o3: '', hip1: '', hip2: '', concl: '', refl: '', conf: '', exp: [0, 1, 2].map(() => ({ a: '', b: '', r1: '', r2: '', r3: '', r4: '' })) }; },
  init() {
    $('#expBody').innerHTML = [0, 1, 2].map(i => `<tr>${EXP_KEYS.map(k => `<td><input data-exp="${i}.${k}" type="text" inputmode="text" autocomplete="off" aria-label="Baris ${i + 1} ${k}"><span class="chk" id="chk-${i}-${k}"></span></td>`).join('')}</tr>`).join('');
    $$('[data-lkm]').forEach(el => el.addEventListener('input', () => { this.d[el.dataset.lkm] = el.value; this.persist(); this.stepMarks(); }));
    $$('[data-exp]').forEach(el => el.addEventListener('input', () => { const [i, k] = el.dataset.exp.split('.'); this.d.exp[+i][k] = el.value; this.checkExp(+i); this.persist(); this.stepMarks(); }));
    $$('.lkm-step').forEach(b => b.onclick = () => this.go(+b.dataset.step));
    $('#lkmPrev').onclick = () => this.go(this.step - 1);
    $('#lkmNext').onclick = () => this.go(this.step + 1);
    $('#btnSubmitLkm').onclick = () => this.submit();
    $('#btnPdfMine').onclick = () => { const s = load(K('lkmsaved'), null); if (!s) { toast('Kumpulkan LKM dulu agar PDF bisa dibuat.'); return; } makeLkmPdf(s); };
  },
  load() {
    this.d = Object.assign(this.blank(), load(K('lkmdraft'), {}));
    if (!Array.isArray(this.d.exp) || this.d.exp.length !== 3) this.d.exp = this.blank().exp;
    $$('[data-lkm]').forEach(el => { el.value = this.d[el.dataset.lkm] ?? ''; });
    $$('[data-exp]').forEach(el => { const [i, k] = el.dataset.exp.split('.'); el.value = this.d.exp[+i][k] ?? ''; });
    [0, 1, 2].forEach(i => this.checkExp(i));
    this.go(0); this.renderStatus(); Lab.renderObs();
  },
  persist() { save(K('lkmdraft'), this.d); },
  onEnter() {
    if (!this.d.hip1 && Hyp.h1) { this.d.hip1 = Hyp.h1; $('[data-lkm="hip1"]').value = Hyp.h1; }
    if (!this.d.hip2 && Hyp.h2) { this.d.hip2 = Hyp.h2; $('[data-lkm="hip2"]').value = Hyp.h2; }
    this.persist(); Lab.renderObs(); this.stepMarks();
  },
  go(n) {
    this.step = Math.max(0, Math.min(3, n));
    $$('.lkm-panel').forEach((p, i) => p.classList.toggle('active', i === this.step));
    $$('.lkm-step').forEach((b, i) => b.classList.toggle('active', i === this.step));
    $('#lkmPrev').disabled = this.step === 0; $('#lkmNext').disabled = this.step === 3;
    this.stepMarks();
  },
  stepMarks() {
    const d = this.d, e = this.expStats();
    const ok = [d.o1.trim().length >= 20 && d.o2.trim().length >= 20, d.hip1.trim().length >= 15 && d.hip2.trim().length >= 15, e.rows >= 2, d.concl.trim().length >= 40 && d.refl.trim().length >= 15];
    $$('.lkm-step').forEach((b, i) => b.classList.toggle('done', ok[i]));
  },
  expected(r) { const a = parseNum(r.a), b = parseNum(r.b); if (isNaN(a) || isNaN(b)) return null; return { r1: a - b, r2: a - b, r3: a + b, r4: a + b }; },
  checkExp(i) {
    const r = this.d.exp[i], ex = this.expected(r);
    ['r1', 'r2', 'r3', 'r4'].forEach(k => {
      const s = $(`#chk-${i}-${k}`), v = String(r[k]).trim();
      if (!ex || v === '') { s.textContent = ''; s.className = 'chk'; return; }
      const good = parseNum(v) === ex[k]; s.textContent = good ? '✓' : '✗'; s.className = 'chk ' + (good ? 'ok' : 'no');
    });
  },
  expStats() {
    let rows = 0, correct = 0;
    this.d.exp.forEach(r => { const ex = this.expected(r); if (!ex) return; const filled = ['r1', 'r2', 'r3', 'r4'].every(k => !isNaN(parseNum(r[k]))); if (filled) rows++; ['r1', 'r2', 'r3', 'r4'].forEach(k => { if (parseNum(r[k]) === ex[k]) correct++; }); });
    return { rows, correct };
  },
  renderStatus() {
    const s = load(K('lkmsaved'), null), el = $('#lkmStatus'); if (!el) return;
    if (!s) { el.textContent = 'Belum dikumpulkan.'; return; }
    el.textContent = `Terkumpul ${fmtTime(s.ts)} · skor LKM ${s.skor} · ${s.synced ? '☁️ sudah tersinkron ke guru' : (Sync.on ? '⏳ tersimpan lokal, menunggu sinkron' : '💾 tersimpan lokal (backend belum diatur)')}`;
  },
  submit() {
    const d = this.d, miss = [];
    if (d.o1.trim().length < 20 || d.o2.trim().length < 20) miss.push([0, 'Observation: isi dua jawaban (min. 20 huruf).']);
    if (d.hip1.trim().length < 15 || d.hip2.trim().length < 15) miss.push([1, 'Hypothesis: lengkapi kedua dugaan.']);
    const e = this.expStats(); if (e.rows < 2) miss.push([2, 'Experiment: lengkapi minimal 2 baris percobaan.']);
    if (d.concl.trim().length < 40 || d.refl.trim().length < 15) miss.push([3, 'Conclusion: isi kesimpulan (min. 40 huruf) dan refleksi.']);
    if (miss.length) { this.go(miss[0][0]); toast(miss[0][1], 4000); return; }
    if (!user) { openModal('#loginModal'); return; }
    const h1 = evalHyp(d.hip1).score, h2 = evalHyp(d.hip2).score;
    const skor = Math.round(
      (d.o1.trim().length >= 20 ? 10 : 0) + (d.o2.trim().length >= 20 ? 10 : 0) +
      ((h1 + h2) / 6) * 20 + (e.correct / 12) * 30 +
      (d.concl.trim().length >= 40 ? 20 : 0) + (d.refl.trim().length >= 15 ? 10 : 0));
    const payload = {
      id: 'lkm_' + uid(), ts: Date.now(), nama: user.nama, kelas: user.kelas, skor, status: 'Terkumpul', bantuan: Lab.hint,
      obs: Lab.rows.map(r => ({ soal: exprOf(r.a, r.op, r.b), hasil: r.hasil })),
      o1: d.o1.trim(), o2: d.o2.trim(), o3: d.o3.trim(), hip1: d.hip1.trim(), hip2: d.hip2.trim(),
      exp: d.exp.filter(r => this.expected(r)), concl: d.concl.trim(), refl: d.refl.trim(), conf: d.conf, synced: false,
    };
    save(K('lkmsaved'), payload);
    Sync.push({ kind: 'lkm', id: payload.id, data: payload });
    this.renderStatus(); toast('LKM tersimpan ✓'); Sync.badge();
  },
};

/* ===================== LATIHAN & KUIS (ADAPTIF) ===================== */
const Play = {
  s: null,
  init() {
    $$('.mode-card').forEach(b => b.onclick = () => this.start(b.dataset.mode));
    $('#btnHint').onclick = () => { const h = $('#pgHint'); h.hidden = false; h.textContent = '💡 ' + hintFor(this.s.q); this.s.hints++; };
    $('#btnNext').onclick = () => this.next();
    $('#btnQuit').onclick = () => { if (confirm('Akhiri sesi sekarang?')) this.finish(); };
    $('#btnAgain').onclick = () => this.start(this.s.mode);
    $('#btnHome').onclick = () => this.home();
  },
  home() { this.s = null; $('#playStart').hidden = false; $('#playGame').hidden = true; $('#playEnd').hidden = true; },
  start(mode) {
    if (!user) { openModal('#loginModal'); return; }
    this.s = { mode, level: 1, streak: 0, n: 0, total: mode === 'kuis' ? CONFIG.QUIZ_LENGTH : CONFIG.PRACTICE_LENGTH, used: new Set(), log: [], correct: 0, hints: 0, t0: Date.now(), q: null, locked: false };
    $('#playStart').hidden = true; $('#playEnd').hidden = true; $('#playGame').hidden = false;
    $('#btnHint').hidden = mode === 'kuis';
    this.next();
  },
  pick() {
    const s = this.s;
    const bank = s.mode === 'hitung' ? BANK.hitung : s.mode === 'cerita' ? BANK.cerita : (s.n % 2 === 0 ? BANK.hitung : BANK.cerita);
    let c = bank.filter(q => !s.used.has(q.id) && q.lv === s.level);
    if (!c.length) {
      c = bank.filter(q => !s.used.has(q.id));
      if (!c.length) return null;
      const best = Math.min(...c.map(q => Math.abs(q.lv - s.level)));
      c = c.filter(q => Math.abs(q.lv - s.level) === best);
    }
    return c[Math.floor(Math.random() * c.length)];
  },
  options(q) {
    const c = calc(q.a, q.op, q.b), set = new Set();
    [q.op === '-' ? q.a + q.b : q.a - q.b, -c, c + 1, c - 1, c + 2, c - 2, q.a, q.b].forEach(v => { if (v !== c) set.add(v); });
    let k = 3; while (set.size < 6) { set.add(c + k); set.add(c - k); k++; }
    return shuffle([c, ...shuffle([...set]).slice(0, 3)]);
  },
  next() {
    const s = this.s;
    if (s.n >= s.total) return this.finish();
    const q = this.pick(); if (!q) return this.finish();
    s.q = q; s.n++; s.used.add(q.id); s.locked = false; s.opts = this.options(q);
    const lvNames = ['', 'Dasar', 'Menengah', 'Tantang'];
    $('#pgCount').textContent = `${s.n}/${s.total}`;
    $('#pgLevel').textContent = `Level ${s.level} · ${lvNames[s.level]}`;
    $('#pgStreak').textContent = `🔥 ${s.streak}`;
    $('#pgProgress').style.width = ((s.n - 1) / s.total) * 100 + '%';
    $('#pgQ').innerHTML = q.t ? `<p>${esc(q.t)}</p>` : `<div class="big-expr">${esc(exprOf(q.a, q.op, q.b))} = ?</div>`;
    $('#pgOpts').innerHTML = s.opts.map((v, i) => `<button class="opt" data-i="${i}" type="button">${esc(fmt(v) + (q.u || ''))}</button>`).join('');
    $$('#pgOpts .opt').forEach(b => b.onclick = () => this.answer(+b.dataset.i));
    $('#pgHint').hidden = true; $('#pgFeedback').hidden = true; $('#btnNext').hidden = true;
    $('#btnNext').textContent = s.n >= s.total ? 'Lihat hasil →' : 'Lanjut →';
  },
  answer(i) {
    const s = this.s; if (s.locked) return; s.locked = true;
    const q = s.q, c = calc(q.a, q.op, q.b), v = s.opts[i], ok = v === c;
    $$('#pgOpts .opt').forEach((b, j) => { b.disabled = true; if (s.opts[j] === c) b.classList.add('right'); else if (j === i) b.classList.add('wrong'); });
    s.log.push({ id: q.id, expr: exprOf(q.a, q.op, q.b), ans: v, res: c, ok, lv: q.lv });
    if (ok) { s.correct++; s.streak++; if (s.streak >= 2 && s.level < 3) { s.level++; s.streak = 0; } } else { s.streak = 0; s.level = Math.max(1, s.level - 1); }
    const fb = $('#pgFeedback'); fb.hidden = false; fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
    fb.innerHTML = ok ? `✅ <b>Tepat!</b> Model matematikanya: ${esc(exprOf(q.a, q.op, q.b))} = <b>${esc(fmt(c) + (q.u || ''))}</b>.` : `❌ Belum tepat. Model matematikanya: ${esc(exprOf(q.a, q.op, q.b))}. Perhatikan pembahasan di garis bilangan.`;
    $('#btnNext').hidden = false;
    $('#pgProgress').style.width = (s.n / s.total) * 100 + '%';
    if (!ok) setTimeout(() => Fb.open(q, v), 650);
  },
  finish() {
    const s = this.s; if (!s) return;
    const total = s.log.length;
    $('#playGame').hidden = true; $('#playEnd').hidden = false;
    if (!total) { $('#endScore').textContent = '–'; $('#endDetail').textContent = 'Belum ada soal yang dijawab.'; $('#endReview').innerHTML = ''; $('#endSync').textContent = ''; return; }
    const skor = Math.round((s.correct / total) * 100), dur = Math.round((Date.now() - s.t0) / 1000);
    $('#endScore').textContent = skor;
    $('#endDetail').textContent = `${s.correct} benar dari ${total} soal · level akhir ${s.level} · ${dur} detik`;
    $('#endReview').innerHTML = s.log.map(l => `<div class="${l.ok ? '' : 'x'}">${l.ok ? '✅' : '❌'} ${esc(l.expr)} = ${esc(fmt(l.res))}${l.ok ? '' : ` (jawabanmu ${esc(fmt(l.ans))})`}</div>`).join('');
    const entry = { id: `n_${uid()}_${Date.now()}`, ts: Date.now(), nama: user.nama, kelas: user.kelas, mode: s.mode, skor, benar: s.correct, total, level: s.level, durasi: dur, bantuan: s.hints, synced: false };
    const arr = load('mq_scores', []); arr.push(entry); save('mq_scores', arr);
    $('#endSync').textContent = Sync.on ? '⏳ Mengirim nilai ke guru…' : '💾 Nilai tersimpan di perangkat ini.';
    Sync.push({ kind: 'nilai', id: entry.id, data: entry }).then(() => {
      const e = load('mq_scores', []).find(x => x.id === entry.id);
      if (Sync.on) $('#endSync').textContent = e && e.synced ? '☁️ Nilai sudah terkirim ke guru.' : '⏳ Nilai akan dikirim otomatis saat koneksi tersedia.';
    });
  },
};

/* ===================== MODAL PEMBAHASAN ===================== */
const Fb = {
  nl: null, q: null, ans: null,
  init() {
    $('#btnFbClose').onclick = () => { closeModal('#fbModal'); if (this.nl) this.nl.token++; };
    $('#btnReplay').onclick = () => this.play();
  },
  open(q, ans) {
    this.q = q; this.ans = ans;
    openModal('#fbModal');
    $('#fbSteps').innerHTML = explainSteps(q.a, q.op, q.b, ans).map(t => `<li>${esc(t)}</li>`).join('');
    requestAnimationFrame(() => {
      if (!this.nl) { this.nl = new NumberLine($('#fbCanvas')); this.nl.onNote = t => { $('#fbNote').textContent = t; }; }
      this.nl.resize(); this.play();
    });
  },
  play() { if (this.q) this.nl.play(this.q.a, this.q.op, this.q.b, { wrong: this.ans }); },
};

/* ===================== PDF & CSV ===================== */
const pdfSafe = s => String(s ?? '').replace(/[−–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x09\x0A\x20-\x7E\u00A0-\u00FF]/g, '');
function makeLkmPdf(p) {
  const lib = window.jspdf && window.jspdf.jsPDF;
  if (!lib) { toast('Pustaka PDF belum termuat (cek koneksi internet).'); return; }
  const doc = new lib({ unit: 'mm', format: 'a4' }), M = 16, TW = 210 - 2 * M; let y = 18;
  const ensure = h => { if (y + h > 282) { doc.addPage(); y = 18; } };
  const H = (t, sz = 13) => { ensure(10); doc.setFont('helvetica', 'bold'); doc.setFontSize(sz); doc.setTextColor(30, 50, 120); doc.text(pdfSafe(t), M, y); y += 7; doc.setTextColor(0); };
  const P = (t, bold) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(10.5); const ls = doc.splitTextToSize(pdfSafe(t) || '-', TW); ls.forEach(l => { ensure(6); doc.text(l, M, y); y += 5.2; }); y += 1.5; };
  H('LKM Digital - MathQuest SMP Kelas VII', 15);
  P('Topik: Bilangan Bulat (Penjumlahan & Pengurangan)', true);
  P(`Nama: ${p.nama}   |   Kelas: ${p.kelas}   |   Dikumpulkan: ${fmtTime(p.ts)}   |   Skor LKM: ${p.skor}/100   |   Bantuan roket: ${p.bantuan || 0}x`);
  y += 2; H('1. Observation (Pengamatan)');
  (p.obs || []).forEach(r => P(`${r.soal} = ${fmt(r.hasil)}`));
  P('Temuan: ' + p.o1); P('Arah roket saat tanda "-": ' + p.o2); if (p.o3) P('Pertanyaan: ' + p.o3);
  H('2. Hypothesis (Dugaan)'); P('Dugaan 1: ' + p.hip1); P('Dugaan 2: ' + p.hip2);
  H('3. Experiment (Percobaan)');
  (p.exp || []).forEach(r => P(`a=${r.a}, b=${r.b} | a-b=${r.r1} | a+(-b)=${r.r2} | a-(-b)=${r.r3} | a+b=${r.r4}`));
  H('4. Conclusion (Kesimpulan)'); P(p.concl); P('Refleksi: ' + p.refl); P('Tingkat keyakinan: ' + (p.conf || '-') + ' / 4');
  doc.save(`LKM_${slug(p.nama)}_${slug(p.kelas)}.pdf`);
}
function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^-?\d+(\.\d+)?$/.test(s))) s = "'" + s; // cegah CSV injection
  return /[";,\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function downloadCsv(name, head, rows) {
  const csv = '\uFEFF' + [head, ...rows].map(r => r.map(csvCell).join(';')).join('\r\n'); // pemisah ; (Excel Indonesia)
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ===================== PANEL GURU ===================== */
const Teacher = {
  token: null, mode: 'lokal', nilai: [], lkm: [], rekap: [],
  init() {
    this.token = sessionStorage.getItem('mq_tok');
    $('#pinForm').onsubmit = e => { e.preventDefault(); this.login($('#pinInput').value.trim()); };
    $('#btnTReload').onclick = () => this.reload();
    $('#btnTLogout').onclick = () => this.logout();
    $('#btnTReset').onclick = () => this.resetAll();
    $('#tSearch').oninput = () => this.render(); $('#tKelas').onchange = () => this.render();
    $('#btnCsvRekap').onclick = () => downloadCsv('rekap_siswa.csv', ['Nama', 'Kelas', 'Kuis terbaik', 'Jumlah sesi', 'Status LKM', 'Skor LKM'], this.filtered().map(r => [r.nama, r.kelas, r.kuis ?? '', r.sesi, r.lkm ? r.lkm.status : 'Belum', r.lkm ? r.lkm.skor : '']));
    $('#btnCsvRiwayat').onclick = () => downloadCsv('riwayat_nilai.csv', ['Waktu', 'Nama', 'Kelas', 'Mode', 'Skor', 'Benar', 'Total', 'Level akhir', 'Durasi (dtk)', 'Bantuan'], this.nilai.filter(n => this.match(n)).sort((a, b) => b.ts - a.ts).map(n => [fmtTime(n.ts), n.nama, n.kelas, n.mode, n.skor, n.benar, n.total, n.level, n.durasi, n.bantuan ?? '']));
    if (this.token || (!Sync.on && sessionStorage.getItem('mq_tlocal'))) this.enter();
  },
  async login(pin) {
    const msg = $('#pinMsg'); msg.textContent = 'Memeriksa…';
    if (!pin) { msg.textContent = 'Masukkan PIN.'; return; }
    if (!Sync.on) {
      if (pin === CONFIG.LOCAL_TEACHER_PIN) { sessionStorage.setItem('mq_tlocal', '1'); this.enter(); } else msg.textContent = 'PIN salah.';
      return;
    }
    try {
      const r = await jsonp({ action: 'auth', pin });
      if (r.ok) { this.token = r.token; sessionStorage.setItem('mq_tok', r.token); $('#pinInput').value = ''; this.enter(); } else msg.textContent = r.error || 'PIN salah.';
    } catch { msg.textContent = 'Tidak dapat menghubungi server. Periksa koneksi dan URL Apps Script.'; }
  },
  logout() { this.token = null; sessionStorage.removeItem('mq_tok'); sessionStorage.removeItem('mq_tlocal'); $('#tPanel').hidden = true; $('#tGate').hidden = false; $('#pinMsg').textContent = ''; },
  enter() { $('#tGate').hidden = true; $('#tPanel').hidden = false; this.reload(); },
  wipeLocal(m) { // m = null (semua data) atau {nama, kelas}
    if (!m) {
      ['mq_scores', 'mq_queue'].forEach(k => localStorage.removeItem(k));
      const pre = ['mq_lkmsaved_', 'mq_lab_', 'mq_hyp_', 'mq_lkmdraft_'];
      for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && pre.some(p => k.startsWith(p))) localStorage.removeItem(k); }
      return;
    }
    const same = x => x && slug(x.nama) === slug(m.nama) && slug(x.kelas) === slug(m.kelas), id = slug(m.nama) + '__' + slug(m.kelas);
    save('mq_scores', load('mq_scores', []).filter(n => !same(n)));
    save('mq_queue', load('mq_queue', []).filter(q => !same(q.data)));
    ['lkmsaved', 'lab', 'hyp', 'lkmdraft'].forEach(n => localStorage.removeItem(`mq_${n}_${id}`));
  },
  async remote(params) {
    if (!Sync.on) return true;
    try {
      const r = await jsonp({ ...params, token: this.token });
      if (!r.ok) { toast(r.error || 'Gagal menghapus di server.'); return false; }
      return true;
    } catch { toast('Server tidak terjangkau; data belum dihapus.'); return false; }
  },
  async delStudent(r) {
    if (!confirm(`Hapus semua hasil ${r.nama} (${r.kelas})?\nNilai dan LKM siswa ini akan hilang dan tidak dapat dikembalikan.`)) return;
    if (!(await this.remote({ action: 'del', nama: r.nama, kelas: r.kelas }))) return;
    this.wipeLocal({ nama: r.nama, kelas: r.kelas });
    toast('Data siswa dihapus.'); await this.reload(); bootUser();
  },
  async resetAll() {
    const t = prompt('PERINGATAN: semua nilai dan LKM seluruh siswa akan dihapus permanen.\nKetik HAPUS untuk melanjutkan:');
    if (t === null) return;
    if (t.trim().toUpperCase() !== 'HAPUS') { toast('Dibatalkan: kata konfirmasi tidak sesuai.'); return; }
    if (!(await this.remote({ action: 'clear' }))) return;
    this.wipeLocal(null);
    toast('Semua data dihapus. Rekap kembali baru.'); await this.reload(); bootUser();
  },
  localData() {
    const nilai = load('mq_scores', []), lkm = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('mq_lkmsaved_')) { const v = load(k, null); if (v) lkm.push(v); } }
    return { nilai, lkm };
  },
  async reload() {
    const loc = this.localData(); let nilai = loc.nilai.slice(), lkm = loc.lkm.slice();
    if (Sync.on) {
      try {
        const [a, b] = await Promise.all([jsonp({ action: 'list', kind: 'nilai', token: this.token }), jsonp({ action: 'list', kind: 'lkm', token: this.token })]);
        if (!a.ok || !b.ok) { toast((a.error || b.error || 'Sesi berakhir') + ' — masuk ulang.'); this.logout(); return; }
        const mergeBy = (arr, extra) => { const m = new Map(arr.map(x => [x.id, x])); extra.forEach(x => { const o = m.get(x.id); if (!o || Number(x.ts) >= Number(o.ts)) m.set(x.id, x); }); return [...m.values()]; };
        nilai = mergeBy(nilai, a.rows || []); lkm = mergeBy(lkm, (b.rows || []).map(r => ({ ...(r.data || {}), id: r.id, ts: r.ts, nama: r.nama, kelas: r.kelas, skor: r.skor, status: r.status })));
        this.mode = 'online';
      } catch { toast('Gagal memuat dari server; menampilkan data lokal.'); this.mode = 'lokal (server tidak terjangkau)'; }
    } else this.mode = 'lokal';
    this.nilai = nilai; this.lkm = lkm; this.build();
  },
  build() {
    const map = new Map(), key = (n, k) => slug(n) + '|' + slug(k);
    const get = (n, k) => { const id = key(n, k); if (!map.has(id)) map.set(id, { nama: n, kelas: k, kuis: null, sesi: 0, lkm: null }); return map.get(id); };
    this.nilai.forEach(n => { const r = get(n.nama, n.kelas); r.sesi++; if (n.mode === 'kuis') r.kuis = Math.max(r.kuis ?? 0, Number(n.skor)); });
    this.lkm.forEach(l => { get(l.nama, l.kelas).lkm = l; });
    this.rekap = [...map.values()].sort((a, b) => (a.kelas + a.nama).localeCompare(b.kelas + b.nama));
    const ks = [...new Set(this.rekap.map(r => r.kelas))].sort(), sel = $('#tKelas'), cur = sel.value;
    sel.innerHTML = '<option value="">Semua kelas</option>' + ks.map(k => `<option>${esc(k)}</option>`).join(''); sel.value = ks.includes(cur) ? cur : '';
    this.render();
  },
  match(r) { const q = $('#tSearch').value.trim().toLowerCase(), k = $('#tKelas').value; return (!q || String(r.nama).toLowerCase().includes(q)) && (!k || r.kelas === k); },
  filtered() { return this.rekap.filter(r => this.match(r)); },
  render() {
    const rows = this.filtered(), kuis = rows.filter(r => r.kuis !== null);
    const avg = kuis.length ? Math.round(kuis.reduce((s, r) => s + r.kuis, 0) / kuis.length) : '–';
    $('#tMode').textContent = 'Mode: ' + this.mode;
    $('#tStats').innerHTML = `<div class="stat"><b>${rows.length}</b><small>Siswa</small></div><div class="stat"><b>${avg}</b><small>Rata-rata kuis terbaik</small></div><div class="stat"><b>${rows.filter(r => r.lkm).length}/${rows.length}</b><small>LKM terkumpul</small></div>`;
    $('#tRekapBody').innerHTML = rows.length ? rows.map((r, i) => `<tr><td>${esc(r.nama)}</td><td>${esc(r.kelas)}</td><td>${r.kuis ?? '–'}</td><td>${r.sesi}</td><td>${r.lkm ? '✅ Terkumpul' : '⬜ Belum'}</td><td>${r.lkm ? esc(r.lkm.skor) : '–'}</td><td>${r.lkm ? `<button class="btn sm pdf" data-i="${i}" type="button">PDF</button>` : ''}</td><td><button class="btn sm red del" data-i="${i}" type="button">🗑 Hapus</button></td></tr>`).join('') : '<tr><td colspan="8" class="muted">Belum ada data.</td></tr>';
    $$('#tRekapBody .pdf').forEach(b => b.onclick = () => { const l = rows[+b.dataset.i].lkm; if (!l.o1 && Sync.on) { toast('Data LKM lengkap belum tersedia; muat ulang.'); return; } makeLkmPdf(l); });
    $$('#tRekapBody .del').forEach(b => b.onclick = () => this.delStudent(rows[+b.dataset.i]));
    const rw = this.nilai.filter(n => this.match(n)).sort((a, b) => b.ts - a.ts).slice(0, 200);
    $('#tRiwayatBody').innerHTML = rw.length ? rw.map(n => `<tr><td>${esc(fmtTime(n.ts))}</td><td>${esc(n.nama)}</td><td>${esc(n.kelas)}</td><td>${esc(n.mode)}</td><td><b>${esc(n.skor)}</b></td><td>${esc(n.benar)}/${esc(n.total)}</td><td>${esc(n.level)}</td></tr>`).join('') : '<tr><td colspan="7" class="muted">Belum ada riwayat.</td></tr>';
  },
};

/* ===================== INISIALISASI ===================== */
document.addEventListener('DOMContentLoaded', () => {
  $$('.tab-btn').forEach(b => b.onclick = () => showTab(b.dataset.tab));
  $$('.go-tab').forEach(b => b.onclick = () => showTab(b.dataset.go));
  Lab.init(); Explore.init(); Hyp.init(); Summary.init(); LKM.init(); Play.init(); Fb.init(); Teacher.init();

  $('#loginForm').onsubmit = e => {
    e.preventDefault();
    const nama = $('#inpNama').value.trim().replace(/\s+/g, ' '), kelas = $('#inpKelas').value.trim().toUpperCase();
    if (nama.length < 2 || !kelas) return;
    user = { nama, kelas }; save('mq_user', user); closeModal('#loginModal'); bootUser(); toast(`Halo, ${nama}! 🚀`);
  };
  $('#btnSwitchUser').onclick = () => { if (user) { $('#inpNama').value = user.nama; $('#inpKelas').value = user.kelas; } openModal('#loginModal'); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { const m = $('#fbModal'); if (m.classList.contains('open')) $('#btnFbClose').click(); } });
  window.addEventListener('online', () => Sync.flush());

  bootUser();
  if (!user) openModal('#loginModal');
  Sync.flush();
});