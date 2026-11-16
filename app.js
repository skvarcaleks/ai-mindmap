/* Aleks's AI mindmap – app (GitHub Pages + Supabase) */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const CFG = window.MINDMAP_CONFIG || {};
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ico = n => `<svg class="i"><use href="#i-${n}"/></svg>`;
const BUCKET = 'files';
const MAX_FILE = 8 * 1048576;

/* ---------------- kinds ---------------- */
const KINDS = [
  { id: 'misel', label: 'misel', c: '#e6e9f5', g: '✦', hint: 'Ideja ali opažanje, karkoli se ti zdi vredno zapisati.' },
  { id: 'odlocitev', label: 'odločitev', c: '#ffb454', g: '★', hint: 'Nekaj, kar je dogovorjeno in velja.' },
  { id: 'todo', label: 'za narediti', c: '#ff6b6b', g: '◌', hint: 'Naloga ali odprto vprašanje.' },
  { id: 'povezava', label: 'povezava', c: '#7ee0ff', g: '↗', hint: 'Spletna stran ali vir. Prilepi naslov v besedilo.' },
  { id: 'datoteka', label: 'datoteka', c: '#c3a6ff', g: '▣', hint: 'Slika, PDF ali dokument. Pripni ga spodaj.' }
];
const K = Object.fromEntries(KINDS.map(k => [k.id, k]));

/* ---------------- state ---------------- */
let sb = null;
let me = null;            // { id, username, is_admin, can_create }
let projects = [];        // [{ id, name, code, created_at, count }]
let cur = null;           // project id
let entries = [];         // entries of current project
let urls = {};            // storage path -> signed url
let kind = 'misel', fkind = null, pending = [], editing = null, busy = false, lastLoad = 0;

