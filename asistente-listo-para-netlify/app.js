/* Asistente personal de tareas y hábitos. 100% local (IndexedDB), sin servidores.
   Secciones: utilidades · base de datos · rutinas · análisis · vistas · formularios · eventos */
'use strict';

/* ---------- utilidades ---------- */
const $ = (s, e = document) => e.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [a, b, c] = s.split('-').map(Number); return new Date(a, b - 1, c); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
const diff = (a, b) => Math.round((parse(a) - parse(b)) / 864e5);
const today = () => ymd(new Date());
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
const fd = d => parse(d).toLocaleDateString('es-AR');
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const doneDate = t => ymd(new Date(t.doneAt));
const keyOf = t => t.freqId ? 'f' + t.freqId : 't' + norm(t.title);
const pw = { alta: 0, media: 1, baja: 2 };
const byPr = (a, b) => pw[a.priority] - pw[b.priority] || a.createdAt - b.createdAt;
const inR = (d, a, b) => d >= a && d <= b;
const toast = m => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 2200); };

/* ---------- base de datos (IndexedDB) ---------- */
const STORES = ['tasks', 'freq', 'routines', 'meta'];
const S = { tasks: [], freq: [], routines: [], meta: [] };
let db;
const openDB = () => new Promise((ok, ko) => {
  const r = indexedDB.open('asistente', 1);
  r.onupgradeneeded = () => STORES.forEach(s => r.result.createObjectStore(s, { keyPath: 'id' }));
  r.onsuccess = () => { db = r.result; ok(); };
  r.onerror = () => ko(r.error);
});
const tx = (s, m, f) => new Promise((ok, ko) => {
  const t = db.transaction(s, m); const o = f(t.objectStore(s));
  t.oncomplete = () => ok(o && o.result); t.onerror = () => ko(t.error);
});
const put = (s, v) => tx(s, 'readwrite', o => o.put(v));
const del = (s, id) => tx(s, 'readwrite', o => o.delete(id));
const load = async () => { for (const s of STORES) S[s] = await tx(s, 'readonly', o => o.getAll()); };
const newTask = o => ({ id: uid(), title: '', desc: '', date: today(), priority: 'media', category: '', done: false, doneAt: null, createdAt: Date.now(), ...o });
const cats = () => [...new Set(S.tasks.map(t => t.category).filter(Boolean))];

/* ---------- rutinas: generación automática sin duplicados ---------- */
function isDue(r, d) {
  const dt = parse(d), w = dt.getDay();
  switch (r.type) {
    case 'daily': return true;
    case 'weekdays': return w > 0 && w < 6;
    case 'days': return r.days.includes(w);
    case 'weekly': return w === parse(r.start).getDay();
    case 'monthly': return dt.getDate() === parse(r.start).getDate();
    case 'interval': return d >= r.start && diff(d, r.start) % r.n === 0;
  }
  return false;
}
async function generate() {
  const T = today();
  for (const r of S.routines) {
    let from = r.last ? addDays(r.last, 1) : r.start;
    if (diff(T, from) > 31) from = addDays(T, -31);
    for (let d = from; d <= T; d = addDays(d, 1)) {
      if (d < r.start || !isDue(r, d)) continue;
      if (S.tasks.some(x => x.recId === r.id && x.date === d)) continue;
      await put('tasks', newTask({ title: r.title, date: d, priority: r.priority, category: r.category, recId: r.id, freqId: r.freqId }));
    }
    r.last = T; await put('routines', r);
  }
  await load();
}

/* ---------- análisis local (solo registros reales: tareas COMPLETADAS) ---------- */
function history() {
  const m = {}, T = today();
  for (const t of S.tasks) {
    const k = keyOf(t);
    const e = m[k] ??= { key: k, title: t.title, days: new Set(), pend: 0, added: 0, fid: t.freqId, po: null };
    e.added++; e.title = t.title;
    if (t.done) e.days.add(doneDate(t));
    else if (t.date < T) { e.pend++; if (!e.po || t.date < e.po) e.po = t.date; }
  }
  return Object.values(m).map(e => {
    const d = [...e.days].sort();
    const gaps = d.slice(1).map((x, i) => diff(x, d[i]));
    const avg = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 0;
    return { ...e, d, n: d.length, avg, last: d.at(-1), since: d.length ? diff(T, d.at(-1)) : null,
      habit: d.length >= 3 && diff(d.at(-1), d[0]) >= 14 };
  });
}
const histDays = () => S.tasks.length ? diff(today(), ymd(new Date(Math.min(...S.tasks.map(t => t.createdAt))))) : 0;
const dismissMap = () => S.meta.find(m => m.id === 'dismiss')?.map || {};

