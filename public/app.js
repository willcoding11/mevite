(() => {
'use strict';
const API = ((window.EVITE_CONFIG && window.EVITE_CONFIG.apiBase) || '').replace(/\/$/, '');
const KEY = 'mevite';
const app = document.getElementById('app');

// all text goes through text nodes (no HTML injection) and is shown lowercased
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid).toLowerCase()));
  return el;
}
const store = {
  get() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } },
  set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} },
};
const norm = (s) => s.trim().replace(/\s+/g, ' ').normalize('NFKC').toLowerCase();
const same = (a, b) => norm(a) === norm(b);
async function api(method, path, body) {
  const sb = window.EVITE_CONFIG.supabaseUrl;
  let res;
  try {
    if (sb) {
      const fn = path === '/api/event' ? 'get_event' : path === '/api/rsvps' ? 'list_rsvps' : 'put_rsvp';
      const key = window.EVITE_CONFIG.supabaseKey;
      res = await fetch(`${sb}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: key, ...(key.startsWith('eyJ') ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify(fn === 'put_rsvp' ? { p_name: body.name, p_response: body.response, p_note: body.note || '' } : {}) });
    } else res = await fetch(API + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  }
  catch { throw new Error('can’t reach the server. the internet is hard.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || (data.message && !data.code?.startsWith?.('PGRST') ? data.message : 'something broke'));
  return data;
}
function when(ev) {
  const parts = [];
  if (ev.date) {
    const d = new Date(ev.date + 'T12:00:00');
    if (!isNaN(d)) parts.push(d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }));
  }
  if (ev.start) parts.push(ev.end ? `${ev.start} - ${ev.end}` : ev.start);
  return parts;
}

let timer = null;
function mount(...n) { clearInterval(timer); app.replaceChildren(...n.filter(Boolean)); }

function skeleton() {
  const bar = (cls) => h('span', { class: 'sk ' + cls });
  mount(h('h1', {}, bar('sk-title')), h('div', { class: 'info' }, h('p', {}, bar('sk-line')), h('p', {}, bar('sk-addr'))));
}

function nameScreen(evP) {
  const input = h('input', { maxlength: 40, autocomplete: 'name', placeholder: 'your name', 'aria-label': 'your name' });
  mount(h('h1', {}, 'mevite lol'), h('p', { class: 'muted' }, 'you have been summoned.'),
    h('form', { onsubmit: (e) => {
      e.preventDefault();
      const name = input.value.trim().replace(/\s+/g, ' ');
      if (!name) return input.focus();
      store.set({ name }); skeleton(); evP.then((ev) => eventScreen(ev, { name }));
    } }, h('section', {}, input, h('button', { type: 'submit' }, 'continue'))));
  input.focus();
}

async function eventScreen(ev, me) {
  let lists = { going: [], notGoing: [] };
  let response = me.response || null, pending = null, note = '';
  const refresh = async () => {
    lists = await api('GET', '/api/rsvps');
    const all = [...lists.going.map((r) => ['going', r]), ...lists.notGoing.map((r) => ['not_going', r])];
    const mine = all.find(([, r]) => same(r.name, me.name));
    if (mine) { response = mine[0]; note = mine[1].note || ''; }
  };
  try { await refresh(); } catch {}

  const noteInput = h('textarea', { maxlength: 200, placeholder: 'why not? (optional)', 'aria-label': 'why not? (optional)' });
  noteInput.value = note;
  const err = h('p', { class: 'err' });
  const noteBox = h('div', { class: 'note', hidden: true }, noteInput, h('button', { type: 'button', onclick: () => send('not_going') }, 'send'));
  const yes = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => send('going') }, 'going');
  const no = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => { pending = 'not_going'; paint(); noteInput.focus(); } }, 'not going');
  const listBox = h('section', { class: 'lists' });

  let last = '';
  function paint() {
    const cur = pending || response;
    yes.setAttribute('aria-pressed', String(cur === 'going'));
    no.setAttribute('aria-pressed', String(cur === 'not_going'));
    noteBox.hidden = cur !== 'not_going';
    const sig = JSON.stringify([lists, !!response]);
    if (sig === last) return;
    last = sig;
    if (!response) return listBox.replaceChildren();
    const col = (title, arr, notes, empty) => h('div', {}, h('h2', {}, title, h('span', { class: 'count' }, String(arr.length))),
      arr.length
        ? h('ul', {}, arr.map((r) => h('li', {}, h('span', { class: 'nm' }, r.name,
            same(r.name, me.name) ? h('span', { class: 'you' }, 'you') : null),
            notes && r.note ? h('span', { class: 'why' }, r.note) : null)))
        : h('p', { class: 'muted' }, empty));
    listBox.replaceChildren(col('going', lists.going, false, 'nobody yet. awkward.'), col('not going', lists.notGoing, true, 'nobody yet. suspicious.'));
  }
  async function send(resp) {
    err.textContent = '';
    try {
      const r = await api('PUT', '/api/rsvp', { name: me.name, response: resp, note: resp === 'not_going' ? noteInput.value : '' });
      response = resp; pending = null; lists = { going: r.going, notGoing: r.notGoing };
      store.set({ name: me.name, response });
      paint();
    } catch (e) { err.textContent = e.message.toLowerCase(); }
  }

  mount(
    h('h1', {}, ev.title),
    h('div', { class: 'info' }, when(ev).map((x) => h('p', { class: 'big' }, x)),
      ev.address ? h('p', {}, h('a', { href: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ev.address), target: '_blank', rel: 'noopener noreferrer' }, ev.address)) : null),
    h('section', {}, h('p', {}, `hi ${me.name}. are you coming?`), h('div', { class: 'choice' }, yes, no), noteBox, err,
      h('button', { class: 'quiet small', type: 'button', onclick: () => { store.set({}); nameScreen(Promise.resolve(ev)); } }, `not ${me.name}?`)),
    listBox);
  paint();
  timer = setInterval(async () => { if (document.hidden) return; try { await refresh(); paint(); } catch {} }, 15000);
}

(async () => {
  mount(h('h1', {}, h('strong', {}, 'party canceled')), h('p', { class: 'muted' }, 'sorry. the party is off.'));
  return;
  const evP = (async () => {
    try { return window.EVITE_CONFIG.supabaseUrl ? await api('GET', '/api/event') : await (await fetch('event.json', { cache: 'no-cache' })).json(); }
    catch { return { title: 'Birthday Party' }; }
  })();
  const me = store.get();
  if (me.name) { skeleton(); eventScreen(await evP, me); } else nameScreen(evP);
})();
})();