/* ---------------- helpers ---------------- */
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const linkify = s => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
const pad = n => String(n).padStart(2, '0');
const stamp = t => { const x = new Date(t); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())} ${pad(x.getHours())}:${pad(x.getMinutes())}`; };
const kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const P = () => projects.find(p => p.id === cur);
const catalog = (p, i) => `${p.code}-${String(i + 1).padStart(3, '0')}`;
const rnd = s => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return () => { h = (h * 1103515245 + 12345) | 0; return ((h >>> 16) & 0x7fff) / 0x7fff; }; };
const radec = (x, y, w, h) => { const ra = x / w * 24, dec = 90 - y / h * 180; return `RA ${pad(Math.floor(ra))}h ${pad(Math.floor(ra % 1 * 60))}m  DEC ${dec >= 0 ? '+' : '−'}${pad(Math.abs(Math.round(dec)))}°`; };
const ago = t => {
  if (!t) return 'še nikoli';
  const m = Math.round((Date.now() - new Date(t).getTime()) / 60000);
  if (m < 2) return 'pravkar'; if (m < 60) return `pred ${m} min`;
  const h = Math.round(m / 60); if (h < 24) return `pred ${h} h`;
  const d = Math.round(h / 24); if (d < 45) return `pred ${d} ${d === 1 ? 'dnevom' : 'dnevi'}`;
  return stamp(t).slice(0, 10);
};
const isImg = f => (f.type || '').startsWith('image/');
const toEmail = u => `${u}@${CFG.USER_DOMAIN || 'mindmap.local'}`;
let toastT;
function toast(m) { const t = $('#toast'); t.textContent = '> ' + m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2400); }
function fail(where, err) { console.error(where, err); toast(`napaka (${where}): ${err?.message || err}`); }
function confirmBtn(btn, label, fn) {
  let armed = false; const orig = btn.innerHTML;
  btn.onclick = () => {
    if (!armed) { armed = true; btn.classList.add('armed'); btn.innerHTML = ico('trash') + label; setTimeout(() => { armed = false; btn.classList.remove('armed'); btn.innerHTML = orig; }, 2600); return; }
    fn();
  };
}
function safeName(n) { return n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'datoteka'; }

/* ---------------- sky ---------------- */
const sky = $('#sky'), sx = sky.getContext('2d');
let W, H, stars = [], mouse = { x: -999, y: -999 }, meteors = [];
function sizeSky() {
  const r = devicePixelRatio || 1; W = innerWidth; H = innerHeight; sky.width = W * r; sky.height = H * r; sx.setTransform(r, 0, 0, r, 0, 0);
  const n = Math.min(340, Math.floor(W * H / 4800));
  stars = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, z: Math.random(), r: Math.random() < .06 ? 1.6 : Math.random() * .9 + .3, p: Math.random() * 6.28, s: .4 + Math.random() * 1.6, h: Math.random() < .12 ? '#ffd9a8' : Math.random() < .12 ? '#bfe9ff' : '#e6e9f5' }));
}
addEventListener('resize', sizeSky); sizeSky();
// crosshair, parallax and sky coordinates follow a real mouse only (not taps on a touch screen)
addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse') { mouse.x = mouse.y = -999; return; }
  mouse.x = e.clientX; mouse.y = e.clientY;
  const sl = $('#slCoord'); if (sl) sl.textContent = radec(e.clientX, e.clientY, W, H);
});
addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') mouse.x = mouse.y = -999; });
if (matchMedia('(hover: none)').matches) { const ch = document.getElementById('chartHelp'); if (ch) ch.textContent = 'tapni zvezdo za vnos'; }
function meteor() { meteors.push({ x: W * (.3 + Math.random() * .7), y: Math.random() * H * .35, vx: -7 - Math.random() * 4, vy: 3 + Math.random() * 2.5, l: 1 }); }
function drawSky(ts) {
  const t = ts / 1000; sx.clearRect(0, 0, W, H);
  const px = (mouse.x - W / 2) / W, py = (mouse.y - H / 2) / H, near = [];
  for (const s of stars) {
    const x = (s.x + (reduce ? 0 : px * s.z * -16) + W) % W, y = (s.y + (reduce ? 0 : py * s.z * -16) + H) % H;
    const tw = reduce ? 1 : .5 + .5 * Math.sin(t * s.s + s.p);
    sx.globalAlpha = tw * (.3 + s.z * .7); sx.fillStyle = s.h;
    if (s.r > 1.4) { sx.fillRect(x - .5, y - 2.5, 1, 5); sx.fillRect(x - 2.5, y - .5, 5, 1); }
    sx.fillRect(x - s.r / 2, y - s.r / 2, s.r, s.r);
    const dx = x - mouse.x, dy = y - mouse.y; if (dx * dx + dy * dy < 150 * 150) near.push({ x, y, d: Math.hypot(dx, dy) });
  }
  near.sort((a, b) => a.d - b.d);
  sx.strokeStyle = '#ffb454'; sx.lineWidth = .7; sx.setLineDash([3, 3]);
  near.slice(0, 5).forEach((p, i, a) => { if (!a[i + 1]) return; sx.globalAlpha = .45 * (1 - p.d / 150); sx.beginPath(); sx.moveTo(p.x, p.y); sx.lineTo(a[i + 1].x, a[i + 1].y); sx.stroke(); });
  sx.setLineDash([]);
  if (mouse.x > 0) {
    sx.globalAlpha = .3; sx.strokeStyle = '#7ee0ff'; sx.beginPath(); sx.arc(mouse.x, mouse.y, 22, 0, 6.283);
    [[-30, 0, -14, 0], [14, 0, 30, 0], [0, -30, 0, -14], [0, 14, 0, 30]].forEach(([a, b, c, e]) => { sx.moveTo(mouse.x + a, mouse.y + b); sx.lineTo(mouse.x + c, mouse.y + e); });
    sx.stroke();
  }
  meteors = meteors.filter(m => m.l > 0);
  for (const m of meteors) { sx.globalAlpha = m.l; sx.strokeStyle = '#fff'; sx.lineWidth = 1.2; sx.beginPath(); sx.moveTo(m.x, m.y); sx.lineTo(m.x - m.vx * 10, m.y - m.vy * 10); sx.stroke(); m.x += m.vx; m.y += m.vy; m.l -= .015; }
  sx.globalAlpha = 1;
  if (!reduce && Math.random() < .002) meteor();
  if (!reduce) requestAnimationFrame(drawSky);
}
requestAnimationFrame(drawSky);

/* ---------------- data access ---------------- */
async function loadMe() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data, error } = await sb.from('profiles').select('id,username,is_admin,can_create,must_change_pw,blocked').eq('id', user.id).single();
  if (error) throw error;
  return data;
}
async function loadProjects() {
  const { data, error } = await sb.from('projects').select('id,name,code,created_at,entries(count)').order('created_at');
  if (error) throw error;
  projects = data.map(p => ({ id: p.id, name: p.name, code: p.code, created_at: p.created_at, count: p.entries?.[0]?.count ?? 0 }));
  if (!projects.find(p => p.id === cur)) {
    let saved = null; try { saved = localStorage.getItem('aimm-cur-' + me.id); } catch (e) {}
    cur = projects.find(p => p.id === saved)?.id || projects[0]?.id || null;
  }
}
async function loadEntries() {
  entries = []; urls = {};
  if (!cur) return;
  const { data, error } = await sb.from('entries')
    .select('id,project_id,kind,text,files,created_at,edited_at,author,author_name')
    .eq('project_id', cur).order('created_at');
  if (error) throw error;
  entries = data.map(e => ({ ...e, t: new Date(e.created_at).getTime(), files: e.files || [], whoName: e.author_name || 'nekdo' }));
  const paths = entries.flatMap(e => e.files.map(f => f.path)).filter(Boolean);
  if (paths.length) {
    const { data: signed, error: se } = await sb.storage.from(BUCKET).createSignedUrls(paths, 60 * 60 * 6);
    if (se) console.warn(se);
    (signed || []).forEach(s => { if (s.signedUrl) urls[s.path] = s.signedUrl; });
  }
  const p = P(); if (p) p.count = entries.length;
  lastLoad = Date.now();
}
const fileUrl = (f, download) => { const u = urls[f.path]; if (!u) return '#'; return download ? u + (u.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(f.name) : u; };

/* ---------------- render: sidebar ---------------- */
function renderProjects() {
  const ul = $('#projects'); ul.innerHTML = '';
  if (!projects.length) ul.innerHTML = `<li class="muted" style="padding:8px 0">${me.is_admin || me.can_create ? 'Še ni projektov. Ustvari prvega spodaj.' : 'Še nimaš dostopa do nobenega projekta. Prosi Aleksa, da ti ga dodeli.'}</li>`;
  projects.forEach((p, i) => {
    const li = document.createElement('li'); const on = p.id === cur;
    li.innerHTML = `<button class="proj" type="button" aria-current="${on}"><span class="mk">${on ? '▸' : String(i + 1).padStart(2, '0')}</span><span class="nm">${esc(p.name)}</span><span class="ct">${p.count}★</span></button>`;
    li.querySelector('button').onclick = () => selectProject(p.id);
    ul.append(li);
  });
  const sel = $('#projSelect');
  sel.innerHTML = projects.length ? projects.map(p => `<option value="${p.id}"${p.id === cur ? ' selected' : ''}>${esc(p.name)} · ${p.count}★</option>`).join('') : '<option value="">ni projektov</option>';
  sel.disabled = !projects.length;
  $('#addProj').hidden = !(me.can_create || me.is_admin) || $('#newProj').classList.contains('on');
  $('#adminBtn').hidden = !me.is_admin;
  $('#whoami').textContent = me.username;
  $('#roleBadge').textContent = me.is_admin ? 'admin' : 'član';
  $('#roleBadge').classList.toggle('adm', me.is_admin);
}
async function selectProject(id) {
  cur = id; editing = null; try { localStorage.setItem('aimm-cur-' + me.id, id); } catch (e) {}
  renderHead(); renderProjects();
  $('#feed').innerHTML = '<li class="loading">&gt; nalagam vnose…</li>';
  try { await loadEntries(); } catch (e) { fail('nalaganje vnosov', e); }
  renderAll();
}

$('#projSelect').addEventListener('change', e => { if (e.target.value) selectProject(e.target.value); });

/* ---------------- render: kinds ---------------- */
function seg(box, list, isOn, onPick) {
  box.innerHTML = '';
  list.forEach(x => {
    const b = document.createElement('button'); b.type = 'button';
    b.innerHTML = `<span class="g">${x.g}</span>${x.label}`; b.style.setProperty('--c', x.c);
    b.setAttribute('aria-pressed', isOn(x)); if (x.hint) b.title = x.hint; b.onclick = () => onPick(x); box.append(b);
  });
}
function renderKinds() {
  seg($('#kinds'), KINDS, x => x.id === kind, x => { kind = x.id; renderKinds(); if (x.id === 'datoteka') $('#dropzone').focus(); });
  $('#kindHint').textContent = K[kind].hint;
  seg($('#fkinds'), [{ id: null, label: 'vse', c: '#e6e9f5', g: '∗' }, ...KINDS], x => x.id === fkind, x => { fkind = x.id; renderKinds(); renderFeed(); });
}

/* ---------------- render: feed ---------------- */
function filesHtml(files) {
  const imgs = files.filter(isImg), other = files.filter(f => !isImg(f));
  return `<div class="files">${imgs.map((f, i) => `<button class="imgbtn" type="button" data-img="${i}" aria-label="Povečaj ${esc(f.name)}"><img src="${esc(fileUrl(f))}" alt="${esc(f.name)}" loading="lazy"></button>`).join('')}${other.map(f => `<a class="fileline" href="${esc(fileUrl(f, true))}" target="_blank" rel="noopener" title="Prenesi ${esc(f.name)}">${ico('file')}<span>${esc(f.name)}</span><span style="color:var(--dim)">${kb(f.size)}</span></a>`).join('')}</div>`;
}
function renderFeed() {
  const p = P(), ul = $('#feed'); ul.innerHTML = ''; if (!p) return;
  const q = $('#q').value.trim().toLowerCase();
  const list = entries.map((e, i) => ({ e, i })).filter(({ e }) => (!fkind || e.kind === fkind) && (!q || (e.text || '').toLowerCase().includes(q) || e.files.some(f => f.name.toLowerCase().includes(q)))).reverse();
  if (!list.length) {
    ul.innerHTML = entries.length
      ? `<li class="empty"><b>Ni zadetkov.</b><span>Poskusi drugo besedo ali izberi filter »vse«.</span></li>`
      : `<li class="empty"><b>Ta projekt je še prazen.</b><span>Zapiši prvo misel v polje zgoraj in pritisni Shrani vnos.</span></li>`;
    return;
  }
  list.forEach(({ e, i }) => {
    const k = K[e.kind] || K.misel, li = document.createElement('li');
    li.className = 'entry'; li.id = 'e-' + e.id; li.style.setProperty('--c', k.c);
    const mine = e.author === me.id || me.is_admin;
    li.innerHTML = `<span class="glyph" aria-hidden="true">${k.g}</span><div style="min-width:0">
      <div class="meta"><span>${stamp(e.t)}</span><span>${catalog(p, i)}</span><span class="cat">${k.label}</span><span class="who">@${esc(e.whoName)}</span>${e.edited_at ? '<span>· urejeno</span>' : ''}</div>
      ${editing === e.id
        ? `<div class="edit"><textarea aria-label="Uredi vnos">${esc(e.text)}</textarea><div class="eb"><button class="btn sm primary" type="button" data-save>Shrani</button><button class="btn sm" type="button" data-cancel>Prekliči</button></div></div>`
        : (e.text ? `<div class="body">${linkify(e.text)}</div>` : '')}
      ${e.files.length ? filesHtml(e.files) : ''}
    </div>${mine ? `<div class="acts"><button class="ghost" type="button" data-edit aria-label="Uredi">${ico('edit')}</button><button class="ghost danger" type="button" data-del aria-label="Izbriši">${ico('trash')}</button></div>` : '<span></span>'}`;
    const imgs = e.files.filter(isImg);
    li.querySelectorAll('[data-img]').forEach(b => b.onclick = () => openLightbox(imgs[+b.dataset.img]));
    if (mine) {
      li.querySelector('[data-edit]').onclick = () => { editing = e.id; renderFeed(); document.querySelector(`#e-${e.id} textarea`)?.focus(); };
      confirmBtn(li.querySelector('[data-del]'), 'res?', () => deleteEntry(e));
    }
    if (editing === e.id) {
      const ta = li.querySelector('.edit textarea');
      li.querySelector('[data-save]').onclick = () => updateEntry(e, ta.value.trim());
      li.querySelector('[data-cancel]').onclick = () => { editing = null; renderFeed(); };
      ta.addEventListener('keydown', ev => { if (ev.key === 'Escape') { editing = null; renderFeed(); } if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) li.querySelector('[data-save]').click(); });
    }
    ul.append(li);
  });
}
async function updateEntry(e, text) {
  const { error } = await sb.from('entries').update({ text, edited_at: new Date().toISOString() }).eq('id', e.id);
  if (error) return fail('urejanje', error);
  e.text = text; e.edited_at = new Date().toISOString(); editing = null; renderFeed(); toast('shranjeno');
}
async function deleteEntry(e) {
  const paths = e.files.map(f => f.path).filter(Boolean);
  const { error } = await sb.from('entries').delete().eq('id', e.id);
  if (error) return fail('brisanje', error);
  if (paths.length) { const { error: se } = await sb.storage.from(BUCKET).remove(paths); if (se) console.warn(se); }
  entries = entries.filter(x => x.id !== e.id); const p = P(); if (p) p.count = entries.length;
  renderAll(); toast('vnos izbrisan');
}