function forgotten() {
  const T = today(), out = [], dm = dismissMap();
  if (histDays() < 14) return { out, low: true };
  for (const h of history()) {
    if (h.habit && h.since > Math.max(h.avg * 1.5, h.avg + 7))
      out.push({ id: h.key + 'a', key: h.key, title: h.title, txt: `Sueles hacerla cada unos ${h.avg} días (promedio calculado con ${h.n} registros reales). Hace ${h.since} días que no la registras.`, ev: h.d.slice(-5) });
    else if (h.n === 0 && h.added >= 3)
      out.push({ id: h.key + 'b', key: h.key, title: h.title, txt: `La agregaste ${h.added} veces y todavía no la completaste.`, ev: [] });
    else if (h.pend > 0 && diff(T, h.po) > 7)
      out.push({ id: h.key + 'c', key: h.key, title: h.title, txt: `Tiene ${h.pend} pendiente(s) sin completar; la más antigua es del ${fd(h.po)}.`, ev: [] });
    if (h.habit && histDays() >= 60) {
      const c1 = h.d.filter(x => diff(T, x) < 30).length, c0 = h.d.filter(x => diff(T, x) >= 30 && diff(T, x) < 60).length;
      if (c0 >= 3 && c1 <= c0 / 2) out.push({ id: h.key + 'd', key: h.key, title: h.title, txt: `Antes la completabas ${c0} veces en 30 días; en los últimos 30 días, ${c1}.`, ev: h.d.filter(x => diff(T, x) < 60).slice(-5) });
    }
  }
  return { out: out.filter(o => !(dm[o.id] > T)), low: false };
}

function range() {
  const T = today(), p = UI.per; let from, to = T;
  if (p === 'mes') from = T.slice(0, 8) + '01';
  else if (p === 'mp') { const d = parse(T.slice(0, 8) + '01'); d.setDate(0); to = ymd(d); from = to.slice(0, 8) + '01'; }
  else if (p === 'c') { from = UI.from || addDays(T, -29); to = UI.to || T; if (from > to) [from, to] = [to, from]; }
  else from = addDays(T, -(+p) + 1);
  const n = diff(to, from) + 1; let pf, pt;
  if (p === 'mes' || p === 'mp') { const d = parse(from); d.setDate(0); pt = ymd(d); pf = pt.slice(0, 8) + '01'; }
  else { pt = addDays(from, -1); pf = addDays(pt, -n + 1); }
  return { from, to, n, pf, pt };
}

/* ---------- estado de interfaz ---------- */
const UI = { view: 'dia', sort: 'uso', per: '30', from: '', to: '', calMonth: today().slice(0, 7), calDay: today(), filt: { st: '', pr: '', cat: '', tp: '', all: false }, sel: new Set(), more: 50 };

/* ---------- componentes ---------- */
const chip = (k, v, l) => `<button class="chip ${UI[k] === v ? 'on' : ''}" data-act="set" data-k="${k}" data-v="${v}">${l}</button>`;
const fab = (d = '') => `<button class="fab" data-act="new" data-d="${d}" aria-label="Nueva tarea">+</button>`;
const taskLi = (t, o = {}) => `<li class="task ${t.done ? 'done' : ''} p-${t.priority}" data-id="${t.id}">
  <button class="chk" data-act="tog" aria-label="${t.done ? 'Marcar como pendiente' : 'Completar'}">${t.done ? '✓' : ''}</button>
  <div class="tb" data-act="edit"><b>${esc(t.title)}</b><small>${[t.recId ? 'Rutina' : '', t.category, o.late ? 'Desde ' + fd(t.date) : '', t.origDate ? 'Fecha original ' + fd(t.origDate) : '', t.done ? 'Hecha ' + new Date(t.doneAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '', 'prioridad ' + t.priority].filter(Boolean).map(esc).join(', ')}</small>${t.desc ? `<p>${esc(t.desc)}</p>` : ''}</div></li>`;
