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
  { id: 'sestanek', label: 'sestanek', c: '#5fd4c4', g: '◎', hint: 'Transkript sestanka in zapisnik. Odpre se obrazec.' },
  { id: 'povezava', label: 'povezava', c: '#7ee0ff', g: '↗', hint: 'Spletna stran ali vir. Prilepi naslov v besedilo.' },
  { id: 'datoteka', label: 'datoteka', c: '#c3a6ff', g: '▣', hint: 'Slika, PDF ali dokument. Pripni ga spodaj.' },
  { id: 'skill', label: 'skill', c: '#9be564', g: '⚙', hint: 'Navodila za AI (npr. SKILL.md). Pripni .md datoteko ali prilepi besedilo.' },
  { id: 'prompt', label: 'prompt', c: '#f2a7ff', g: '❯', hint: 'Prompt ali sistemska navodila, ki jih znova uporabljaš.' }
];
const SPACES = { delo: 'delo', osebno: 'osebno' };
const isDoc = k => k === 'skill' || k === 'prompt';
const K = Object.fromEntries(KINDS.map(k => [k.id, k]));

/* ---------------- state ---------------- */
let sb = null;
let me = null;            // { id, username, is_admin, can_create }
let projects = [];        // [{ id, name, code, created_at, count }]
let cur = null;           // project id
let entries = [];         // entries of current project
let urls = {};            // storage path -> signed url
let agentsById = {};
let spaceF = 'vse'; try { spaceF = localStorage.getItem('aimm-space') || 'vse'; } catch (e) {}
let kind = 'misel', fkind = null, pending = [], editing = null, busy = false, lastLoad = 0;
let trHits = new Set(), trQ = '';   // meetings whose transcript matches the search
let view = 'project';                // 'project' | 'today'
let todaySpace = 'delo';
let todos = [], plans = new Map(), todoParents = {};   // all my to-dos across projects, my own plans for them

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
  const { data, error } = await sb.from('projects').select('id,name,code,space,created_at,entries(count)').order('created_at');
  if (error) throw error;
  projects = data.map(p => ({ id: p.id, name: p.name, code: p.code, space: p.space || 'osebno', created_at: p.created_at, count: p.entries?.[0]?.count ?? 0 }));
  if (!projects.find(p => p.id === cur)) {
    let saved = null; try { saved = localStorage.getItem('aimm-cur-' + me.id); } catch (e) {}
    cur = projects.find(p => p.id === saved)?.id || projects[0]?.id || null;
  }
}
async function loadEntries() {
  entries = []; urls = {};
  if (!cur) return;
  const { data, error } = await sb.from('entries')
    .select('id,project_id,kind,text,files,created_at,edited_at,author,author_name,done_at,done_by,source,via,agent_id,review,skill_name,version,superseded_by,title,meeting_at,participants,transcript_private,transcript_words,parent_id')
    .eq('project_id', cur).order('created_at');
  if (error) throw error;
  entries = data.map(e => ({ ...e, t: new Date(e.created_at).getTime(), files: e.files || [], participants: e.participants || [], whoName: e.author_name || 'nekdo' }));
  trHits = new Set(); trQ = '';
  const aids = [...new Set(entries.map(e => e.agent_id).filter(Boolean))];
  agentsById = {};
  if (aids.length) {
    const { data: ag } = await sb.from('agents').select('id,name,color,tool').in('id', aids);
    (ag || []).forEach(a => { agentsById[a.id] = a; });
  }
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

/* ---------------- markdown (skills & prompts) ---------------- */
function inlineMd(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
}
function md(src) {
  let text = src.replace(/\r\n/g, '\n'), out = '';
  const fm = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    out += '<div class="fm">' + fm[1].split('\n').filter(Boolean).map(l => { const m = l.match(/^([\w-]+):\s*(.*)$/); return m ? `<span><b>${esc(m[1])}</b> ${esc(m[2])}</span>` : `<span>${esc(l)}</span>`; }).join('') + '</div>';
    text = text.slice(fm[0].length);
  }
  const lines = text.split('\n'); let i = 0, para = [], list = null;
  const flush = () => { if (para.length) { out += `<p>${para.map(inlineMd).join('<br>')}</p>`; para = []; } if (list) { out += `</${list}>`; list = null; } };
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) { flush(); const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); out += `<pre><code>${esc(buf.join('\n'))}</code></pre>`; i++; continue; }
    let m;
    if ((m = l.match(/^(#{1,6})\s+(.*)$/))) { flush(); out += `<div class="mh l${Math.min(m[1].length, 3)}">${inlineMd(m[2])}</div>`; }
    else if (/^\s*(---|\*\*\*)\s*$/.test(l)) { flush(); out += '<hr>'; }
    else if ((m = l.match(/^\s*[-*+]\s+(.*)$/))) { if (para.length) { const l2 = list; list = null; flush(); list = l2; } if (list !== 'ul') { if (list) out += `</${list}>`; out += '<ul>'; list = 'ul'; } out += `<li>${inlineMd(m[1])}</li>`; }
    else if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) { if (para.length) { const l2 = list; list = null; flush(); list = l2; } if (list !== 'ol') { if (list) out += `</${list}>`; out += '<ol>'; list = 'ol'; } out += `<li>${inlineMd(m[1])}</li>`; }
    else if ((m = l.match(/^>\s?(.*)$/))) { flush(); out += `<blockquote>${inlineMd(m[1])}</blockquote>`; }
    else if (!l.trim()) { flush(); }
    else { if (list) { out += `</${list}>`; list = null; } para.push(l); }
    i++;
  }
  flush();
  return out;
}
function docTitle(t) {
  const fm = t.match(/^---\n[\s\S]*?\bname:\s*(.+)\n[\s\S]*?---/);
  if (fm) return fm[1].trim();
  const h = t.match(/^#{1,3}\s+(.+)$/m);
  return (h ? h[1] : t.split('\n')[0]).trim().slice(0, 60);
}
function copyText(t, msg) {
  navigator.clipboard.writeText(t).then(() => toast(msg), () => toast('kopiranje ni uspelo, označi besedilo ročno'));
}
function downloadMd(t) {
  const name = (docTitle(t).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'skill') + '.md';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([t], { type: 'text/markdown;charset=utf-8' }));
  a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ---------------- render: sidebar ---------------- */
function renderProjects() {
  const ul = $('#projects'); ul.innerHTML = '';
  if (!projects.length) ul.innerHTML = `<li class="muted" style="padding:8px 0">${me.is_admin || me.can_create ? 'Še ni projektov. Ustvari prvega spodaj.' : 'Še nimaš dostopa do nobenega projekta. Prosi Aleksa, da ti ga dodeli.'}</li>`;
  const spaces = spaceF === 'vse' ? ['delo', 'osebno'] : [spaceF];
  const hasBoth = new Set(projects.map(p => p.space)).size > 1;
  let n = 0;
  spaces.forEach(sp => {
    const list = projects.filter(p => p.space === sp);
    if (!list.length) return;
    if (spaceF === 'vse' && hasBoth) { const g = document.createElement('li'); g.className = 'grp'; g.textContent = sp.toUpperCase(); ul.append(g); }
    list.forEach(p => {
      const li = document.createElement('li'); const on = view === 'project' && p.id === cur; n++;
      li.innerHTML = `<button class="proj" type="button" aria-current="${on}"><span class="mk">${on ? '▸' : String(n).padStart(2, '0')}</span><span class="nm">${esc(p.name)}</span><span class="ct">${p.count}★</span></button>`;
      li.querySelector('button').onclick = () => selectProject(p.id);
      ul.append(li);
    });
  });
  if (projects.length && !n) ul.innerHTML = `<li class="muted" style="padding:8px 0">V prostoru »${spaceF}« še ni projektov.</li>`;
  const sel = $('#projSelect');
  const opt = p => `<option value="${p.id}"${view === 'project' && p.id === cur ? ' selected' : ''}>${esc(p.name)} · ${p.count}★</option>`;
  const vis = projects.filter(p => spaceF === 'vse' || p.space === spaceF);
  sel.innerHTML = !vis.length ? '<option value="">ni projektov</option>'
    : (spaceF === 'vse' && hasBoth) ? spaces.map(sp => `<optgroup label="${sp.toUpperCase()}">${vis.filter(p => p.space === sp).map(opt).join('')}</optgroup>`).join('')
    : vis.map(opt).join('');
  if (view === 'project' && cur && !vis.some(p => p.id === cur)) sel.insertAdjacentHTML('afterbegin', `<option value="" selected disabled>izberi projekt…</option>`);
  if (projects.length) sel.insertAdjacentHTML('afterbegin', `<option value="__today"${view === 'today' ? ' selected' : ''}>☀ Danes${todayCount() ? ' · ' + todayCount() : ''}</option>`);
  sel.disabled = !projects.length;
  const tb = $('#todayBtn'); tb.hidden = !projects.length; tb.setAttribute('aria-current', view === 'today');
  const tc = todayCount(), late = todayCount(true);
  $('#todayCt').textContent = tc ? String(tc) : ''; $('#todayCt').classList.toggle('late', late > 0);
  tb.title = tc ? `${tc} za danes${late ? `, ${late} zamuja` : ''}` : 'Naloge za danes iz vseh projektov';
  const sf = $('#spaceFilter');
  sf.hidden = !hasBoth && spaceF === 'vse';
  seg(sf, [{ id: 'vse', label: 'vse', c: '#e6e9f5', g: '∗' }, { id: 'delo', label: 'delo', c: '#7ee0ff', g: '◆' }, { id: 'osebno', label: 'osebno', c: '#ffb454', g: '●' }],
    x => x.id === spaceF, x => { spaceF = x.id; try { localStorage.setItem('aimm-space', spaceF); } catch (e) {} renderProjects(); });
  $('#shareBtn').hidden = !me.is_admin || !P();
  $('#addProj').hidden = !(me.can_create || me.is_admin) || $('#newProj').classList.contains('on');
  $('#adminBtn').hidden = !me.is_admin;
  $('#whoami').textContent = me.username;
  $('#roleBadge').textContent = me.is_admin ? 'admin' : 'član';
  $('#roleBadge').classList.toggle('adm', me.is_admin);
}
async function selectProject(id) {
  if (view === 'today') setView('project');
  cur = id; editing = null; try { localStorage.setItem('aimm-cur-' + me.id, id); } catch (e) {}
  renderHead(); renderProjects();
  $('#feed').innerHTML = '<li class="loading">&gt; nalagam vnose…</li>';
  try { await loadEntries(); } catch (e) { fail('nalaganje vnosov', e); }
  renderAll();
}

$('#projSelect').addEventListener('change', e => { const v = e.target.value; if (v === '__today') setView('today'); else if (v) selectProject(v); });

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
  seg($('#kinds'), KINDS, x => x.id === kind, x => { if (x.id === 'sestanek') { openMeeting(); return; } kind = x.id; renderKinds(); if (x.id === 'datoteka') $('#dropzone').focus(); });
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
  const hideDone = $('#hideDone').checked;
  const hit = e => (e.text || '').toLowerCase().includes(q) || (e.title || '').toLowerCase().includes(q) || e.participants.some(x => x.toLowerCase().includes(q)) || e.files.some(f => f.name.toLowerCase().includes(q));
  const trHit = e => trQ === q && trHits.has(e.id);
  const list = entries.map((e, i) => ({ e, i })).filter(({ e }) => !e.superseded_by && !(hideDone && e.done_at) && (!fkind || e.kind === fkind) && (!q || hit(e) || trHit(e))).reverse();
  if (!list.length) {
    ul.innerHTML = entries.length
      ? `<li class="empty"><b>Ni zadetkov.</b><span>Poskusi drugo besedo ali izberi filter »vse«.</span></li>`
      : `<li class="empty"><b>Ta projekt je še prazen.</b><span>Zapiši prvo misel v polje zgoraj in pritisni Shrani vnos.</span></li>`;
    return;
  }
  list.forEach(({ e, i }) => {
    const k = K[e.kind] || K.misel, li = document.createElement('li');
    li.className = 'entry' + (e.done_at ? ' done' : '') + (e.review ? ' review' : ''); li.id = 'e-' + e.id; li.style.setProperty('--c', k.c);
    const mine = e.author === me.id || me.is_admin;
    const older = e.skill_name ? entries.filter(x => x.superseded_by === e.id).sort((a, b) => b.t - a.t) : [];
    const parent = e.parent_id ? entries.find(x => x.id === e.parent_id) : null;
    const live = e.review && e.skill_name ? entries.find(x => x.id !== e.id && x.skill_name === e.skill_name && x.agent_id === e.agent_id && !x.review && !x.superseded_by) : null;
    li.innerHTML = `<span class="glyph" aria-hidden="true">${k.g}</span><div style="min-width:0">
      <div class="meta"><span>${stamp(e.t)}</span><span>${catalog(p, i)}</span><span class="cat">${k.label}</span>${parent ? `<button class="ghost from" type="button" data-from>↳ ${esc(parent.title || 'sestanek')}</button>` : ''}${q && trHit(e) && !hit(e) ? '<span class="trhit">zadetek v transkriptu</span>' : ''}${e.skill_name ? `<span class="sname">${esc(e.skill_name)}${e.version ? ` · v${e.version}` : ''}</span>` : ''}${e.source === 'agent'
        ? `${agentChip(agentsById[e.agent_id] || { name: e.whoName })}<span class="agent">AGENT</span>${e.review ? '<span class="rvw">ZA PREGLED</span>' : ''}`
        : `<span class="person">${ico('user')}@${esc(e.whoName)}</span>${e.via ? `<span class="viatag">· prek ${VIA_TOOL[e.via] ? toolIcon(VIA_TOOL[e.via], e.via) : ''}${esc(e.via)}</span>` : ''}`}${e.edited_at ? '<span>· urejeno</span>' : ''}${e.done_at ? `<span class="donemeta">✓ ${e.done_by ? '@' + esc(e.done_by) + ' ' : ''}${esc(ago(e.done_at))}</span>` : ''}</div>
      ${e.kind === 'sestanek' ? meetingHtml(e) : editing === e.id
        ? `<div class="edit"><textarea aria-label="Uredi vnos">${esc(e.text)}</textarea><div class="eb"><button class="btn sm primary" type="button" data-save>Shrani</button><button class="btn sm" type="button" data-cancel>Prekliči</button></div></div>`
        : (e.text ? (isDoc(e.kind)
            ? `<div class="md${e.text.length > 1200 || e.text.split('\n').length > 18 ? ' clamp' : ''}">${md(e.text)}</div><div class="mdtools">${(e.text.length > 1200 || e.text.split('\n').length > 18) ? `<button class="btn sm" type="button" data-more>Pokaži vse</button>` : ''}<button class="btn sm" type="button" data-copy>${ico('copy')}Kopiraj</button><button class="btn sm" type="button" data-dl>${ico('down')}Prenesi .md</button></div>`
            : e.kind === 'todo'
              ? `<div class="todorow"><button class="tick" type="button" data-tick aria-pressed="${!!e.done_at}" aria-label="${e.done_at ? 'Označi kot neopravljeno' : 'Označi kot opravljeno'}"></button><div class="body">${linkify(e.text)}</div></div>${e.done_at ? '' : feedPlanHtml(e)}`
              : `<div class="body">${linkify(e.text)}</div>`) : '')}
      ${e.files.length ? filesHtml(e.files) : ''}
      ${older.length ? `<details class="vers"><summary>Prejšnje različice (${older.length})</summary>${older.map(v => `<div class="ver"><div class="vmeta">${v.version ? 'v' + v.version + ' · ' : ''}${stamp(v.t)}</div><div class="md clamp">${md(v.text || '')}</div><div class="mdtools"><button class="btn sm" type="button" data-vcopy="${v.id}">${ico('copy')}Kopiraj</button><button class="btn sm" type="button" data-vdl="${v.id}">${ico('down')}Prenesi .md</button></div></div>`).join('')}</details>` : ''}
      ${e.review ? `<div class="rvwbar"><span>${live
        ? `Nova različica${e.version ? ' v' + e.version : ''} za »${esc(e.skill_name)}«. Ko jo odobriš, nadomesti trenutno${live.version ? ' (v' + live.version + ')' : ''}, ta pa ostane med prejšnjimi različicami.`
        : `Agent je predlagal ${e.kind === 'prompt' ? 'prompt' : 'skill'}. Dokler ga ne odobriš, ga AI ne vidi v kontekstu.`}</span>${me.is_admin ? `<button class="btn sm primary" type="button" data-ok>Odobri</button><button class="btn sm" type="button" data-no>Zavrni</button>` : ''}</div>` : ''}
    </div>${mine ? `<div class="acts"><button class="ghost" type="button" data-edit aria-label="Uredi">${ico('edit')}</button><button class="ghost danger" type="button" data-del aria-label="Izbriši">${ico('trash')}</button></div>` : '<span></span>'}`;
    if (editing !== e.id && isDoc(e.kind) && e.text) {
      const box = li.querySelector('.md'), more = li.querySelector('[data-more]');
      if (more) more.onclick = () => { const c = box.classList.toggle('clamp'); more.textContent = c ? 'Pokaži vse' : 'Skrči'; };
      li.querySelector('[data-copy]').onclick = () => copyText(e.text, 'kopirano');
      li.querySelector('[data-dl]').onclick = () => downloadMd(e.text);
    }
    if (e.kind === 'sestanek') wireMeeting(li, e);
    li.querySelector('[data-from]')?.addEventListener('click', () => jumpTo(parent.id));
    li.querySelectorAll('[data-vcopy]').forEach(b => b.onclick = () => copyText(entries.find(x => x.id === b.dataset.vcopy)?.text || '', 'kopirano'));
    li.querySelectorAll('[data-vdl]').forEach(b => b.onclick = () => downloadMd(entries.find(x => x.id === b.dataset.vdl)?.text || ''));
    const ok = li.querySelector('[data-ok]');
    if (ok) {
      ok.onclick = () => approveEntry(e);
      confirmBtn(li.querySelector('[data-no]'), 'Res zavrni?', () => deleteEntry(e));
    }
    li.querySelector('[data-plan]')?.addEventListener('click', ev => { const h = ev.currentTarget.dataset.plan; savePlan(e.id, { horizon: h || null }); });
    const tick = li.querySelector('[data-tick]');
    if (tick) tick.onclick = () => toggleDone(e);
    const imgs = e.files.filter(isImg);
    li.querySelectorAll('[data-img]').forEach(b => b.onclick = () => openLightbox(imgs[+b.dataset.img]));
    if (mine) {
      li.querySelector('[data-edit]').onclick = () => { if (e.kind === 'sestanek') { openMeeting(e); return; } editing = e.id; renderFeed(); document.querySelector(`#e-${e.id} textarea`)?.focus(); };
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
async function approveEntry(e) {
  const { data: replaced, error } = await sb.rpc('approve_entry', { eid: e.id });
  if (error) return fail('odobritev', error);
  try { await loadEntries(); } catch (x) { fail('osvežitev', x); }
  renderAll(); toast(replaced ? 'odobreno, stara različica je med prejšnjimi' : 'odobreno, AI ga zdaj vidi');
}
async function toggleDone(e) {
  const done = !e.done_at;
  const { error } = await sb.rpc('set_todo_done', { eid: e.id, done });
  if (error) return fail('opravljeno', error);
  e.done_at = done ? new Date().toISOString() : null; e.done_by = done ? me.username : null;
  const t = todos.find(x => x.id === e.id); if (t) { t.done_at = e.done_at; t.done_by = e.done_by; } else if (done === false) loadTodos().catch(console.warn);
  renderFeed(); renderProjects(); toast(done ? 'opravljeno ✓' : 'spet odprto');
}
let qT;
$('#q').addEventListener('input', () => { renderFeed(); clearTimeout(qT); qT = setTimeout(searchTranscripts, 350); });
async function searchTranscripts() {
  const raw = $('#q').value.trim(), q = raw.toLowerCase();
  if (q.length < 3 || !cur || !entries.some(e => e.transcript_words)) { if (trQ) { trHits = new Set(); trQ = ''; renderFeed(); } return; }
  const { data, error } = await sb.from('entries').select('id').eq('project_id', cur).eq('kind', 'sestanek')
    .ilike('transcript', '%' + raw.replace(/[\\%_]/g, m => '\\' + m) + '%');
  if (error) return console.warn(error);
  if ($('#q').value.trim().toLowerCase() !== q) return;
  trHits = new Set((data || []).map(x => x.id)); trQ = q; renderFeed();
}
$('#hideDone').onchange = () => { try { localStorage.setItem('aimm-hidedone', $('#hideDone').checked ? '1' : ''); } catch (e) {} renderFeed(); };
try { $('#hideDone').checked = localStorage.getItem('aimm-hidedone') === '1'; } catch (e) {}
async function updateEntry(e, text) {
  const { error } = await sb.from('entries').update({ text, edited_at: new Date().toISOString() }).eq('id', e.id);
  if (error) return fail('urejanje', error);
  e.text = text; e.edited_at = new Date().toISOString(); editing = null; renderFeed(); toast('shranjeno');
}
async function deleteEntry(e) {
  // deleting the current version of a skill brings back the newest previous one
  const older = e.skill_name && !e.superseded_by ? entries.filter(x => x.superseded_by === e.id).sort((a, b) => b.t - a.t) : [];
  if (older.length) {
    const back = older.find(x => !x.review) || older[0];
    const r1 = await sb.from('entries').update({ superseded_by: null }).eq('id', back.id);
    if (r1.error) return fail('brisanje', r1.error);
    const r2 = await sb.from('entries').update({ superseded_by: back.id }).eq('superseded_by', e.id).neq('id', back.id);
    if (r2.error) return fail('brisanje', r2.error);
  }
  const paths = e.files.map(f => f.path).filter(Boolean);
  const { error } = await sb.from('entries').delete().eq('id', e.id);
  if (error) return fail('brisanje', error);
  if (paths.length) { const { error: se } = await sb.storage.from(BUCKET).remove(paths); if (se) console.warn(se); }
  if (older.length) { try { await loadEntries(); } catch (x) { console.warn(x); } }
  else entries = entries.filter(x => x.id !== e.id);
  const p = P(); if (p) p.count = entries.length;
  renderAll(); toast(older.length ? 'izbrisano, vrnjena prejšnja različica' : 'vnos izbrisan');
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
    c.fillStyle = col; c.strokeStyle = col;
    if (q.e.source === 'agent') { c.globalAlpha = .9; c.lineWidth = 1; c.strokeRect(q.x - s, q.y - s, s * 2, s * 2); c.globalAlpha = 1; return; }
    c.globalAlpha = .25; c.fillRect(q.x - s * 2, q.y - s * 2, s * 4, s * 4); c.globalAlpha = 1;
    c.fillRect(q.x - s / 2, q.y - s / 2, s, s); c.fillRect(q.x - .5, q.y - s * 1.6, 1, s * 3.2); c.fillRect(q.x - s * 1.6, q.y - .5, s * 3.2, 1);
  });
}
const cvC = $('#constel'), tip = $('#tip');
const hitAt = ev => { const b = cvC.getBoundingClientRect(), x = ev.clientX - b.left, y = ev.clientY - b.top; return { x, y, b, hit: chartPts.find(q => Math.hypot(q.x - x, q.y - y) < 12) }; };
cvC.addEventListener('pointermove', ev => {
  const { x, y, b, hit } = hitAt(ev);
  if (hit) { tip.style.opacity = 1; tip.textContent = `${catalog(P(), hit.i)} › ${(hit.e.title || hit.e.text || hit.e.files[0]?.name || '').slice(0, 90)}`; tip.style.left = Math.max(0, Math.min(x + 12, b.width - 260)) + 'px'; tip.style.top = (y + 14) + 'px'; cvC.style.cursor = 'pointer'; }
  else { tip.style.opacity = 0; cvC.style.cursor = 'default'; }
});
cvC.addEventListener('pointerleave', () => tip.style.opacity = 0);
function jumpTo(id) {
  if (!document.getElementById('e-' + id)) { fkind = null; $('#q').value = ''; renderKinds(); renderFeed(); }
  const el = document.getElementById('e-' + id); el?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  el?.classList.add('flash'); setTimeout(() => el?.classList.remove('flash'), 1400);
}
cvC.addEventListener('click', ev => { const { hit } = hitAt(ev); if (hit) jumpTo(hit.e.id); });
addEventListener('resize', () => { if (!$('#app').hidden) renderChart(); });

function renderHead() {
  const p = P();
  $('#composer').hidden = !p; $('#ctxBtn').disabled = !p;
  $('#projTools').hidden = !(p && me?.is_admin) || !$('#renameForm').hidden;
  if (p) {
    const i = projects.indexOf(p), g = rnd(p.id);
    $('#projTitle').textContent = p.name;
    $('#projCode').textContent = `${p.space.toUpperCase()} · ${p.code}-${pad(i + 1)} · RA ${pad(Math.floor(g() * 24))}h ${pad(Math.floor(g() * 60))}m · DEC +${pad(Math.floor(g() * 80))}°`;
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
  try { await loadTodos(); } catch (e) { console.warn(e); }
  renderAll();
  // the home-screen app (and #danes links) open on today's to-dos
  let startView = 'project'; try { startView = localStorage.getItem('aimm-view-' + me.id) || 'project'; todaySpace = localStorage.getItem('aimm-tdspace-' + me.id) || defaultTodaySpace(); } catch (e) { todaySpace = defaultTodaySpace(); }
  if (standalone || location.hash === '#danes' || startView === 'today') setView('today');
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
$('#logout').onclick = async () => { stopRec(); await sb.auth.signOut(); me = null; projects = []; entries = []; cur = null; todos = []; plans = new Map(); view = 'project'; $('#app').classList.remove('today'); $('#todayView').hidden = true; showLogin(); };
$('#howtoX').onclick = () => { $('#howto').hidden = true; try { localStorage.setItem('aimm-howto-' + me.id, '1'); } catch (e) {} };
$('#helpBtn').onclick = () => { $('#howto').hidden = !$('#howto').hidden; };

/* ---------------- projects ---------------- */
function closeNewProj() { $('#newProj').classList.remove('on'); $('#addProj').hidden = false; }
$('#addProj').onclick = () => { $('#newProjSpace').value = spaceF === 'vse' ? 'osebno' : spaceF; $('#newProj').classList.add('on'); $('#addProj').hidden = true; $('#newProjName').focus(); };
$('#newProjName').addEventListener('keydown', e => { if (e.key === 'Escape') closeNewProj(); });
$('#newProj').addEventListener('submit', async ev => {
  ev.preventDefault(); const n = $('#newProjName').value.trim(); if (!n) return;
  const code = (n.normalize('NFD').replace(/[^A-Za-z]/g, '').slice(0, 3) || 'NEW').toUpperCase();
  const space = $('#newProjSpace').value;
  const { data, error } = await sb.from('projects').insert({ name: n, code, space, created_by: me.id }).select('id').single();
  if (error) return fail('nov projekt', error);
  $('#newProjName').value = ''; closeNewProj();
  await loadProjects(); await selectProject(data.id);
  toast('projekt ustvarjen: ' + n); $('#text').focus();
});

/* ---------------- composer ---------------- */
function updateSave() { $('#saveBtn').disabled = busy || (!$('#text').value.trim() && !pending.length); }
const TEXT_FILE = /\.(md|markdown|txt)$/i;
async function importText(f) {
  const t = (await f.text()).replace(/\r\n/g, '\n').trim();
  const ta = $('#text');
  ta.value = ta.value.trim() ? ta.value.trim() + '\n\n---\n\n' + t : t;
  if (/\.(md|markdown)$/i.test(f.name) && !isDoc(kind)) { kind = 'skill'; renderKinds(); }
  $('#status').textContent = `Besedilo iz ${f.name} je v polju zgoraj. Preglej ga in pritisni Shrani vnos.`;
  updateSave();
}
function addFiles(list) {
  [...list].forEach(f => {
    if (/\.(vtt|srt)$/i.test(f.name)) { openMeeting().then(() => importTranscript(f)).catch(e => fail('uvoz', e)); return; }
    if (TEXT_FILE.test(f.name) && f.size < 1048576) { importText(f).catch(e => fail('uvoz', e)); return; }
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
    const { error } = await sb.from('entries').insert({ project_id: projectId, kind: k, text, files: uploaded, author: me.id, via: $('#via').value || null });
    if (error) throw error;
  } catch (e) {
    if (uploaded.length) await sb.storage.from(BUCKET).remove(uploaded.map(u => u.path));
    busy = false; $('#status').textContent = ''; updateSave(); return fail('shranjevanje', e);
  }
  pending.forEach(f => f.preview && URL.revokeObjectURL(f.preview));
  pending = []; $('#text').value = ''; $('#via').value = ''; renderPending(); $('#status').textContent = '';
  busy = false; fkind = null; $('#q').value = '';
  if (cur === projectId) { try { await loadEntries(); } catch (e) { fail('osvežitev', e); } }
  renderAll(); toast('vnos shranjen ★'); if (!reduce) meteor();
  const first = $('#feed .entry'); first?.classList.add('flash'); setTimeout(() => first?.classList.remove('flash'), 1400);
});

/* ---------------- paste from AI ---------------- */
$('#pasteAi').onclick = async () => {
  if ($('#via').value === '') $('#via').value = 'AI';
  try {
    const t = (await navigator.clipboard.readText()).trim();
    if (!t) throw new Error('empty');
    const ta = $('#text'); ta.value = ta.value.trim() ? ta.value.trim() + '\n\n' + t : t; updateSave();
    $('#status').textContent = 'Prilepljeno. Izberi, iz katerega AI je besedilo, in pritisni Shrani vnos.';
    $('#via').focus();
  } catch (e) {
    $('#text').focus();
    $('#status').textContent = 'Brskalnik ne dovoli branja odložišča. Prilepi z Ctrl+V (na telefonu: dolg pritisk → Prilepi) in izberi vir.';
  }
};

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

/* ---------------- today: my to-dos from every project ---------------- */
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const dayDiff = (a, b) => Math.round((new Date(a + 'T12:00') - new Date(b + 'T12:00')) / 864e5);   // a − b, in days
const DAYS = ['ned', 'pon', 'tor', 'sre', 'čet', 'pet', 'sob'];
const DAYS_LONG = ['nedelja', 'ponedeljek', 'torek', 'sreda', 'četrtek', 'petek', 'sobota'];
const dm = s => { const d = new Date(s + 'T12:00'); return `${d.getDate()}. ${d.getMonth() + 1}.`; };
const nDni = n => n === 1 ? 'dan' : n === 2 ? 'dneva' : n < 5 ? 'dni' : 'dni';
const HORIZONS = [
  { id: 'danes', label: 'danes', g: '☀', c: 'var(--amber)' },
  { id: 'teden', label: 'ta teden', g: '◷', c: 'var(--cyan)' },
  { id: 'dolgorocno', label: 'dolgoročno', g: '∞', c: 'var(--violet)' },
  { id: '', label: 'neplanirano', g: '○', c: 'var(--dim)' },
];
const TONE = { late: 'var(--red)', danes: 'var(--amber)', teden: 'var(--cyan)', dolgorocno: 'var(--violet)', none: 'var(--faint)', done: 'var(--green)' };

function defaultTodaySpace() { return projects.some(p => p.space === 'delo') ? 'delo' : 'osebno'; }
async function loadTodos() {
  if (!me) return;
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const [r1, r2] = await Promise.all([
    sb.from('entries').select('id,project_id,text,created_at,author_name,source,via,agent_id,done_at,done_by,parent_id')
      .eq('kind', 'todo').is('superseded_by', null).eq('review', false)
      .or(`done_at.is.null,done_at.gte."${start.toISOString()}"`).order('created_at'),
    sb.from('todo_plans').select('entry_id,horizon,plan_day,due_on,importance').eq('user_id', me.id),
  ]);
  if (r1.error) throw r1.error; if (r2.error) throw r2.error;
  const pj = new Set(projects.map(p => p.id));
  todos = (r1.data || []).filter(t => pj.has(t.project_id)).map(t => ({ ...t, t: new Date(t.created_at).getTime() }));
  plans = new Map((r2.data || []).map(x => [x.entry_id, x]));
  const pids = [...new Set(todos.map(t => t.parent_id).filter(id => id && !(id in todoParents)))];
  if (pids.length) { const { data } = await sb.from('entries').select('id,title').in('id', pids); (data || []).forEach(x => todoParents[x.id] = x.title); }
}
// where a to-do shows up today, and how it is colored and labelled
function todoState(t) {
  const p = plans.get(t.id) || {}, T = todayStr();
  if (t.done_at) return { sec: 'done', tone: 'done', p, dd: null, carried: 0 };
  const dd = p.due_on ? dayDiff(p.due_on, T) : null;
  let sec = p.horizon || 'none';
  if (dd !== null && dd <= 0) sec = 'danes';
  else if (dd !== null && dd <= 6 && sec !== 'danes') sec = 'teden';
  const carried = p.horizon === 'danes' && p.plan_day && p.plan_day < T ? dayDiff(T, p.plan_day) : 0;
  return { sec, tone: dd !== null && dd < 0 ? 'late' : sec, p, dd, carried };
}
function dueBadge(st) {
  const { dd, p } = st; if (dd === null) return '';
  if (dd < 0) return `<span class="tb late">zamuja ${-dd} ${nDni(-dd)}</span>`;
  if (dd === 0) return '<span class="tb now">rok danes</span>';
  if (dd === 1) return '<span class="tb soon">rok jutri</span>';
  const d = new Date(p.due_on + 'T12:00');
  return `<span class="tb ${dd <= 6 ? 'soon' : 'far'}">rok ${dd <= 6 ? DAYS[d.getDay()] + ' ' : ''}${dm(p.due_on)}</span>`;
}
const spaceOf = t => projects.find(p => p.id === t.project_id)?.space;
function todayCount(lateOnly) {
  const sp = spaceF === 'vse' ? null : spaceF;
  return todos.filter(t => (!sp || spaceOf(t) === sp)).map(todoState).filter(st => st.sec === 'danes' && (!lateOnly || st.tone === 'late')).length;
}
function feedPlanHtml(e) {
  const t = todos.find(x => x.id === e.id) || { id: e.id }, st = todoState(t);
  const h = HORIZONS.find(x => x.id === (st.p.horizon || '')) || HORIZONS[3];
  const imp = st.p.importance ? `<span class="imp-s">${'!'.repeat(st.p.importance)}</span>` : '';
  return `<div class="tplan" style="--tc:${TONE[st.tone]}">${st.p.horizon ? `<span class="tb hz">${h.g} ${h.label}</span>` : ''}${dueBadge(st)}${imp}
    ${st.p.horizon === 'danes' ? '<button class="ghost" type="button" data-plan="">odstrani iz dneva</button>' : '<button class="ghost" type="button" data-plan="danes">☀ na danes</button>'}</div>`;
}
async function savePlan(id, patch) {
  const old = plans.get(id) || { entry_id: id, horizon: null, plan_day: null, due_on: null, importance: 0 };
  const next = { ...old, ...patch };
  if ('horizon' in patch) next.plan_day = patch.horizon === 'danes' ? (old.horizon === 'danes' && !patch.reset ? old.plan_day || todayStr() : todayStr()) : null;
  delete next.reset;
  plans.set(id, next); renderToday(); if (view === 'project') renderFeed(); renderProjects();
  const { error } = await sb.from('todo_plans').upsert({
    user_id: me.id, entry_id: id, horizon: next.horizon || null, plan_day: next.plan_day, due_on: next.due_on || null,
    importance: next.importance || 0, updated_at: new Date().toISOString(),
  });
  if (error) { plans.set(id, old); renderToday(); if (view === 'project') renderFeed(); renderProjects(); fail('načrt', error); }
}
function setView(v) {
  view = v; const on = v === 'today';
  $('#app').classList.toggle('today', on); $('#todayView').hidden = !on;
  try { localStorage.setItem('aimm-view-' + me.id, v); } catch (e) {}
  if (on) { renderToday(); loadTodos().then(() => { renderToday(); renderProjects(); }).catch(e => fail('naloge', e)); $('main').scrollTop = 0; }
  renderProjects();
}
$('#todayBtn').onclick = () => setView('today');

function todoRow(t, st) {
  const pr = projects.find(p => p.id === t.project_id), imp = st.p.importance || 0;
  const from = t.parent_id && todoParents[t.parent_id];
  const meta = [`<span class="pj">${esc(pr?.code || '')} · ${esc(pr?.name || '')}</span>`];
  if (from) meta.push(`<span class="frm">↳ ${esc(from)}</span>`);
  if (t.source === 'agent') meta.push(`<span class="who">@${esc(t.author_name || 'agent')}</span>`);
  const badges = [dueBadge(st), st.carried ? `<span class="tb carry" title="Na seznamu za danes od ${dm(st.p.plan_day)}">${st.carried + 1}. dan</span>` : '',
    st.sec === 'done' && t.done_by && t.done_by !== me.username ? `<span class="tb far">✓ @${esc(t.done_by)}</span>` : ''].join('');
  return `<li class="td${st.sec === 'done' ? ' done' : ''}" data-id="${t.id}" style="--tc:${TONE[st.tone]}">
    <button class="tick" type="button" data-tick aria-pressed="${!!t.done_at}" aria-label="${t.done_at ? 'Označi kot neopravljeno' : 'Označi kot opravljeno'}"></button>
    <button class="tdmain" type="button" data-open aria-expanded="false"><span class="tdtext">${esc(t.text)}</span><span class="tdmeta">${badges}${meta.join('')}</span></button>
    <button class="imp" type="button" data-imp title="Pomembnost (samo zate): klik za spremembo" aria-label="Pomembnost ${imp} od 3"><i${imp > 0 ? ' class="on"' : ''}></i><i${imp > 1 ? ' class="on"' : ''}></i><i${imp > 2 ? ' class="on"' : ''}></i></button>
    <div class="tdacts" hidden>
      <div class="seg hz">${HORIZONS.map(h => `<button type="button" data-hz="${h.id}" style="--c:${h.c}" aria-pressed="${(st.p.horizon || '') === h.id}"><span class="g">${h.g}</span>${h.label}</button>`).join('')}</div>
      <label class="due">rok <input type="date" data-due value="${st.p.due_on || ''}"></label>${st.p.due_on ? '<button class="ghost" type="button" data-nodue>brez roka</button>' : ''}
      <button class="ghost" type="button" data-goto>odpri v projektu →</button>
    </div></li>`;
}
function renderToday() {
  if (view !== 'today' || !me) return;
  const T = todayStr(), now = new Date();
  const spaces = ['delo', 'osebno'].filter(sp => projects.some(p => p.space === sp));
  if (!spaces.includes(todaySpace)) todaySpace = spaces[0] || 'delo';
  $('#tdCoord').textContent = `${todaySpace.toUpperCase()} · ${DAYS_LONG[now.getDay()]}, ${now.getDate()}. ${now.getMonth() + 1}. ${now.getFullYear()}`;
  const sw = $('#tdSpace'); sw.hidden = spaces.length < 2;
  const cnt = sp => todos.filter(t => spaceOf(t) === sp).map(todoState).filter(x => x.sec === 'danes').length;
  seg(sw, [{ id: 'delo', label: `delo${cnt('delo') ? ' · ' + cnt('delo') : ''}`, c: '#7ee0ff', g: '◆' }, { id: 'osebno', label: `osebno${cnt('osebno') ? ' · ' + cnt('osebno') : ''}`, c: '#ffb454', g: '●' }].filter(x => spaces.includes(x.id)),
    x => x.id === todaySpace, x => { todaySpace = x.id; try { localStorage.setItem('aimm-tdspace-' + me.id, x.id); } catch (e) {} renderToday(); });

  // quick add: projects of this space, remembered per space
  const sel = $('#tdProj'), list = projects.filter(p => p.space === todaySpace);
  let def = null; try { def = localStorage.getItem('aimm-tdproj-' + todaySpace); } catch (e) {}
  if (!list.some(p => p.id === def)) def = (list.find(p => /splo[šs]no|inbox|osebno/i.test(p.name)) || list[0])?.id;
  if (sel.dataset.space !== todaySpace || sel.options.length !== list.length) { sel.innerHTML = list.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join(''); sel.dataset.space = todaySpace; sel.value = def || ''; }

  const mine = todos.filter(t => spaceOf(t) === todaySpace).map(t => ({ t, st: todoState(t) }));
  const by = s => mine.filter(x => x.st.sec === s);
  const imp = x => -(x.st.p.importance || 0), due = x => x.st.dd ?? 9999;
  const sortDanes = a => a.sort((x, y) => (x.st.tone === 'late' ? 0 : 1) - (y.st.tone === 'late' ? 0 : 1) || due(x) - due(y) || imp(x) - imp(y) || y.st.carried - x.st.carried || x.t.t - y.t.t);
  const sortRest = a => a.sort((x, y) => imp(x) - imp(y) || due(x) - due(y) || x.t.t - y.t.t);
  const danes = sortDanes(by('danes')), teden = sortRest(by('teden')), dolgo = sortRest(by('dolgorocno')), none = sortRest(by('none'));
  const done = by('done').sort((x, y) => new Date(y.t.done_at) - new Date(x.t.done_at));
  const late = danes.filter(x => x.st.tone === 'late').length, carried = danes.filter(x => x.st.carried).length;

  const bits = [`<b>${danes.length}</b> za danes`];
  if (late) bits.push(`<b class="late">${late}</b> zamuja`);
  if (teden.length) bits.push(`<b>${teden.length}</b> ta teden`);
  if (done.length) bits.push(`<b class="ok">${done.length}</b> opravljeno danes`);
  $('#tdSum').innerHTML = bits.join(' · ');

  let open = {}; try { open = JSON.parse(localStorage.getItem('aimm-tdopen') || '{}'); } catch (e) {}
  const sec = (id, label, color, items, opts = {}) => {
    const body = items.length ? `<ul class="tdl">${items.map(x => todoRow(x.t, x.st)).join('')}</ul>` : `<div class="tdempty">${opts.empty || 'prazno'}</div>`;
    if (opts.fold) {
      const isOpen = id in open ? open[id] : !!opts.openDefault;
      return `<details class="box tsec" data-sec="${id}" style="--sc:${color}"${isOpen ? ' open' : ''}><summary><span class="sg">${opts.g}</span>${label}<span class="n">${items.length}</span></summary>${body}</details>`;
    }
    return `<section class="box tsec" style="--sc:${color}"><div class="sh2"><span class="sg">${opts.g}</span>${label}<span class="n">${items.length}</span>${opts.extra || ''}</div>${body}</section>`;
  };
  // unplanned: grouped by project
  const groups = list.map(p => ({ p, items: none.filter(x => x.t.project_id === p.id) })).filter(g => g.items.length);
  const noneHtml = groups.length ? groups.map(g => `<div class="tdgrp">${esc(g.p.name)}</div><ul class="tdl">${g.items.map(x => todoRow(x.t, x.st)).join('')}</ul>`).join('')
    : '<div class="tdempty">Vse odprte naloge so razporejene.</div>';
  const noneOpen = 'none' in open ? open.none : false;
  $('#tdLists').innerHTML =
    sec('danes', 'Danes', 'var(--amber)', danes, { g: '☀', empty: 'Za danes še nič. Dodaj zgoraj ali izberi iz spodnjih seznamov (klik na nalogo → ☀ danes).',
      extra: carried ? `<button class="ghost carrybtn" type="button" id="tdCarry" title="Zaostale naloge iz prejšnjih dni prestavi v Ta teden">prestavi zaostale (${carried}) v ta teden</button>` : '' }) +
    sec('teden', 'Ta teden', 'var(--cyan)', teden, { g: '◷', empty: 'Nič za ta teden.' }) +
    sec('dolgorocno', 'Dolgoročno', 'var(--violet)', dolgo, { g: '∞', fold: true, openDefault: dolgo.length <= 5, empty: 'Ni dolgoročnih nalog. Ostanejo tu, dokler jih ne opraviš.' }) +
    `<details class="box tsec" data-sec="none" style="--sc:var(--dim)"${noneOpen ? ' open' : ''}><summary><span class="sg">○</span>Neplanirano<span class="n">${none.length}</span></summary>${noneHtml}</details>` +
    (done.length ? sec('done', 'Opravljeno danes', 'var(--green)', done, { g: '✓', fold: true, openDefault: false }) : '');

  $('#tdLists').querySelectorAll('details[data-sec]').forEach(d => d.addEventListener('toggle', () => {
    open[d.dataset.sec] = d.open; try { localStorage.setItem('aimm-tdopen', JSON.stringify(open)); } catch (e) {}
  }));
  $('#tdCarry')?.addEventListener('click', () => danes.filter(x => x.st.carried && !(x.st.dd !== null && x.st.dd <= 0)).forEach(x => savePlan(x.t.id, { horizon: 'teden' })));
  $('#tdLists').querySelectorAll('li.td').forEach(li => wireTodo(li, todos.find(t => t.id === li.dataset.id)));
}
function wireTodo(li, t) {
  if (!t) return;
  const acts = li.querySelector('.tdacts'), opener = li.querySelector('[data-open]');
  opener.onclick = () => { acts.hidden = !acts.hidden; opener.setAttribute('aria-expanded', String(!acts.hidden)); li.classList.toggle('open', !acts.hidden); };
  li.querySelector('[data-tick]').onclick = async () => {
    const done = !t.done_at;
    const { error } = await sb.rpc('set_todo_done', { eid: t.id, done });
    if (error) return fail('opravljeno', error);
    t.done_at = done ? new Date().toISOString() : null; t.done_by = done ? me.username : null;
    const e = entries.find(x => x.id === t.id); if (e) { e.done_at = t.done_at; e.done_by = t.done_by; }
    renderToday(); renderProjects(); toast(done ? 'opravljeno ✓' : 'spet odprto');
    if (done && !reduce) meteor();
  };
  li.querySelector('[data-imp]').onclick = () => savePlan(t.id, { importance: ((plans.get(t.id)?.importance || 0) + 1) % 4 });
  li.querySelectorAll('[data-hz]').forEach(b => b.onclick = () => savePlan(t.id, { horizon: b.dataset.hz || null, reset: true }));
  li.querySelector('[data-due]').onchange = ev => savePlan(t.id, { due_on: ev.target.value || null });
  li.querySelector('[data-nodue]')?.addEventListener('click', () => savePlan(t.id, { due_on: null }));
  li.querySelector('[data-goto]').onclick = async () => { await selectProject(t.project_id); jumpTo(t.id); };
}
$('#tdAdd').addEventListener('submit', async ev => {
  ev.preventDefault();
  const text = $('#tdText').value.trim(), pid = $('#tdProj').value, when = $('#tdWhen').value, due = $('#tdDue').value;
  if (!text) { $('#tdText').focus(); return; }
  if (!pid) return toast('v tem prostoru še ni projekta');
  const btn = $('#tdAdd button[type=submit]'); btn.disabled = true;
  const { data, error } = await sb.from('entries').insert({ project_id: pid, kind: 'todo', text, files: [], author: me.id }).select('id,project_id,text,created_at,author_name,source,via,agent_id,done_at,done_by,parent_id').single();
  btn.disabled = false;
  if (error) return fail('naloga', error);
  try { localStorage.setItem('aimm-tdproj-' + todaySpace, pid); } catch (e) {}
  todos.push({ ...data, t: new Date(data.created_at).getTime() });
  const pr = projects.find(p => p.id === pid); if (pr) pr.count++;
  $('#tdText').value = ''; $('#tdDue').value = '';
  if (when || due) await savePlan(data.id, { horizon: when || null, due_on: due || null, reset: true }); else { renderToday(); renderProjects(); }
  if (cur === pid) { try { await loadEntries(); } catch (e) {} }
  toast('naloga dodana'); $('#tdText').focus();
});

/* ---------------- meetings ---------------- */
let mEdit = null, mBusy = false, mProj = null;
const localDT = d => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`; };
const words = t => (t.trim().match(/\S+/g) || []).length;
async function getTranscript(e) {
  if (e._tr != null) return e._tr;
  const { data, error } = await sb.from('entries').select('transcript').eq('id', e.id).single();
  if (error) throw error;
  return (e._tr = data.transcript || '');
}
function meetingHtml(e) {
  const kids = entries.filter(x => x.parent_id === e.id && !x.superseded_by);
  const nd = kids.filter(x => x.kind === 'odlocitev').length, nt = kids.filter(x => x.kind === 'todo').length;
  const long = (e.text || '').length > 1200 || (e.text || '').split('\n').length > 18;
  const bits = [esc(stamp(e.meeting_at || e.created_at))];
  if (e.participants.length) bits.push(`${ico('users')}${esc(e.participants.join(', '))}`);
  if (e.transcript_words) bits.push(`${e.transcript_words.toLocaleString('sl-SI')} besed transkripta`);
  if (e.transcript_private) bits.push(`${ico('lock')}transkript samo v aplikaciji`);
  if (nd || nt) bits.push(`iz njega: ${[nd && nd + ' odločitev', nt && nt + ' nalog'].filter(Boolean).join(', ')}`);
  return `<div class="mtitle">${esc(e.title || 'Sestanek')}</div><div class="mline">${bits.map(b => `<span>${b}</span>`).join('')}</div>
    ${e.text ? `<div class="md${long ? ' clamp' : ''}">${md(e.text)}</div>`
      : `<div class="nomin">Zapisnika še ni. Klikni <b>Prompt za zapisnik</b>, prilepi ga v katerikoli AI, odgovor pa dodaj z gumbom Uredi.</div>`}
    <div class="mdtools">${long ? '<button class="btn sm" type="button" data-more>Pokaži vse</button>' : ''}${e.text ? `<button class="btn sm" type="button" data-copy>${ico('copy')}Kopiraj zapisnik</button>` : ''}${e.transcript_words
      ? `<button class="btn sm" type="button" data-tr aria-expanded="false">${ico('file')}Transkript</button><button class="btn sm" type="button" data-trcopy>${ico('copy')}Kopiraj transkript</button><button class="btn sm" type="button" data-mprompt>${ico('copy')}Prompt za zapisnik</button>` : ''}</div>
    <div class="trbox" hidden><pre></pre></div>`;
}
function wireMeeting(li, e) {
  const box = li.querySelector('.md'), more = li.querySelector('[data-more]');
  if (more) more.onclick = () => { const c = box.classList.toggle('clamp'); more.textContent = c ? 'Pokaži vse' : 'Skrči'; };
  li.querySelector('[data-copy]')?.addEventListener('click', () => copyText(`# ${e.title}\n${stamp(e.meeting_at || e.created_at)}${e.participants.length ? ' · ' + e.participants.join(', ') : ''}\n\n${e.text}`, 'zapisnik kopiran'));
  const trBtn = li.querySelector('[data-tr]'); if (!trBtn) return;
  const trBox = li.querySelector('.trbox');
  trBtn.onclick = async () => {
    if (!trBox.hidden) { trBox.hidden = true; trBtn.setAttribute('aria-expanded', 'false'); return; }
    trBox.hidden = false; trBtn.setAttribute('aria-expanded', 'true'); trBox.querySelector('pre').textContent = '> nalagam…';
    try { trBox.querySelector('pre').textContent = await getTranscript(e); } catch (x) { trBox.hidden = true; fail('transkript', x); }
  };
  li.querySelector('[data-trcopy]').onclick = async () => { try { copyText(await getTranscript(e), 'transkript kopiran'); } catch (x) { fail('transkript', x); } };
  li.querySelector('[data-mprompt]').onclick = async () => {
    try { copyText(minutesPrompt(e.title, stamp(e.meeting_at || e.created_at), e.participants.join(', '), await getTranscript(e)), 'prompt kopiran, prilepi ga v AI'); } catch (x) { fail('transkript', x); }
  };
}
function minutesPrompt(title, at, who, tr) {
  return [`Spodaj je transkript sestanka »${title || 'sestanek'}«${at ? ` (${at})` : ''}${who ? `, udeleženci: ${who}` : ''}.`,
    'Napiši zapisnik v slovenščini, točno v tej obliki in brez uvoda:', '',
    '## Povzetek', '3–6 stavkov: o čem je tekla beseda in kaj je bistveno.', '',
    '## Odločitve', '- ena odločitev na vrstico', '',
    '## Naloge', '- [ ] kdo: kaj (rok, če je omenjen)', '',
    '## Odprta vprašanja', '- vprašanje', '',
    'Razdelek brez vsebine izpusti. Ničesar si ne izmišljuj in ne dodajaj, česar ni v transkriptu. Imena piši tako, kot so v transkriptu.', '',
    '--- TRANSKRIPT ---', tr].join('\n');
}
// pull decisions and to-dos out of minutes written in the format above (or close to it)
function parseMinutes(t) {
  const out = { odlocitev: [], todo: [] }; let sec = null;
  for (const raw of (t || '').split('\n')) {
    const h = raw.match(/^\s*#{1,4}\s*(.+?)\s*:?\s*$/) || raw.match(/^\s*\*\*(.+?)\*\*\s*:?\s*$/);
    if (h) {
      const n = h[1].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      sec = /odlocit|sklep|decision/.test(n) ? 'odlocitev' : /nalog|to-?do|action|opravil/.test(n) ? 'todo' : null; continue;
    }
    const li = raw.match(/^\s*(?:[-*•]|\d+[.)])\s+(?:\[[ xX]?\]\s*)?(.+)$/);
    const v = li && li[1].trim();
    if (sec && v && !/^(ni|brez|nobene?n?a?|none|n\/a|—|–|-)\.?$/i.test(v)) out[sec].push(v.slice(0, 2000));
  }
  return out;
}
// .vtt / .srt captions and pasted transcripts → readable "Ime: besedilo" lines
function tidyTranscript(t, captions) {
  const lines = t.replace(/\r\n?/g, '\n').split('\n'), out = [], seen = {};
  let skip = false;
  const push = (who, text) => {
    text = text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); if (!text) return;
    if (who) seen[who] = (seen[who] || 0) + 1;
    const last = out[out.length - 1];
    // same speaker continues; captions without names are grouped into ~paragraph-sized chunks
    if (last && last.who === who && (who || last.text.length < 450)) last.text += ' ' + text; else out.push({ who, text });
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], tl = l.trim();
    if (captions) {
      if (/^WEBVTT/.test(tl)) { skip = true; continue; }
      if (/^(NOTE|STYLE|REGION)\b/.test(tl)) { skip = true; continue; }
      if (!tl) { skip = false; continue; }
      if (skip) continue;
      if (tl.includes('-->') || (lines[i + 1] || '').includes('-->')) continue;   // timing line or cue id
      const v = tl.match(/^<v(?:\.[\w.-]+)?\s+([^>]+)>(.*?)(?:<\/v>)?$/);
      if (v) { push(v[1].trim(), v[2]); continue; }
      const sp = tl.match(/^([^\s:][^:]{0,40}):\s+(.+)$/);
      if (sp && !/^https?$/i.test(sp[1])) { push(sp[1].trim(), sp[2]); continue; }
      push(out.length ? out[out.length - 1].who : null, tl);
    } else {
      if (/^\(?\[?\d{1,2}:\d{2}(:\d{2})?\]?\)?$/.test(tl)) continue;            // bare timestamps
      const sp = tl.match(/^([A-ZČŠŽĆĐ][^:\n]{0,40}):\s+/);
      if (sp) seen[sp[1].trim()] = (seen[sp[1].trim()] || 0) + 1;
      out.push({ raw: l });
    }
  }
  const text = captions ? out.map(o => o.who ? `${o.who}: ${o.text}` : o.text).join('\n\n')
    : out.map(o => o.raw).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const speakers = Object.entries(seen).filter(([n, c]) => c >= (captions ? 1 : 2) && n.length <= 40).sort((a, b) => b[1] - a[1]).map(([n]) => n).slice(0, 20);
  return { text, speakers };
}
let mammothP = null;
const loadMammoth = () => mammothP || (mammothP = new Promise((ok, no) => {
  const sc = document.createElement('script');
  sc.src = 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js';
  sc.onload = () => ok(window.mammoth); sc.onerror = () => { mammothP = null; no(new Error('bralnika za .docx ni bilo mogoče naložiti')); };
  document.head.append(sc);
}));
async function importTranscript(f) {
  if (f.size > 25 * 1048576) { toast(f.name + ' je prevelika'); return; }
  $('#mStatus').textContent = 'berem ' + f.name + '…';
  try {
    let t;
    if (/\.docx$/i.test(f.name)) t = (await (await loadMammoth()).extractRawText({ arrayBuffer: await f.arrayBuffer() })).value;
    else if (/\.(vtt|srt|txt|md|markdown)$/i.test(f.name)) t = await f.text();
    else { $('#mStatus').textContent = ''; toast('za transkript uporabi .vtt, .srt, .txt ali .docx'); return; }
    const { text, speakers } = tidyTranscript(t, /\.(vtt|srt)$/i.test(f.name));
    const ta = $('#mTr'); ta.value = ta.value.trim() ? ta.value.trim() + '\n\n' + text : text;
    if (!$('#mTitle').value.trim()) $('#mTitle').value = f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s*[-–]\s*(transcript|transkript|prepis)\b.*$/i, '').trim().slice(0, 140);
    if (!$('#mWho').value.trim() && speakers.length) $('#mWho').value = speakers.join(', ');
    $('#mStatus').textContent = `uvoženo: ${f.name}`;
  } catch (x) { $('#mStatus').textContent = ''; fail('uvoz', x); }
  mRefresh();
}
function clearMeeting() {
  ['#mTitle', '#mWho', '#mTr', '#mSum'].forEach(id => $(id).value = '');
  $('#mAt').value = localDT(Date.now()); $('#mPriv').checked = false; $('#mSplit').checked = true; $('#mErr').textContent = ''; $('#mStatus').textContent = '';
}
async function openMeeting(e) {
  $('#mErr').textContent = '';
  if (e) {
    mEdit = e; mProj = e.project_id;
    $('#meetH').textContent = 'Uredi sestanek'; $('#mSaveLbl').textContent = 'Shrani spremembe';
    $('#mTitle').value = e.title || ''; $('#mAt').value = localDT(e.meeting_at || e.created_at);
    $('#mWho').value = e.participants.join(', '); $('#mSum').value = e.text || ''; $('#mPriv').checked = !!e.transcript_private;
    $('#mTr').value = e.transcript_words ? '> nalagam…' : ''; $('#mTr').disabled = !!e.transcript_words; $('#mStatus').textContent = '';
    mRefresh(); openSheet('#meetSheet', '#mTitle');
    if (e.transcript_words) { try { $('#mTr').value = await getTranscript(e); } catch (x) { $('#mTr').value = ''; fail('transkript', x); } $('#mTr').disabled = false; }
  } else {
    // a half-finished new meeting survives closing the form; it is only cleared after saving
    if (mEdit || mProj !== cur) clearMeeting();
    mEdit = null; mProj = cur; $('#mTr').disabled = false;
    $('#meetH').textContent = 'Nov sestanek'; $('#mSaveLbl').textContent = 'Shrani sestanek';
    if (!$('#mAt').value) $('#mAt').value = localDT(Date.now());
    openSheet('#meetSheet', '#mTitle');
  }
  mRefresh();
}
function mRefresh() {
  const tr = $('#mTr').disabled ? '' : $('#mTr').value, sum = $('#mSum').value;
  const n = words(tr); $('#mWords').textContent = n ? `· ${n.toLocaleString('sl-SI')} besed` : '';
  const pm = parseMinutes(sum), nd = pm.odlocitev.length, nt = pm.todo.length;
  const hasKids = mEdit && entries.some(x => x.parent_id === mEdit.id);
  $('#mSplitRow').hidden = !(nd || nt) || hasKids;
  $('#mSplitN').textContent = [nd && `${nd} ${nd === 1 ? 'odločitev' : nd === 2 ? 'odločitvi' : nd < 5 ? 'odločitve' : 'odločitev'}`, nt && `${nt} ${nt === 1 ? 'nalogo' : nt === 2 ? 'nalogi' : nt < 5 ? 'naloge' : 'nalog'}`].filter(Boolean).join(' in ');
  $('#mPromptBtn').disabled = !tr.trim();
  $('#mSave').disabled = mBusy || !$('#mTitle').value.trim() || (!tr.trim() && !sum.trim());
}
['#mTitle', '#mTr', '#mSum'].forEach(id => $(id).addEventListener('input', mRefresh));
$('#mFileBtn').onclick = () => $('#mFile').click();
$('#mFile').onchange = ev => { const f = ev.target.files[0]; ev.target.value = ''; if (f) importTranscript(f); };
$('#mPromptBtn').onclick = () => copyText(minutesPrompt($('#mTitle').value.trim(), $('#mAt').value.replace('T', ' '), $('#mWho').value.trim(), $('#mTr').value.trim()), 'prompt kopiran, prilepi ga v AI in odgovor prilepi spodaj');
$('#mPasteSum').onclick = async () => {
  try { const t = (await navigator.clipboard.readText()).trim(); if (!t) throw 0; const ta = $('#mSum'); ta.value = ta.value.trim() ? ta.value.trim() + '\n\n' + t : t; mRefresh(); }
  catch (x) { $('#mSum').focus(); $('#mStatus').textContent = 'Prilepi z Ctrl+V (na telefonu: dolg pritisk → Prilepi).'; }
};
(() => {
  const f = $('#meetForm');
  ['dragenter', 'dragover'].forEach(t => f.addEventListener(t, ev => { ev.preventDefault(); f.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => f.addEventListener(t, ev => { ev.preventDefault(); if (t === 'drop' || !f.contains(ev.relatedTarget)) f.classList.remove('over'); }));
  f.addEventListener('drop', ev => { const x = ev.dataTransfer.files[0]; if (x) importTranscript(x); });
})();
$('#meetForm').addEventListener('submit', async ev => {
  ev.preventDefault(); if (mBusy) return;
  const title = $('#mTitle').value.trim(), tr = $('#mTr').value.trim(), sum = $('#mSum').value.trim();
  const err = m => { $('#mErr').textContent = m; };
  if (!title) return err('Vpiši naslov sestanka.');
  if (!tr && !sum) return err('Dodaj transkript ali zapisnik.');
  if (tr.length > 400000) return err('Transkript je predolg (največ 400.000 znakov). Razdeli ga na dva sestanka.');
  if (sum.length > 20000) return err('Zapisnik je predolg (največ 20.000 znakov).');
  const projectId = mEdit ? mEdit.project_id : mProj;
  const row = {
    title, text: sum, transcript: tr || null, transcript_private: $('#mPriv').checked,
    meeting_at: $('#mAt').value ? new Date($('#mAt').value).toISOString() : new Date().toISOString(),
    participants: [...new Set($('#mWho').value.split(/[,;\n]/).map(x => x.trim()).filter(Boolean))].slice(0, 40)
  };
  const split = !$('#mSplitRow').hidden && $('#mSplit').checked ? parseMinutes(sum) : null;
  mBusy = true; mRefresh(); $('#mStatus').textContent = 'shranjujem…'; err('');
  try {
    let id = mEdit?.id;
    if (mEdit) {
      const { error } = await sb.from('entries').update({ ...row, edited_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
    } else {
      const { data, error } = await sb.from('entries').insert({ ...row, project_id: projectId, kind: 'sestanek', files: [], author: me.id }).select('id').single();
      if (error) throw error; id = data.id;
    }
    if (split && (split.odlocitev.length || split.todo.length)) {
      const rows = [...split.odlocitev.map(t => ({ kind: 'odlocitev', text: t })), ...split.todo.map(t => ({ kind: 'todo', text: t }))]
        .map(r => ({ ...r, project_id: projectId, files: [], author: me.id, parent_id: id }));
      const { error } = await sb.from('entries').insert(rows);
      if (error) throw error;
    }
  } catch (x) { mBusy = false; $('#mStatus').textContent = ''; mRefresh(); return fail('sestanek', x); }
  const wasEdit = !!mEdit; mBusy = false; mEdit = null; clearMeeting(); $('#meetSheet').hidden = true;
  if (cur === projectId) { try { await loadEntries(); } catch (x) { fail('osvežitev', x); } }
  renderAll(); toast(wasEdit ? 'sestanek posodobljen' : 'sestanek shranjen ◎');
  if (!reduce && !wasEdit) meteor();
});

/* ---------------- sheets ---------------- */
function openSheet(id, focus) { $(id).hidden = false; (focus ? $(focus) : $(id).querySelector('button'))?.focus(); }
document.querySelectorAll('.overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o || e.target.closest('[data-close]')) o.hidden = true; }));
addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.overlay').forEach(o => o.hidden = true); });
function openLightbox(f) { $('#lbImg').src = fileUrl(f); $('#lbImg').alt = f.name; $('#lbCap').textContent = `${f.name} · ${kb(f.size)}`; openSheet('#lightbox'); }

/* context export */
function contextMd(p, links = {}) {
  const ok = entries.filter(e => !e.review && !e.superseded_by);  // only approved, current versions
  const L = [`# ${p.name}`, `> izvoz iz Aleks's AI mindmap · prostor: ${p.space} · ${stamp(Date.now())} · ${ok.length} vnosov`, ''];
  KINDS.forEach(k => {
    const es = ok.filter(e => e.kind === k.id); if (!es.length) return;
    L.push(`## ${k.label}`);
    if (k.id === 'sestanek') {
      es.sort((a, b) => a.t - b.t).forEach(e => {
        L.push(`### ${e.title || 'Sestanek'} · ${stamp(e.meeting_at || e.created_at)}`);
        if (e.participants.length) L.push(`udeleženci: ${e.participants.join(', ')}`);
        L.push('', (e.text || '_(zapisnika še ni)_').replace(/^(#{1,4})\s/gm, (_, h) => '#'.repeat(Math.min(6, h.length + 3)) + ' '));
        if (e.transcript_words) L.push('', `_(celoten transkript: ${e.transcript_words} besed, v aplikaciji)_`);
        L.push('');
      });
      return;
    }
    es.sort((a, b) => a.t - b.t).forEach(e => {
      const from = e.parent_id && ok.find(x => x.id === e.parent_id);
      const box = e.kind === 'todo' ? (e.done_at ? '[x] ' : '[ ] ') : '';
      L.push(`- ${box}[${stamp(e.t)} @${e.whoName}] ${(e.text || '').replace(/\n/g, ' / ')}${from ? ` (iz sestanka »${from.title || 'sestanek'}«)` : ''}${e.done_at ? ` (opravljeno ${stamp(e.done_at)})` : ''}`);
      e.files.forEach(f => L.push(`  - priponka: ${f.name}${links[f.path] ? ' → ' + links[f.path] : ''}`));
    });
    L.push('');
  });
  return L.join('\n');
}
$('#ctxBtn').onclick = async () => {
  $('#ctxPre').textContent = '> pripravljam…'; openSheet('#ctxSheet', '#ctxCopy');
  const paths = entries.filter(e => !e.review && !e.superseded_by).flatMap(e => e.files.map(f => f.path)).filter(Boolean);
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
  $('#renameInput').value = p.name; $('#renameSpace').value = p.space; $('#renameInput').select();
};
function closeRename() { $('#renameForm').hidden = true; $('#projTitle').hidden = false; renderHead(); }
$('#renameCancel').onclick = closeRename;
$('#renameInput').addEventListener('keydown', e => { if (e.key === 'Escape') closeRename(); });
$('#renameForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const p = P(), n = $('#renameInput').value.trim(); if (!p || !n) return;
  const space = $('#renameSpace').value;
  const { error } = await sb.from('projects').update({ name: n, space }).eq('id', p.id);
  if (error) return fail('preimenovanje', error);
  p.name = n; p.space = space; closeRename(); renderProjects(); toast('projekt shranjen');
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

/* ---------------- agents & links ---------------- */
const TOOLS = {
  claude: { label: 'Claude', domain: 'claude.ai' },
  chatgpt: { label: 'ChatGPT', domain: 'chatgpt.com' },
  gemini: { label: 'Gemini', domain: 'gemini.google.com' },
  grok: { label: 'Grok', domain: 'grok.com' },
  copilot: { label: 'Copilot', domain: 'copilot.microsoft.com' },
  perplexity: { label: 'Perplexity', domain: 'perplexity.ai' },
  n8n: { label: 'n8n', domain: 'n8n.io' },
};
const VIA_TOOL = { ChatGPT: 'chatgpt', Claude: 'claude', Gemini: 'gemini', Grok: 'grok', Copilot: 'copilot', Perplexity: 'perplexity' };
const COLORS = ['#9be564', '#7ee0ff', '#ffb454', '#f2a7ff', '#ff6b6b', '#d97757', '#c3a6ff', '#e6e9f5'];
const toolDomain = t => !t ? null : t.startsWith('domain:') ? t.slice(7) : TOOLS[t]?.domain || null;
const toolLabel = t => !t ? '' : t.startsWith('domain:') ? t.slice(7) : TOOLS[t]?.label || t;
// the tool's own website icon (like a browser tab icon); a coloured letter if it doesn't load
function toolIcon(tool, name, color) {
  const d = toolDomain(tool), letter = esc((name || '?')[0].toUpperCase());
  return d ? `<img class="ticon" src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64" alt="" data-letter="${letter}" loading="lazy">`
           : `<span class="mono" style="--ac:${esc(color || '#9be564')}">${letter}</span>`;
}
document.addEventListener('error', e => {
  const img = e.target;
  if (img && img.classList && img.classList.contains('ticon')) {
    const s = document.createElement('span'); s.className = 'mono'; s.textContent = img.dataset.letter || '?'; img.replaceWith(s);
  }
}, true);
function agentChip(a) {
  const name = a?.name || 'agent', color = a?.color || '#9be564';
  return `<span class="achip" style="--ac:${esc(color)}">${toolIcon(a?.tool, name, color)}@${esc(name)}</span>`;
}

const fnBase = () => CFG.SUPABASE_URL.replace(/\/+$/, '') + '/functions/v1/';
const readUrl = k => `${fnBase()}context?t=${k}`;
const writeUrl = k => `${fnBase()}ingest?t=${k}`;
const agentInstructions = (k, agentName, projName) => [
  `Si agent »@${agentName}«. Ko končaš korak, naletiš na težavo ali sprejmeš odločitev, to zapiši v moj projekt »${projName}« z zahtevo POST na:`,
  writeUrl(k),
  `Telo (JSON): {"text": "kratek opis, kaj si naredil ali ugotovil", "kind": "misel"}`,
  `kind: misel (zapisek), odlocitev (odločitev), todo (naloga), povezava (povezava), skill (navodila za AI, v Markdownu), prompt. En vnos na korak, kratko in po dejstvih, v slovenščini.`,
  `Skille in prompte pred uporabo pregledam in odobrim. Skillu ali promptu daj kratko ime: {"kind": "skill", "name": "pisanje-clankov", "text": "..."}. Če pošlješ isto ime znova, nastane nova različica, ki po moji odobritvi nadomesti staro.`,
  `Datoteke: dodaj "files": [{"name": "porocilo.pdf", "data": "<base64>"}] (ali multipart/form-data s polji text, kind in file). Dovoljeno: slike (png, jpg, gif, webp), pdf, csv, docx, xlsx, md, txt; največ 5 datotek po 8 MB. Datoteke .md in .txt se shranijo kot besedilo.`,
  `Naloga na moj seznam: {"kind": "todo", "text": "...", "when": "danes" | "teden" | "dolgorocno", "due": "2026-11-21"} (when in due sta neobvezna).`,
  `Sestanek: {"kind": "sestanek", "title": "Tedenski sestanek", "date": "2026-11-17T10:00", "participants": ["Ana", "Marko"], "summary": "## Povzetek ...", "transcript": "celoten transkript"}. Transkript lahko pošlješ tudi kot datoteko .vtt, .srt ali .txt.`,
  `Povezava lahko samo dodaja vnose (podpisane kot @${agentName}), ne more brati ali brisati.`,
  `Primer: curl -X POST "${writeUrl(k)}" -H "Content-Type: application/json" -d '{"text":"Uvožena predloga Investment.","kind":"misel"}'`
].join('\n');
const readInstructions = k => `Preberi moj kontekst s te povezave (samo branje) in ga uporabi pri odgovorih: ${readUrl(k)}`;

async function newKey() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  const key = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))), x => x.toString(16).padStart(2, '0')).join('');
  return { key, hash: h, hint: key.slice(-4) };
}
let agents = [], agLinks = [], legacy = [], shownKey = null;

async function loadAgentsPanel() {
  const p = P(); if (!p) return;
  $('#shProj').textContent = p.name; $('#shSpace').textContent = p.space;
  const [{ data: ag, error: e1 }, { data: ls, error: e2 }] = await Promise.all([
    sb.from('agents').select('id,name,space,color,tool,note,shared,disabled,created_at').order('created_at'),
    sb.from('share_links').select('id,agent_id,project_id,space,mode,label,token_hint,created_at,expires_at,revoked,last_used_at,use_count')
      .eq('revoked', false).or(`project_id.eq.${p.id},space.eq.${p.space}`).order('created_at', { ascending: false }),
  ]);
  if (e1 || e2) return fail('agenti', e1 || e2);
  agents = ag || []; agLinks = (ls || []).filter(l => l.agent_id); legacy = (ls || []).filter(l => !l.agent_id);
  renderAgents();
}
function linkRow(l, a) {
  const p = P(), w = l.mode === 'write', expired = l.expires_at && new Date(l.expires_at) < new Date();
  const scope = w ? `piše v »${esc(p.name)}«` : l.project_id ? `bere »${esc(p.name)}«` : `bere ves prostor ${esc(l.space)}`;
  const d = document.createElement('div'); d.className = 'lrow';
  d.innerHTML = `<span class="mode${w ? ' w' : ''}">${w ? 'PIŠE' : 'BERE'}</span><span>${scope}</span>
    <span class="muted">…${esc(l.token_hint || '????')} · ${l.expires_at ? (expired ? '<b style="color:var(--red)">potekla</b>' : 'do ' + stamp(l.expires_at).slice(0, 10)) : 'brez roka'} · uporabljena ${esc(ago(l.last_used_at))}${l.use_count ? ` (${l.use_count}×)` : ''}</span>
    <span class="spacer"></span>${a ? `<button class="ghost" type="button" data-renew>${ico('key')}Obnovi</button>` : ''}<button class="ghost danger" type="button" data-rev>${ico('trash')}Prekliči</button>`;
  if (a) d.querySelector('[data-renew]').onclick = () => createLink(a, l.mode, l.project_id ? 'project' : 'space', l);
  confirmBtn(d.querySelector('[data-rev]'), 'Res prekliči?', async () => {
    const { error } = await sb.from('share_links').update({ revoked: true }).eq('id', l.id);
    if (error) return fail('preklic', error);
    toast('povezava preklicana'); loadAgentsPanel();
  });
  return d;
}
function renderAgents() {
  const p = P(), box = $('#agentList'); box.innerHTML = '';
  if (!agents.length) box.innerHTML = '<div class="muted">Še ni agentov. Ustvari prvega spodaj.</div>';
  agents.forEach(a => {
    const c = document.createElement('div'); c.className = 'agcard' + (a.disabled ? ' off' : ''); c.style.setProperty('--ac', a.color);
    const fits = a.space === p.space && !a.disabled;
    c.innerHTML = `<div class="top">${agentChip(a)}<span class="badge">${esc(a.space)}</span>${a.shared ? '<span class="badge">deljen račun</span>' : ''}${a.disabled ? '<span class="badge blk">onemogočen</span>' : ''}${a.tool ? `<span class="muted">${esc(toolLabel(a.tool))}</span>` : ''}<span class="spacer"></span>
        <button class="ghost" type="button" data-edit>${ico('edit')}Uredi</button><button class="ghost${a.disabled ? '' : ' danger'}" type="button" data-dis>${ico(a.disabled ? 'key' : 'lock')}${a.disabled ? 'Omogoči' : 'Onemogoči'}</button></div>
      ${a.note ? `<div class="muted">${esc(a.note)}</div>` : ''}
      <div class="links"></div>
      ${fits ? `<div class="mk"><button class="btn sm" type="button" data-mk="write">${ico('plus')}Pisanje v ta projekt</button><button class="btn sm" type="button" data-mk="read">${ico('plus')}Branje projekta</button><button class="btn sm" type="button" data-mk="space">${ico('plus')}Branje celega prostora ${esc(a.space)}</button></div>`
        : `<div class="muted">${a.disabled ? 'Onemogočen agent ne more dobiti povezav.' : `Ta agent je v prostoru »${esc(a.space)}«, projekt pa v »${esc(p.space)}«, zato mu ga ni mogoče deliti.`}</div>`}`;
    const lbox = c.querySelector('.links');
    agLinks.filter(l => l.agent_id === a.id).forEach(l => lbox.append(linkRow(l, a)));
    c.querySelectorAll('[data-mk]').forEach(b => b.onclick = () => createLink(a, b.dataset.mk === 'write' ? 'write' : 'read', b.dataset.mk === 'space' ? 'space' : 'project'));
    c.querySelector('[data-dis]').onclick = async () => {
      const { error } = await sb.from('agents').update({ disabled: !a.disabled }).eq('id', a.id);
      if (error) return fail('agent', error);
      toast(a.disabled ? '@' + a.name + ' spet deluje' : '@' + a.name + ' onemogočen, vse njegove povezave ne delujejo'); loadAgentsPanel();
    };
    c.querySelector('[data-edit]').onclick = () => {
      if (c.querySelector('.agedit')) { c.querySelector('.agedit').remove(); return; }
      const ed = document.createElement('form'); ed.className = 'agedit';
      ed.innerHTML = `<div class="sub-l">UREDI @${esc(a.name)} (ime in prostor ostaneta)</div><select data-tool aria-label="Orodje"></select><input data-domain placeholder="spletna stran orodja" hidden><div class="colors" data-colors></div>
        <label class="checks"><input type="checkbox" data-shared ${a.shared ? 'checked' : ''}>deljen službeni račun</label><input data-note class="lblin" maxlength="120" placeholder="opomba" value="${esc(a.note || '')}"><button class="btn sm primary" type="submit">Shrani</button>`;
      const st = toolPicker(ed.querySelector('[data-tool]'), ed.querySelector('[data-domain]'), a.tool);
      const sc = colorPicker(ed.querySelector('[data-colors]'), a.color);
      ed.onsubmit = async ev => {
        ev.preventDefault();
        const { error } = await sb.from('agents').update({ tool: st(), color: sc(), shared: ed.querySelector('[data-shared]').checked, note: ed.querySelector('[data-note]').value.trim() || null }).eq('id', a.id);
        if (error) return fail('agent', error);
        toast('@' + a.name + ' shranjen'); loadAgentsPanel();
      };
      c.append(ed);
    };
    box.append(c);
  });
  const lb = $('#legacyList'); lb.innerHTML = ''; $('#legacyH').hidden = !legacy.length;
  legacy.forEach(l => lb.append(linkRow(l, null)));
}
async function createLink(a, mode, scope, replacing) {
  const p = P(); if (!p) return;
  const k = await newKey(), days = +$('#shareExp').value;
  const row = { created_by: me.id, agent_id: a.id, label: a.name, mode, token: 'h:' + k.hash, token_hash: k.hash, token_hint: k.hint,
    expires_at: new Date(Date.now() + days * 864e5).toISOString() };
  if (scope === 'space') row.space = a.space; else row.project_id = p.id;
  const { error } = await sb.from('share_links').insert(row);
  if (error) return fail('nova povezava', error);
  if (replacing) await sb.from('share_links').update({ revoked: true }).eq('id', replacing.id);
  shownKey = { key: k.key, mode, agent: a.name, proj: p.name };
  $('#newKeyUrl').textContent = mode === 'write' ? writeUrl(k.key) : readUrl(k.key);
  $('#newKey').hidden = false; $('#newKey').scrollIntoView({ block: 'nearest' });
  toast(replacing ? 'povezava obnovljena, stara ne deluje več' : 'povezava ustvarjena');
  loadAgentsPanel();
}
$('#newKeyCopy').onclick = () => shownKey && copyText(shownKey.mode === 'write' ? writeUrl(shownKey.key) : readUrl(shownKey.key), 'povezava kopirana');
$('#newKeyCopyInstr').onclick = () => shownKey && copyText(shownKey.mode === 'write' ? agentInstructions(shownKey.key, shownKey.agent, shownKey.proj) : readInstructions(shownKey.key), 'kopirano z navodilom');
$('#newKeyHide').onclick = () => { $('#newKey').hidden = true; shownKey = null; $('#newKeyUrl').textContent = ''; };

function toolPicker(sel, dom, current) {
  sel.innerHTML = `<option value="">brez ikone</option>${Object.entries(TOOLS).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join('')}<option value="__domain">drugo (spletna stran)…</option>`;
  if (current?.startsWith('domain:')) { sel.value = '__domain'; dom.value = current.slice(7); dom.hidden = false; }
  else sel.value = current || '';
  sel.onchange = () => { dom.hidden = sel.value !== '__domain'; if (!dom.hidden) dom.focus(); };
  return () => sel.value === '__domain' ? (dom.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '') ? 'domain:' + dom.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase() : null) : (sel.value || null);
}
function colorPicker(box, current) {
  let val = current || COLORS[0];
  const draw = () => {
    box.innerHTML = COLORS.map(c => `<button type="button" style="--sw:${c}" aria-label="Barva ${c}" aria-pressed="${c.toLowerCase() === val.toLowerCase()}" data-c="${c}"></button>`).join('') + `<input type="color" value="${val}" aria-label="Poljubna barva">`;
    box.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { val = b.dataset.c; draw(); });
    box.querySelector('input').oninput = e => { val = e.target.value; box.querySelectorAll('[data-c]').forEach(b => b.setAttribute('aria-pressed', 'false')); };
  };
  draw(); return () => val;
}
let agToolGet = null, agColorGet = null;
$('#shareBtn').onclick = () => {
  $('#agentList').innerHTML = '<div class="loading">&gt; nalagam…</div>'; $('#newKey').hidden = true; shownKey = null;
  agToolGet = toolPicker($('#agTool'), $('#agDomain'), null); agColorGet = colorPicker($('#agColors'), COLORS[0]);
  $('#agSpace').value = P()?.space || 'delo';
  openSheet('#shareSheet'); loadAgentsPanel();
};
$('#agentForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const name = $('#agName').value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,29}$/.test(name)) { $('#agErr').textContent = 'Ime: 2–30 znakov, male črke, številke, . _ -'; return; }
  const { data: taken } = await sb.rpc('name_taken', { n: name });
  if (taken) { $('#agErr').textContent = 'To ime je že zasedeno (agent ali oseba).'; return; }
  const { error } = await sb.from('agents').insert({ name, space: $('#agSpace').value, color: agColorGet(), tool: agToolGet(), shared: $('#agShared').checked, note: $('#agNote').value.trim() || null, created_by: me.id });
  if (error) { $('#agErr').textContent = /duplicate|unique/i.test(error.message) ? 'To ime je že zasedeno.' : error.message; return; }
  $('#agErr').textContent = ''; $('#agName').value = ''; $('#agNote').value = ''; $('#agShared').checked = false; $('#newAgentBox').open = false;
  toast('agent @' + name + ' ustvarjen'); loadAgentsPanel();
});

/* ---------------- refresh when coming back to the tab ---------------- */
addEventListener('focus', async () => {
  if (!me || busy || editing || Date.now() - lastLoad < 20000) return;
  if ($('#app').hidden) return;
  sb.rpc('touch_seen').then(({ error }) => error && console.warn(error));
  try { await loadProjects(); await loadEntries(); await loadTodos(); renderAll(); if (view === 'today') renderToday(); } catch (e) { console.warn(e); }
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