/* ---------------- render: chart ---------------- */
let chartPts = [];
function renderChart() {
  const cv = $('#constel'), r = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * r; cv.height = h * r; const c = cv.getContext('2d'); c.scale(r, r);
  chartPts = []; c.clearRect(0, 0, w, h);
  c.strokeStyle = '#1d2340'; c.lineWidth = 1; c.setLineDash([2, 4]);
  for (let i = 1; i < KINDS.length; i++) { const y = Math.round(i / KINDS.length * h) + .5; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
  for (let i = 1; i < 6; i++) { const x = Math.round(i / 6 * w) + .5; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
  c.setLineDash([]);
  $('#ticksY').innerHTML = KINDS.map(k => `<span style="color:${k.c}" title="${k.label}">${k.g}</span>`).join('');
  const es = entries;
  if (!es.length) { $('#t0').textContent = '—'; $('#t1').textContent = '—'; c.fillStyle = '#454b6b'; c.font = '12px "IBM Plex Mono",monospace'; c.fillText('še ni zvezd', 14, 24); return; }
  const t0 = Math.min(...es.map(e => e.t)), t1 = Math.max(...es.map(e => e.t)), px = 16;
  $('#t0').textContent = stamp(t0).slice(0, 10); $('#t1').textContent = stamp(t1).slice(0, 10);
  const idx = Object.fromEntries(KINDS.map((k, i) => [k.id, i]));
  es.forEach((e, i) => {
    const j = rnd(e.id); const x = t1 === t0 ? w / 2 : px + (e.t - t0) / (t1 - t0) * (w - px * 2);
    const y = ((idx[e.kind] ?? 0) + .5) / KINDS.length * h + (j() - .5) * 16; chartPts.push({ x, y, e, i });
  });
  const o = [...chartPts].sort((a, b) => a.e.t - b.e.t);
  c.strokeStyle = 'rgba(255,180,84,.55)'; c.lineWidth = 1; c.beginPath(); o.forEach((q, i) => i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)); c.stroke();
  o.forEach(q => {
    const col = (K[q.e.kind] || K.misel).c, s = 2 + Math.min(2, (q.e.text || '').length / 150) + (q.e.files.length ? 1 : 0);
    c.fillStyle = col; c.globalAlpha = .25; c.fillRect(q.x - s * 2, q.y - s * 2, s * 4, s * 4); c.globalAlpha = 1;
    c.fillRect(q.x - s / 2, q.y - s / 2, s, s); c.fillRect(q.x - .5, q.y - s * 1.6, 1, s * 3.2); c.fillRect(q.x - s * 1.6, q.y - .5, s * 3.2, 1);
  });
}
const cvC = $('#constel'), tip = $('#tip');
const hitAt = ev => { const b = cvC.getBoundingClientRect(), x = ev.clientX - b.left, y = ev.clientY - b.top; return { x, y, b, hit: chartPts.find(q => Math.hypot(q.x - x, q.y - y) < 12) }; };
cvC.addEventListener('pointermove', ev => {
  const { x, y, b, hit } = hitAt(ev);
  if (hit) { tip.style.opacity = 1; tip.textContent = `${catalog(P(), hit.i)} › ${(hit.e.text || hit.e.files[0]?.name || '').slice(0, 90)}`; tip.style.left = Math.max(0, Math.min(x + 12, b.width - 260)) + 'px'; tip.style.top = (y + 14) + 'px'; cvC.style.cursor = 'pointer'; }
  else { tip.style.opacity = 0; cvC.style.cursor = 'default'; }
});
cvC.addEventListener('pointerleave', () => tip.style.opacity = 0);
cvC.addEventListener('click', ev => {
  const { hit } = hitAt(ev); if (!hit) return; fkind = null; $('#q').value = ''; renderKinds(); renderFeed();
  const el = document.getElementById('e-' + hit.e.id); el?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  el?.classList.add('flash'); setTimeout(() => el?.classList.remove('flash'), 1400);
});
addEventListener('resize', () => { if (!$('#app').hidden) renderChart(); });

function renderHead() {
  const p = P();
  $('#composer').hidden = !p; $('#ctxBtn').disabled = !p;
  $('#projTools').hidden = !(p && me?.is_admin) || !$('#renameForm').hidden;
  if (p) {
    const i = projects.indexOf(p), g = rnd(p.id);
    $('#projTitle').textContent = p.name;
    $('#projCode').textContent = `${p.code}-${pad(i + 1)} · RA ${pad(Math.floor(g() * 24))}h ${pad(Math.floor(g() * 60))}m · DEC +${pad(Math.floor(g() * 80))}°`;
    $('#chartLbl').innerHTML = `star chart · <b>${p.count}</b> vnosov · čas →`; $('#slProj').textContent = p.name;
  } else { $('#projTitle').textContent = 'Ni projekta'; $('#projCode').textContent = '—'; $('#slProj').textContent = '—'; }
  $('#slCount').textContent = projects.reduce((a, x) => a + x.count, 0) + ' ★ skupaj';
}
function renderAll() { renderHead(); renderProjects(); renderKinds(); renderFeed(); renderChart(); updateSave(); }

/* ---------------- auth ---------------- */
async function enterApp() {
  try { me = await loadMe(); } catch (e) { fail('profil', e); }
  if (!me) { showLogin(); return; }
  if (me.blocked) { await sb.auth.signOut(); me = null; showLogin('Ta račun je blokiran. Obrni se na Aleksa.'); return; }
  if (me.must_change_pw) { showPwGate(true); return; }
  sb.rpc('touch_seen').then(({ error }) => error && console.warn(error));
  $('#psUser').textContent = me.username;
  $('#boot').hidden = true; $('#login').hidden = true; $('#pwGate').hidden = true; $('#app').hidden = false;
  $('#feed').innerHTML = '<li class="loading">&gt; nalagam…</li>';
  try { await loadProjects(); await loadEntries(); } catch (e) { fail('nalaganje', e); }
  renderAll();
  let seen = false; try { seen = localStorage.getItem('aimm-howto-' + me.id) === '1'; } catch (e) {}
  $('#howto').hidden = seen;
  if (!reduce) for (let i = 0; i < 3; i++) setTimeout(meteor, i * 200);
}
function showLogin(msg) {
  $('#boot').hidden = true; $('#app').hidden = true; $('#pwGate').hidden = true; $('#login').hidden = false;
  $('#gateErr').textContent = msg || ''; $('#u').focus();
}
$('#gateForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const u = $('#u').value.trim().toLowerCase(), pw = $('#p').value;
  if (!u || !pw) { $('#gateErr').textContent = 'Vpiši uporabniško ime in geslo.'; return; }
  const btn = $('#gateForm button[type=submit]'); btn.disabled = true; $('#gateErr').textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email: toEmail(u), password: pw });
  btn.disabled = false;
  if (error) {
    $('#gateErr').textContent = /banned/i.test(error.message) ? 'Ta račun je blokiran. Obrni se na Aleksa.'
      : /invalid/i.test(error.message) ? 'Napačno uporabniško ime ali geslo.' : 'Prijava ni uspela: ' + error.message;
    return;
  }
  $('#p').value = '';
  enterApp();
});
$('#logout').onclick = async () => { stopRec(); await sb.auth.signOut(); me = null; projects = []; entries = []; cur = null; showLogin(); };
$('#howtoX').onclick = () => { $('#howto').hidden = true; try { localStorage.setItem('aimm-howto-' + me.id, '1'); } catch (e) {} };
$('#helpBtn').onclick = () => { $('#howto').hidden = !$('#howto').hidden; };