const sec = (title, list, o) => list.length ? `<h2>${title}<span class="n">${list.length}</span></h2><ul class="list">${list.map(t => taskLi(t, o)).join('')}</ul>` : '';

/* ---------- vistas ---------- */
const V = {};
V.dia = () => {
  const T = today(), tt = S.tasks.filter(t => t.date === T);
  const late = S.tasks.filter(t => !t.done && t.date < T).sort((a, b) => a.date < b.date ? -1 : 1);
  const pend = tt.filter(t => !t.done).sort(byPr), dn = tt.filter(t => t.done);
  const pct = tt.length ? Math.round(dn.length / tt.length * 100) : 0;
  return `<h1>${cap(parse(T).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }))}</h1>
  <div class="prog"><div style="width:${pct}%"></div></div>
  <p class="nums"><span><b>${tt.length}</b>total</span><span><b>${dn.length}</b>hechas</span><span><b>${pend.length}</b>pendientes</span><span><b>${pct}%</b>progreso</span></p>`
    + sec('Atrasadas', late, { late: 1 }) + sec('Pendientes de hoy', pend) + sec('Completadas', dn)
    + (tt.length + late.length ? '' : '<p class="empty">No hay tareas para hoy. Entra en “Armar mi día” o toca + para crear una.</p>') + fab();
};

V.frec = () => {
  const L = [...S.freq].sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || (UI.sort === 'uso' ? (b.uses || 0) - (a.uses || 0) : (b.lastUsed || 0) - (a.lastUsed || 0)));
  return `<h1>Frecuentes</h1><div class="chips">${chip('sort', 'uso', 'Más usadas')}${chip('sort', 'rec', 'Usadas recientemente')}</div>
  <button class="btn block" data-act="newfreq">Nueva tarea frecuente</button>
  <ul class="list">${L.map(f => `<li class="task" data-fid="${f.id}"><button class="chk add" data-act="addf" aria-label="Agregar a hoy">+</button>
  <div class="tb" data-act="editf"><b>${esc(f.title)}</b><small>${f.uses || 0} veces agregada${f.lastUsed ? ', última el ' + fd(ymd(new Date(f.lastUsed))) : ''}</small></div>
  <button class="star ${f.fav ? 'on' : ''}" data-act="fav" aria-label="Favorita">★</button></li>`).join('') || '<p class="empty">La biblioteca está vacía. Crea tu primera tarea frecuente.</p>'}</ul>`;
};

V.armar = () => {
  const T = today(), H = history(), tt = S.tasks.filter(t => t.date === T), inToday = new Set(tt.map(keyOf)), used = new Set(inToday);
  const late = S.tasks.filter(t => !t.done && t.date < T);
  const wd = parse(T).getDay();
  const sug = H.filter(h => !used.has(h.key) && h.d.filter(d => diff(T, d) <= 56 && parse(d).getDay() === wd).length >= 2);
  sug.forEach(h => used.add(h.key));
  const fg = forgotten().out.filter(o => !used.has(o.key)); fg.forEach(o => used.add(o.key));
  const fr = S.freq.filter(f => !inToday.has('f' + f.id) && !sug.some(h => h.key === 'f' + f.id) && !fg.some(o => o.key === 'f' + f.id))
    .sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || (b.uses || 0) - (a.uses || 0));
  const pick = (v, t, s) => `<label class="pick"><input type="checkbox" data-act="pick" value="${esc(v)}" ${UI.sel.has(v) ? 'checked' : ''}><span>${esc(t)}<small>${esc(s)}</small></span></label>`;
  const rt = S.tasks.filter(t => t.date === T && t.recId).length;
  const g = (t, items) => items ? `<h2>${t}</h2>${items}` : '';
  return `<h1>Armar mi día</h1><p class="note">Marca lo que quieras sumar a hoy. Nada se agrega sin tu permiso, salvo tus rutinas configuradas (${rt} ya generadas hoy).</p>`
    + g('Pendientes de días anteriores', late.map(t => pick('late:' + t.id, t.title, 'Desde ' + fd(t.date) + '; se conserva la fecha original')).join(''))
    + g('Sugeridas por tu historial', sug.map(h => pick('h:' + h.key, h.title, `La completaste ${h.d.filter(d => diff(T, d) <= 56 && parse(d).getDay() === wd).length} veces en este día de la semana durante las últimas 8 semanas`)).join(''))
    + g('Hace tiempo que no las haces', fg.map(o => pick('h:' + o.key, o.title, o.txt)).join(''))
    + g('Frecuentes', fr.map(f => pick('f:' + f.id, f.title, (f.fav ? 'Favorita, ' : '') + (f.uses || 0) + ' usos')).join(''))
    + (UI.sel.size ? `<div class="fixbar"><button class="btn block" data-act="addsel">Agregar ${UI.sel.size} a hoy</button></div>` : '');
};

const filtered = () => S.tasks.filter(t => {
  const f = UI.filt;
  return (!f.st || (f.st === 'h') === t.done) && (!f.pr || t.priority === f.pr) && (!f.cat || norm(t.category).includes(norm(f.cat)))
    && (!f.tp || (f.tp === 'rut' ? !!t.recId : f.tp === 'frec' ? (t.freqId && !t.recId) : (!t.freqId && !t.recId)));
});
V.cal = () => {
  const [y, m] = UI.calMonth.split('-').map(Number), F = filtered(), T = today();
  const off = (new Date(y, m - 1, 1).getDay() + 6) % 7, dim = new Date(y, m, 0).getDate();
  const cell = d => { const L = F.filter(t => t.date === d), a = L.filter(t => !t.done).length, g = L.length - a;
    return `<button class="day ${d === UI.calDay ? 'sel' : ''} ${d === T ? 'today' : ''}" data-act="calday" data-d="${d}">${+d.slice(8)}${a ? `<i class="a">${a} pend.</i>` : ''}${g ? `<i class="g">${g} hechas</i>` : ''}</button>`; };
  let grid = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(x => `<div class="h">${x}</div>`).join('') + '<span></span>'.repeat(off);
  for (let i = 1; i <= dim; i++) grid += cell(`${y}-${pad(m)}-${pad(i)}`);
  const sel = o => (v, l) => `<option value="${v}" ${o === v ? 'selected' : ''}>${l}</option>`;
  const f = UI.filt;
  let list;
  if (f.all) {
    const L = [...F].sort((a, b) => a.date < b.date ? 1 : -1);
    list = `<h2>Historial completo<span class="n">${L.length}</span></h2><ul class="list">${L.slice(0, UI.more).map(t => taskLi(t)).join('')}</ul>` + (L.length > UI.more ? '<button class="btn sec block" data-act="more">Mostrar más</button>' : '');
  } else {
    const L = F.filter(t => t.date === UI.calDay).sort((a, b) => a.done - b.done || byPr(a, b));
    const X = F.filter(t => t.done && doneDate(t) === UI.calDay && t.date !== UI.calDay);
    list = `<h2>${cap(parse(UI.calDay).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }))}</h2>` + (L.length ? `<ul class="list">${L.map(t => taskLi(t)).join('')}</ul>` : '<p class="empty">No hay tareas en esta fecha con los filtros actuales.</p>')
      + (X.length ? `<h2>Completadas este día (planificadas en otra fecha)</h2><ul class="list">${X.map(t => taskLi(t)).join('')}</ul>` : '');
  }
  return `<h1>Calendario</h1><div class="row"><button class="btn sec" data-act="calprev" aria-label="Mes anterior">‹</button><b style="flex:3;text-align:center;align-self:center">${cap(new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }))}</b><button class="btn sec" data-act="calnext" aria-label="Mes siguiente">›</button></div>
  <div class="grid">${grid}</div>
  <details><summary>Filtros</summary>
   <div class="row"><label>Estado<select data-f="st">${sel(f.st)('', 'Todos')}${sel(f.st)('p', 'Pendientes')}${sel(f.st)('h', 'Hechas')}</select></label>
   <label>Prioridad<select data-f="pr">${sel(f.pr)('', 'Todas')}${sel(f.pr)('alta', 'Alta')}${sel(f.pr)('media', 'Media')}${sel(f.pr)('baja', 'Baja')}</select></label></div>
   <div class="row"><label>Tipo<select data-f="tp">${sel(f.tp)('', 'Todos')}${sel(f.tp)('rut', 'Rutinas')}${sel(f.tp)('frec', 'De Frecuentes')}${sel(f.tp)('uni', 'Únicas')}</select></label>
   <label>Categoría<input data-f="cat" value="${esc(f.cat)}" placeholder="Texto"></label></div>
   <label class="inl"><input type="checkbox" data-f="all" ${f.all ? 'checked' : ''}> Ver todo el historial (ignora el día elegido)</label></details>` + list + fab(UI.calDay);
};