/* ---------------- projects ---------------- */
function closeNewProj() { $('#newProj').classList.remove('on'); $('#addProj').hidden = false; }
$('#addProj').onclick = () => { $('#newProj').classList.add('on'); $('#addProj').hidden = true; $('#newProjName').focus(); };
$('#newProjName').addEventListener('keydown', e => { if (e.key === 'Escape') closeNewProj(); });
$('#newProj').addEventListener('submit', async ev => {
  ev.preventDefault(); const n = $('#newProjName').value.trim(); if (!n) return;
  const code = (n.normalize('NFD').replace(/[^A-Za-z]/g, '').slice(0, 3) || 'NEW').toUpperCase();
  const { data, error } = await sb.from('projects').insert({ name: n, code, created_by: me.id }).select('id').single();
  if (error) return fail('nov projekt', error);
  $('#newProjName').value = ''; closeNewProj();
  await loadProjects(); await selectProject(data.id);
  toast('projekt ustvarjen: ' + n); $('#text').focus();
});

/* ---------------- composer ---------------- */
function updateSave() { $('#saveBtn').disabled = busy || (!$('#text').value.trim() && !pending.length); }
function addFiles(list) {
  [...list].forEach(f => {
    if (f.size > MAX_FILE) { toast(f.name + ' je večja od 8 MB'); return; }
    const item = { file: f, name: f.name, type: f.type || 'application/octet-stream', size: f.size, preview: isImg(f) ? URL.createObjectURL(f) : null };
    pending.push(item);
  });
  renderPending();
}
function renderPending() {
  const box = $('#pending'); box.innerHTML = '';
  pending.forEach((f, i) => {
    const s = document.createElement('div'); s.className = 'pfile';
    s.innerHTML = `<span class="th">${f.preview ? `<img src="${f.preview}" alt="">` : ico('file')}</span><span style="min-width:0"><span class="nm" style="display:block">${esc(f.name)}</span><span class="sz">${kb(f.size)}</span></span><button class="rm" type="button" aria-label="Odstrani ${esc(f.name)}">${ico('x')}</button>`;
    s.querySelector('.rm').onclick = () => { if (f.preview) URL.revokeObjectURL(f.preview); pending.splice(i, 1); renderPending(); };
    box.append(s);
  });
  updateSave();
}
const dz = $('#dropzone'), comp = $('#composer');
dz.onclick = () => $('#file').click();
$('#file').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
['dragenter', 'dragover'].forEach(t => comp.addEventListener(t, e => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => comp.addEventListener(t, e => { e.preventDefault(); if (t === 'drop' || !comp.contains(e.relatedTarget)) dz.classList.remove('over'); }));
comp.addEventListener('drop', e => addFiles(e.dataTransfer.files));
$('#text').addEventListener('input', updateSave);
$('#text').addEventListener('paste', e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } });
$('#text').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); comp.requestSubmit(); } });
comp.addEventListener('submit', async ev => {
  ev.preventDefault();
  const text = $('#text').value.trim(); if ((!text && !pending.length) || busy || !cur) return;
  busy = true; updateSave(); stopRec();
  const projectId = cur, k = pending.length && !text ? 'datoteka' : kind, uploaded = [];
  try {
    for (let i = 0; i < pending.length; i++) {
      const f = pending[i];
      $('#status').textContent = `nalagam datoteko ${i + 1}/${pending.length}: ${f.name}…`;
      const path = `${projectId}/${crypto.randomUUID()}/${safeName(f.name)}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, f.file, { contentType: f.type, upsert: false });
      if (error) throw error;
      uploaded.push({ name: f.name, type: f.type, size: f.size, path });
    }
    $('#status').textContent = 'shranjujem…';
    const { error } = await sb.from('entries').insert({ project_id: projectId, kind: k, text, files: uploaded, author: me.id });
    if (error) throw error;
  } catch (e) {
    if (uploaded.length) await sb.storage.from(BUCKET).remove(uploaded.map(u => u.path));
    busy = false; $('#status').textContent = ''; updateSave(); return fail('shranjevanje', e);
  }
  pending.forEach(f => f.preview && URL.revokeObjectURL(f.preview));
  pending = []; $('#text').value = ''; renderPending(); $('#status').textContent = '';
  busy = false; fkind = null; $('#q').value = '';
  if (cur === projectId) { try { await loadEntries(); } catch (e) { fail('osvežitev', e); } }
  renderAll(); toast('vnos shranjen ★'); if (!reduce) meteor();
  const first = $('#feed .entry'); first?.classList.add('flash'); setTimeout(() => first?.classList.remove('flash'), 1400);
});

/* ---------------- speech to text ---------------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, recOn = false, base = '';
function setMic(on) { recOn = on; $('#micBtn').classList.toggle('rec', on); $('#micIco').innerHTML = `<use href="#i-${on ? 'stop' : 'mic'}"/>`; $('#micLbl').textContent = on ? 'Ustavi' : 'Narekuj'; }
function stopRec() { if (rec && recOn) rec.stop(); }
$('#micBtn').onclick = () => {
  if (!SR) { $('#status').textContent = 'Ta brskalnik ne podpira narekovanja. Uporabi Chrome, Edge ali Safari.'; return; }
  if (recOn) { stopRec(); return; }
  rec = new SR(); rec.lang = $('#lang').value; rec.interimResults = true; rec.continuous = true;
  base = $('#text').value; if (base && !/\s$/.test(base)) base += ' ';
  rec.onresult = e => {
    let fin = '', tmp = '';
    for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; e.results[i].isFinal ? fin += t : tmp += t; }
    if (fin) base += fin.trim() + ' '; $('#text').value = base + tmp; updateSave();
  };
  rec.onstart = () => { setMic(true); $('#status').innerHTML = '<span class="rec-dot"></span>Poslušam… govori, besedilo se izpisuje sproti. Za konec pritisni Ustavi.'; };
  rec.onend = () => { setMic(false); if ($('#status').textContent.startsWith('Poslušam')) $('#status').textContent = ''; };
  rec.onerror = e => { setMic(false); $('#status').textContent = (e.error === 'not-allowed' || e.error === 'service-not-allowed') ? 'Dostop do mikrofona je zavrnjen. Dovoli ga v nastavitvah brskalnika (ikona ključavnice ob naslovu).' : 'Narekovanje se je ustavilo (' + e.error + '). Poskusi znova.'; };
  try { rec.start(); } catch (err) { $('#status').textContent = 'Narekovanja ni bilo mogoče zagnati.'; }
};

/* ---------------- sheets ---------------- */
function openSheet(id, focus) { $(id).hidden = false; (focus ? $(focus) : $(id).querySelector('button'))?.focus(); }
document.querySelectorAll('.overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o || e.target.closest('[data-close]')) o.hidden = true; }));
addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.overlay').forEach(o => o.hidden = true); });
function openLightbox(f) { $('#lbImg').src = fileUrl(f); $('#lbImg').alt = f.name; $('#lbCap').textContent = `${f.name} · ${kb(f.size)}`; openSheet('#lightbox'); }

/* context export */
function contextMd(p, links = {}) {
  const L = [`# ${p.name}`, `> izvoz iz Aleks's AI mindmap · ${stamp(Date.now())} · ${entries.length} vnosov`, ''];
  KINDS.forEach(k => {
    const es = entries.filter(e => e.kind === k.id); if (!es.length) return;
    L.push(`## ${k.label}`);
    es.sort((a, b) => a.t - b.t).forEach(e => {
      L.push(`- [${stamp(e.t)} @${e.whoName}] ${(e.text || '').replace(/\n/g, ' / ')}`);
      e.files.forEach(f => L.push(`  - priponka: ${f.name}${links[f.path] ? ' → ' + links[f.path] : ''}`));
    });
    L.push('');
  });
  return L.join('\n');
}
$('#ctxBtn').onclick = async () => {
  $('#ctxPre').textContent = '> pripravljam…'; openSheet('#ctxSheet', '#ctxCopy');
  const paths = entries.flatMap(e => e.files.map(f => f.path)).filter(Boolean);
  let links = {};
  if (paths.length) {
    const { data } = await sb.storage.from(BUCKET).createSignedUrls(paths, 60 * 60 * 24 * 7);
    (data || []).forEach(x => { if (x.signedUrl) links[x.path] = x.signedUrl; });
  }
  $('#ctxPre').textContent = contextMd(P(), links);
};
$('#ctxCopy').onclick = () => {
  const t = $('#ctxPre').textContent;
  navigator.clipboard.writeText(t).then(() => toast('kopirano, prilepi umetni inteligenci'), () => {
    const r = document.createRange(); r.selectNodeContents($('#ctxPre')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('označeno, pritisni Ctrl+C');
  });
};

/* ---------------- admin: users & rights ---------------- */
let allUsers = [], members = [], nuSel = [];
async function adminCall(body) {
  const { data, error } = await sb.functions.invoke('admin-users', { body: { ...body, domain: CFG.USER_DOMAIN || 'mindmap.local' } });
  if (error) {
    let msg = error.message;
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch (e) {}
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
async function loadAdmin() {
  const [{ data: u, error: e1 }, { data: m, error: e2 }, { data: ps, error: e3 }] = await Promise.all([
    sb.from('profiles').select('id,username,is_admin,can_create,blocked,last_seen_at').order('username'),
    sb.from('project_members').select('project_id,user_id'),
    sb.from('projects').select('id,name').order('created_at')
  ]);
  if (e1 || e2 || e3) throw (e1 || e2 || e3);
  allUsers = u; members = m; adminProjects = ps;
}
let adminProjects = [];
function projChecks(box, selected, onChange) {
  box.innerHTML = '';
  if (!adminProjects.length) { box.innerHTML = '<span class="muted">Še ni projektov.</span>'; return; }
  adminProjects.forEach(p => {
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox" ${selected.includes(p.id) ? 'checked' : ''}>${esc(p.name)}`;
    l.querySelector('input').onchange = ev => onChange(p.id, ev.target.checked, ev.target);
    box.append(l);
  });
}
function renderUsers() {
  const box = $('#ulist'); box.innerHTML = '';
  allUsers.forEach(u => {
    const c = document.createElement('div'); c.className = 'ucard'; const self = u.id === me.id;
    const mine = members.filter(m => m.user_id === u.id).map(m => m.project_id);
    if (u.blocked) c.classList.add('blocked');
    c.innerHTML = `<div class="top">${ico('user')}<b>${esc(u.username)}</b><span class="badge ${u.is_admin ? 'adm' : ''}">${u.is_admin ? 'admin' : 'član'}</span>${u.blocked ? '<span class="badge blk">blokiran</span>' : ''}${self ? '<span class="muted">(ti)</span>' : ''}<span class="spacer"></span>${self ? '' : `<button class="ghost" type="button" data-block>${ico(u.blocked ? 'key' : 'lock')}${u.blocked ? 'Odblokiraj' : 'Blokiraj'}</button><button class="ghost danger" type="button" data-del>${ico('trash')}Odstrani</button>`}</div>
      <div class="muted">nazadnje aktiven: ${esc(ago(u.last_seen_at))}</div>
      <div class="checks"><label><input type="checkbox" data-k="can_create" ${u.can_create || u.is_admin ? 'checked' : ''} ${u.is_admin ? 'disabled' : ''}>lahko ustvarja projekte</label><label><input type="checkbox" data-k="is_admin" ${u.is_admin ? 'checked' : ''} ${self ? 'disabled' : ''}>admin</label></div>
      ${u.is_admin ? '<div class="muted">Admin vidi vse projekte.</div>' : '<div class="sub-l">VIDI PROJEKTE</div><div class="checks" data-pc></div>'}
      <div class="pwrow"><input type="password" placeholder="novo geslo (vsaj 6 znakov)" aria-label="Novo geslo za ${esc(u.username)}" autocomplete="new-password"><button class="btn sm" type="button" data-pw>${ico('key')}Nastavi geslo</button></div>`;
    c.querySelectorAll('[data-k]').forEach(cb => cb.onchange = async () => {
      const { error } = await sb.from('profiles').update({ [cb.dataset.k]: cb.checked }).eq('id', u.id);
      if (error) { cb.checked = !cb.checked; return fail('pravice', error); }
      u[cb.dataset.k] = cb.checked; renderUsers(); toast('pravice posodobljene');
    });
    if (!u.is_admin) projChecks(c.querySelector('[data-pc]'), mine, async (pid, on, el) => {
      const q = on ? sb.from('project_members').insert({ project_id: pid, user_id: u.id })
                   : sb.from('project_members').delete().eq('project_id', pid).eq('user_id', u.id);
      const { error } = await q;
      if (error) { el.checked = !on; return fail('dostop', error); }
      members = on ? [...members, { project_id: pid, user_id: u.id }] : members.filter(m => !(m.project_id === pid && m.user_id === u.id));
      toast('dostop posodobljen');
    });
    c.querySelector('[data-pw]').onclick = async () => {
      const inp = c.querySelector('.pwrow input'), v = inp.value;
      if (v.length < 6) { toast('geslo naj ima vsaj 6 znakov'); return; }
      try { await adminCall({ action: 'set_password', user_id: u.id, password: v }); inp.value = ''; toast(u.id === me.id ? 'geslo nastavljeno' : 'geslo nastavljeno, ' + u.username + ' ga bo ob prijavi zamenjal'); }
      catch (e) { fail('geslo', e); }
    };
    if (!self) {
      const bb = c.querySelector('[data-block]');
      const doBlock = async () => {
        try {
          await adminCall({ action: 'block', user_id: u.id, blocked: !u.blocked });
          u.blocked = !u.blocked; renderUsers();
          toast(u.blocked ? u.username + ' blokiran in odjavljen povsod' : u.username + ' spet lahko vstopi');
        } catch (e) { fail('blokiranje', e); }
      };
      if (u.blocked) bb.onclick = doBlock;
      else { let armed = false; const orig = bb.innerHTML; bb.onclick = () => { if (!armed) { armed = true; bb.classList.add('armed'); bb.innerHTML = ico('lock') + 'Res blokiraj?'; setTimeout(() => { armed = false; bb.classList.remove('armed'); bb.innerHTML = orig; }, 2600); return; } doBlock(); }; }
    }
    if (!self) confirmBtn(c.querySelector('[data-del]'), 'Res odstrani?', async () => {
      try { await adminCall({ action: 'delete', user_id: u.id }); allUsers = allUsers.filter(x => x.id !== u.id); renderUsers(); toast('uporabnik odstranjen'); }
      catch (e) { fail('odstranitev', e); }
    });
    box.append(c);
  });
  nuSel = nuSel.filter(id => adminProjects.some(p => p.id === id));
  projChecks($('#nuProjects'), nuSel, (pid, on) => { nuSel = on ? [...nuSel, pid] : nuSel.filter(x => x !== pid); });
}
$('#adminBtn').onclick = async () => {
  $('#ulist').innerHTML = '<div class="loading">&gt; nalagam uporabnike…</div>'; openSheet('#adminSheet');
  try { await loadAdmin(); renderUsers(); } catch (e) { fail('uporabniki', e); }
};
$('#addUser').addEventListener('submit', async ev => {
  ev.preventDefault();
  const n = $('#nuName').value.trim().toLowerCase(), pw = $('#nuPass').value;
  if (!/^[a-z0-9._-]{2,30}$/.test(n)) { $('#nuErr').textContent = 'Ime: 2–30 znakov, male črke, številke, . _ -'; return; }
  if (allUsers.some(x => x.username === n)) { $('#nuErr').textContent = 'Uporabnik s tem imenom že obstaja.'; return; }
  if (pw.length < 6) { $('#nuErr').textContent = 'Geslo naj ima vsaj 6 znakov.'; return; }
  const btn = $('#addUser button[type=submit]'); btn.disabled = true; $('#nuErr').textContent = '';
  try {
    await adminCall({ action: 'create', username: n, password: pw, is_admin: $('#nuAdmin').checked, can_create: $('#nuCreate').checked, projects: nuSel });
    $('#nuName').value = ''; $('#nuPass').value = ''; nuSel = [];
    await loadAdmin(); renderUsers(); toast('račun ustvarjen: ' + n);
  } catch (e) { $('#nuErr').textContent = e.message; }
  btn.disabled = false;
});


/* ---------------- own password (forced on first login, or by choice) ---------------- */
let pwForced = false;
function showPwGate(forced) {
  pwForced = forced;
  $('#boot').hidden = true; $('#login').hidden = true; $('#app').hidden = true; $('#pwGate').hidden = false;
  $('#pwUser').value = me.username;
  $('#pwLbl').innerHTML = forced ? 'prva prijava · <b>novo geslo</b>' : 'tvoj račun · <b>spremeni geslo</b>';
  $('#pwIntro').textContent = forced
    ? `Živjo ${me.username}. Geslo, ki si ga dobil, je začasno. Izberi svoje, ki ga poznaš samo ti.`
    : 'Vpiši novo geslo. Na vseh drugih napravah boš odjavljen.';
  $('#pwCancel').hidden = forced; $('#pwLogout').hidden = !forced;
  $('#pw1').value = ''; $('#pw2').value = ''; $('#pwErr').textContent = ''; $('#pw1').focus();
}
$('#myPwBtn').onclick = () => showPwGate(false);
$('#pwCancel').onclick = () => { $('#pwGate').hidden = true; $('#app').hidden = false; };
$('#pwLogout').onclick = async () => { await sb.auth.signOut(); me = null; showLogin(); };
$('#pwForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const a = $('#pw1').value, b = $('#pw2').value;
  if (a.length < 6) { $('#pwErr').textContent = 'Geslo naj ima vsaj 6 znakov.'; return; }
  if (a !== b) { $('#pwErr').textContent = 'Gesli se ne ujemata.'; return; }
  const btn = $('#pwForm button[type=submit]'); btn.disabled = true; $('#pwErr').textContent = '';
  const { error } = await sb.auth.updateUser({ password: a });
  if (error) {
    btn.disabled = false;
    $('#pwErr').textContent = /different|same/i.test(error.message) ? 'Novo geslo mora biti drugačno od začasnega.' : 'Gesla ni bilo mogoče spremeniti: ' + error.message;
    return;
  }
  await sb.auth.signOut({ scope: 'others' }).catch(() => {});
  const { error: e2 } = await sb.rpc('password_changed');
  btn.disabled = false;
  if (e2) console.warn(e2);
  me.must_change_pw = false;
  toast('geslo spremenjeno');
  if (pwForced) enterApp(); else { $('#pwGate').hidden = true; $('#app').hidden = false; }
});

/* ---------------- admin: rename / delete project ---------------- */
$('#renameBtn').onclick = () => {
  const p = P(); if (!p) return;
  $('#projTitle').hidden = true; $('#projTools').hidden = true; $('#renameForm').hidden = false;
  $('#renameInput').value = p.name; $('#renameInput').select();
};
function closeRename() { $('#renameForm').hidden = true; $('#projTitle').hidden = false; renderHead(); }
$('#renameCancel').onclick = closeRename;
$('#renameInput').addEventListener('keydown', e => { if (e.key === 'Escape') closeRename(); });
$('#renameForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const p = P(), n = $('#renameInput').value.trim(); if (!p || !n) return;
  const { error } = await sb.from('projects').update({ name: n }).eq('id', p.id);
  if (error) return fail('preimenovanje', error);
  p.name = n; closeRename(); renderProjects(); toast('projekt preimenovan');
});
$('#delProjBtn').onclick = () => {
  const p = P(); if (!p) return;
  $('#delName').textContent = p.name; $('#delCount').textContent = p.count;
  $('#delAck').checked = false; $('#delGo').disabled = true;
  openSheet('#delSheet', '#delAck');
};
$('#delAck').onchange = () => { $('#delGo').disabled = !$('#delAck').checked; };
$('#delGo').onclick = async () => {
  const p = P(); if (!p) return;
  const btn = $('#delGo'); btn.disabled = true; btn.lastChild.textContent = 'Brišem…';
  try {
    const { data: rows, error: e1 } = await sb.from('entries').select('files').eq('project_id', p.id);
    if (e1) throw e1;
    const paths = (rows || []).flatMap(r => (r.files || []).map(f => f.path)).filter(Boolean);
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await sb.storage.from(BUCKET).remove(paths.slice(i, i + 100));
      if (error) console.warn(error);
    }
    const { error: e2 } = await sb.from('projects').delete().eq('id', p.id);
    if (e2) throw e2;
    $('#delSheet').hidden = true;
    const name = p.name; cur = null;
    await loadProjects(); await loadEntries(); renderAll();
    toast('projekt izbrisan: ' + name);
  } catch (e) { fail('brisanje projekta', e); }
  btn.lastChild.textContent = 'Izbriši za vedno'; btn.disabled = !$('#delAck').checked;
};

/* ---------------- refresh when coming back to the tab ---------------- */
addEventListener('focus', async () => {
  if (!me || busy || editing || Date.now() - lastLoad < 20000) return;
  if ($('#app').hidden) return;
  sb.rpc('touch_seen').then(({ error }) => error && console.warn(error));
  try { await loadProjects(); await loadEntries(); renderAll(); } catch (e) { console.warn(e); }
});

/* ---------------- easter eggs ---------------- */
const seq = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']; let pos = 0;
addEventListener('keydown', e => { if (e.target.matches('input,textarea')) return; pos = e.key === seq[pos] ? pos + 1 : (e.key === seq[0] ? 1 : 0); if (pos === seq.length) { pos = 0; for (let i = 0; i < 28; i++) setTimeout(meteor, i * 80); toast('meteor shower unlocked ☄'); } });
const born = Date.now(); setInterval(() => { const s = Math.floor((Date.now() - born) / 1000); $('#uptime').textContent = 'up ' + (s < 60 ? s + 's' : Math.floor(s / 60) + 'm' + pad(s % 60) + 's'); }, 1000);
console.log('%c★ aleks\'s ai mindmap\n%cyou opened devtools. respect. ↑↑↓↓←→←→BA', 'font:20px monospace;color:#ffb454', 'font:12px monospace;color:#7a81a6');

/* ---------------- boot ---------------- */
(async () => {
  if (!window.supabase || !CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes('TVOJ-PROJEKT')) {
    $('#boot').textContent = '> manjka nastavitev: vpiši SUPABASE_URL in SUPABASE_ANON_KEY v config.js';
    return;
  }
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  sb.auth.onAuthStateChange(evt => { if (evt === 'SIGNED_OUT' && me) { me = null; showLogin('Seja je potekla. Prijavi se znova.'); } });
  const { data: { session } } = await sb.auth.getSession();
  if (session) enterApp(); else showLogin();
})();
})();