V.stats = () => {
  const r = range();
  const sched = S.tasks.filter(t => inR(t.date, r.from, r.to)), sd = sched.filter(t => t.done).length;
  const dn = S.tasks.filter(t => t.done && inR(doneDate(t), r.from, r.to)), pd = S.tasks.filter(t => t.done && inR(doneDate(t), r.pf, r.pt));
  const cnt = L => { const m = {}; L.forEach(t => (m[keyOf(t)] ??= { title: t.title, n: 0 }).n++); return Object.values(m); };
  const c = cnt(dn).sort((a, b) => b.n - a.n);
  const wd = Array(7).fill(0); dn.forEach(t => wd[parse(doneDate(t)).getDay()]++);
  const nm = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const mx = Math.max(...wd), mn = Math.min(...wd);
  const bs = r.n <= 31 ? 1 : r.n <= 100 ? 7 : 30, B = Array(Math.ceil(r.n / bs)).fill(0);
  dn.forEach(t => B[Math.floor(diff(doneDate(t), r.from) / bs)]++);
  const bm = Math.max(1, ...B);
  const cc = L => { const m = {}; L.forEach(t => { if (t.category) m[t.category] = (m[t.category] || 0) + 1; }); return m; };
  const a = cc(dn), b = cc(pd), recs = [];
  for (const k in b) if (b[k] >= 3 && (a[k] || 0) <= b[k] / 2) recs.push(`En el período anterior completaste ${b[k]} actividades de “${k}” y en este ${a[k] || 0}. ¿Quieres programar una esta semana?`);
  forgotten().out.slice(0, 3).forEach(o => recs.push(`${o.title}: ${o.txt}`));
  const rows = L => L.map(x => `<div class="bar"><span>${esc(x.title)}</span><b>${x.n}</b></div>`).join('') || '<p class="empty">Sin registros.</p>';
  const per = [['7', '7 días'], ['30', '30 días'], ['90', '3 meses'], ['180', '6 meses'], ['365', '12 meses'], ['mes', 'Este mes'], ['mp', 'Mes anterior'], ['c', 'Personalizado']];
  return `<h1>Estadísticas</h1><div class="chips">${per.map(([v, l]) => chip('per', v, l)).join('')}</div>
  ${UI.per === 'c' ? `<div class="row"><label>Desde<input type="date" data-p="from" value="${UI.from || addDays(today(), -29)}"></label><label>Hasta<input type="date" data-p="to" value="${UI.to || today()}"></label></div>` : ''}
  <p class="note">${fd(r.from)} al ${fd(r.to)}. Solo cuentan tareas marcadas como completadas, según su fecha real de finalización.</p>
  <p class="nums"><span><b>${dn.length}</b>completadas</span><span><b>${sched.length - sd}</b>pendientes</span><span><b>${sched.length ? Math.round(sd / sched.length * 100) : 0}%</b>cumplimiento</span></p>
  <h2>Evolución</h2><div class="chart">${B.map(v => `<i style="height:${v / bm * 100}%" title="${v}"></i>`).join('')}</div><small>Cada barra: ${bs === 1 ? 'un día' : bs + ' días'}.</small>
  <h2>Comparación con el período anterior</h2><p class="card">${dn.length} completadas frente a ${pd.length} entre el ${fd(r.pf)} y el ${fd(r.pt)}.</p>
  <h2>Más realizadas</h2>${rows(c.slice(0, 5))}<h2>Menos realizadas</h2>${rows([...c].reverse().slice(0, 5))}
  <h2>Días de la semana</h2>${dn.length < 5 ? '<p class="empty">Hay pocos registros para hablar de días más o menos productivos.</p>' : `<p class="card">Más actividad: ${nm[wd.indexOf(mx)]} (${mx}). Menos actividad: ${nm[wd.indexOf(mn)]} (${mn}).</p>`}
  <h2>Recomendaciones</h2>${recs.length ? recs.map(x => `<p class="card">${esc(x)}</p>`).join('') : '<p class="empty">Sin recomendaciones: faltan datos o todo marcha según tu historial.</p>'}`;
};

V.olv = () => {
  const { out, low } = forgotten(), occ = history().filter(h => !h.habit && h.n > 0).length;
  return `<h1>Actividades olvidadas</h1>` + (low ? '<p class="note">Todavía no hay suficiente historial (menos de 14 días de uso) para afirmar que algo está olvidado.</p>'
    : out.length ? `<ul class="list cards">${out.map(o => `<li class="card"><b>${esc(o.title)}</b><p>${esc(o.txt)}</p>${o.ev.length ? `<small>Registros que lo justifican: ${o.ev.map(fd).join(', ')}</small>` : ''}
    <div class="row"><button class="btn sec" data-act="snooze" data-oid="${esc(o.id)}">Posponer 7 días</button><button class="btn sec" data-act="discard" data-oid="${esc(o.id)}">Descartar</button></div></li>`).join('')}</ul>`
      : '<p class="empty">Con tus registros actuales no se detecta nada descuidado.</p>')
    + `<p class="note">Un hábito se detecta con 3 o más realizaciones en al menos 14 días. Las ${occ} actividades con menos registros se consideran ocasionales y no se marcan como olvidadas.</p>`;
};

V.cfg = () => `<h1>Ajustes</h1>
  <p class="card">Datos guardados: ${S.tasks.length} tareas, ${S.freq.length} frecuentes, ${S.routines.length} rutinas. Todo vive solo en este dispositivo.</p>
  <button class="btn block" data-act="export">Exportar copia de seguridad (JSON)</button>
  <button class="btn sec block" data-act="import">Importar copia de seguridad</button>
  <button class="btn sec block" data-act="persist">Pedir almacenamiento persistente</button>
  <h2>Rutinas</h2>${S.routines.length ? `<ul class="list">${S.routines.map(r => `<li class="task" data-rid="${r.id}"><div class="tb"><b>${esc(r.title)}</b><small>${esc(routineText(r))}</small></div><button class="btn danger" data-act="delr">Quitar</button></li>`).join('')}</ul><small>Quitar una rutina no borra su historial.</small>` : '<p class="empty">No hay rutinas. Crea una desde el botón + eligiendo “Repetir”.</p>'}`;
const routineText = r => ({ daily: 'Todos los días', weekdays: 'De lunes a viernes', days: 'Días: ' + (r.days || []).map(d => 'dom lun mar mié jue vie sáb'.split(' ')[d]).join(', '), weekly: 'Semanal', monthly: 'Mensual', interval: 'Cada ' + r.n + ' días' }[r.type]);

/* ---------- formularios ---------- */
function dlg(html, onSubmit) {
  const d = $('#dlg'); d.innerHTML = html; d.showModal();
  const f = $('form', d); if (f && onSubmit) f.onsubmit = async e => { e.preventDefault(); await onSubmit(Object.fromEntries(new FormData(f)), f); };
}
const closeDlg = () => $('#dlg').close();
let editing = null;

function taskForm(t, date) {
  const e = !!t; editing = t;
  t = t || { title: '', desc: '', date: date || today(), priority: 'media', category: '' };
  const days = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'].map((n, i) => `<label class="inl"><input type="checkbox" name="d${i}"> ${n}</label>`).join('');
  dlg(`<form><h2>${e ? 'Editar tarea' : 'Nueva tarea'}</h2>
  <label>Título<input name="title" required value="${esc(t.title)}"></label>
  <label>Descripción<textarea name="desc" rows="2">${esc(t.desc)}</textarea></label>
  <div class="row"><label>Fecha<input type="date" name="date" required value="${t.date}"></label>
  <label>Prioridad<select name="priority">${['baja', 'media', 'alta'].map(p => `<option ${p === t.priority ? 'selected' : ''}>${p}</option>`).join('')}</select></label></div>
  <label>Categoría<input name="category" list="cats" value="${esc(t.category)}"><datalist id="cats">${cats().map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
  ${e ? '' : `<details><summary>Repetir</summary><label>Frecuencia<select name="rep"><option value="">No repetir</option><option value="daily">Todos los días</option><option value="weekdays">De lunes a viernes</option><option value="days">Días de la semana elegidos</option><option value="weekly">Semanalmente</option><option value="monthly">Mensualmente</option><option value="interval">Cada N días</option></select></label>${days}<label>N (para “Cada N días”)<input type="number" name="n" min="1" value="2"></label></details>
  <label class="inl"><input type="checkbox" name="tofreq"> Guardar también en Frecuentes</label>`}
  <div class="row"><button class="btn">Guardar</button>${e ? '<button type="button" class="btn danger" data-act="deltask">Eliminar</button>' : ''}<button type="button" class="btn sec" data-act="close">Cancelar</button></div></form>`,
    async d => {
      const base = { title: d.title.trim(), desc: d.desc, date: d.date, priority: d.priority, category: d.category.trim() };
      if (e) { Object.assign(editing, base); await put('tasks', editing); }
      else {
        let fid;
        const ex = S.freq.find(f => norm(f.title) === norm(base.title));
        if (ex) fid = ex.id; else if (d.tofreq) { fid = uid(); await put('freq', { id: fid, title: base.title, fav: false, uses: 0 }); }
        if (d.rep) {
          const days = [0, 1, 2, 3, 4, 5, 6].filter(i => d['d' + i]);
          if (d.rep === 'days' && !days.length) return toast('Elige al menos un día');
          await put('routines', { id: uid(), title: base.title, type: d.rep, days, n: Math.max(1, +d.n || 1), start: base.date, priority: base.priority, category: base.category, freqId: fid, last: null });
          await load(); await generate();
        } else await put('tasks', newTask({ ...base, freqId: fid }));
      }
      closeDlg(); await load(); render(); toast('Guardado');
    });
}
function freqForm(f) {
  editing = f;
  dlg(`<form><h2>${f ? 'Editar frecuente' : 'Nueva tarea frecuente'}</h2><label>Título<input name="title" required value="${esc(f?.title || '')}"></label>
  <div class="row"><button class="btn">Guardar</button>${f ? '<button type="button" class="btn danger" data-act="delf">Eliminar</button>' : ''}<button type="button" class="btn sec" data-act="close">Cancelar</button></div>
  ${f ? '<small>Eliminarla de la biblioteca no borra su historial.</small>' : ''}</form>`, async d => {
    const title = d.title.trim(); if (!title) return;
    await put('freq', f ? { ...f, title } : { id: uid(), title, fav: false, uses: 0 });
    closeDlg(); await load(); render();
  });
}
async function addFromFreq(id, date) {
  const f = S.freq.find(x => x.id === id); if (!f) return;
  f.uses = (f.uses || 0) + 1; f.lastUsed = Date.now(); await put('freq', f);
  await put('tasks', newTask({ title: f.title, date, freqId: f.id, category: 'Frecuente' }));
}
async function addSelected() {
  const T = today();
  for (const v of UI.sel) {
    const i = v.indexOf(':'), ty = v.slice(0, i), id = v.slice(i + 1);
    if (ty === 'late') { const t = S.tasks.find(x => x.id === id); if (t) { t.origDate = t.origDate || t.date; t.date = T; await put('tasks', t); } }
    else if (ty === 'f') await addFromFreq(id, T);
    else { const h = history().find(x => x.key === id); if (h) await put('tasks', newTask({ title: h.title, date: T, freqId: h.fid })); }
  }
  UI.sel.clear(); await load(); toast('Agregadas a hoy'); go('dia');
}

/* ---------- copias de seguridad ---------- */
function exportData() {
  const data = { app: 'asistente-tareas', version: 1, exportedAt: new Date().toISOString(), stores: { tasks: S.tasks, freq: S.freq, routines: S.routines, meta: S.meta } };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  a.download = `asistente-copia-${today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function validate(d) {
  if (!d || d.app !== 'asistente-tareas' || typeof d.stores !== 'object') throw Error('El archivo no es una copia de seguridad de esta app.');
  for (const s of STORES) {
    const a = d.stores[s];
    if (!Array.isArray(a)) throw Error('Falta la sección ' + s);
    if (a.some(x => !x || typeof x.id !== 'string')) throw Error('Hay registros sin identificador en ' + s);
  }
  if (d.stores.tasks.some(t => typeof t.title !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(t.date))) throw Error('Hay tareas con datos inválidos.');
}
async function importData(file) {
  try {
    const d = JSON.parse(await file.text()); validate(d);
    const st = d.stores;
    if (!confirm(`Se reemplazarán TODOS los datos actuales por la copia: ${st.tasks.length} tareas, ${st.freq.length} frecuentes, ${st.routines.length} rutinas. ¿Continuar?`)) return;
    for (const s of STORES) { await tx(s, 'readwrite', o => o.clear()); await tx(s, 'readwrite', o => { st[s].forEach(x => o.put(x)); }); }
    await load(); render(); toast('Copia restaurada');
  } catch (e) { alert('No se pudo importar: ' + e.message); }
}

/* ---------- navegación y eventos ---------- */
function render() {
  $('#v').innerHTML = V[UI.view]();
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === UI.view));
}
function go(v) { UI.view = v; render(); scrollTo(0, 0); }

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, row = el.closest('[data-id]'), t = row && S.tasks.find(x => x.id === row.dataset.id);
  const frow = el.closest('[data-fid]'), f = frow && S.freq.find(x => x.id === frow.dataset.fid);
  const rf = async () => { await load(); render(); };
  switch (act) {
    case 'tab': return go(el.dataset.v);
    case 'set': UI[el.dataset.k] = el.dataset.v; return render();
    case 'new': return taskForm(null, el.dataset.d || today());
    case 'tog': if (t) { t.done = !t.done; t.doneAt = t.done ? new Date().toISOString() : null; await put('tasks', t); await rf(); } return;
    case 'edit': return t && taskForm(t);
    case 'deltask': if (editing && confirm('¿Eliminar esta tarea?')) { await del('tasks', editing.id); closeDlg(); await rf(); } return;
    case 'close': return closeDlg();
    case 'newfreq': return freqForm(null);
    case 'editf': return f && freqForm(f);
    case 'delf': if (editing && confirm('¿Quitar de la biblioteca?')) { await del('freq', editing.id); closeDlg(); await rf(); } return;
    case 'fav': if (f) { f.fav = !f.fav; await put('freq', f); await rf(); } return;
    case 'addf': if (f) { await addFromFreq(f.id, today()); await rf(); toast('Agregada a hoy'); } return;
    case 'calprev': case 'calnext': { const [y, m] = UI.calMonth.split('-').map(Number), d = new Date(y, m - 1 + (act === 'calnext' ? 1 : -1), 1); UI.calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; return render(); }
    case 'calday': UI.calDay = el.dataset.d; return render();
    case 'more': UI.more += 50; return render();
    case 'snooze': case 'discard': {
      const m = S.meta.find(x => x.id === 'dismiss') || { id: 'dismiss', map: {} };
      m.map[el.dataset.oid] = act === 'snooze' ? addDays(today(), 7) : '9999-12-31';
      await put('meta', m); return rf();
    }
    case 'addsel': return addSelected();
    case 'export': return exportData();
    case 'import': return $('#file').click();
    case 'persist': { const ok = navigator.storage?.persist ? await navigator.storage.persist() : false; return toast(ok ? 'Almacenamiento persistente activado' : 'El navegador no lo concedió'); }
    case 'delr': { const r = el.closest('[data-rid]'); if (r && confirm('¿Quitar la rutina? Las tareas ya generadas se conservan.')) { await del('routines', r.dataset.rid); await rf(); } }
  }
});
document.addEventListener('change', e => {
  const x = e.target;
  if (x.dataset.act === 'pick') { x.checked ? UI.sel.add(x.value) : UI.sel.delete(x.value); return render(); }
  if (x.dataset.f) { UI.filt[x.dataset.f] = x.type === 'checkbox' ? x.checked : x.value; UI.more = 50; render(); }
  if (x.dataset.p) { UI[x.dataset.p] = x.value; render(); }
});
$('#file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importData(f); });
document.addEventListener('visibilitychange', async () => { if (!document.hidden) { await generate(); render(); } });

(async () => {
  await openDB(); await load(); await generate(); render();
  navigator.storage?.persist?.();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
