/**
 * Rezept-Planer — Browser-App von rana-frontend (Owner: Rana).
 *
 * Zwei Wege zum Wochenplan, beide nach den Kontrakten in shared/contracts:
 *  - synchron:  Browser ──HTTP + Bearer──▶ batu-api   (openapi.json)
 *  - asynchron: Browser ──HTTP──▶ rana-frontend ──AMQP──▶ recipe.requests ──▶ batu (asyncapi.yaml)
 *
 * Login ueber Keycloak (OIDC Authorization Code + PKCE, Client rana-web).
 * Jede Aktion bekommt eine eigene Correlation-ID (Header x-correlation-id);
 * unter "Vorgaenge" steht sie mit Link nach Jaeger.
 */
import Keycloak from '/vendor/keycloak/keycloak.js';

const CONFIG = window.RANA_CONFIG || {};
const BATU = (localStorage.getItem('rp_batu_url') || CONFIG.batuApiUrl || 'http://localhost:8080').replace(/\/+$/, '');
const JAEGER = (CONFIG.jaegerUiUrl || 'http://localhost:16686').replace(/\/+$/, '');

// ---------- Zustand ----------
const state = {
  excludeTags: [],
  excludeIngredients: [],
  catalog: [],
  orders: [],
  activity: [],
  shownOrder: null,
  pollTimer: null,
};
let keycloak = null;

// ---------- CSS ----------
const css = `
  :root{
    --paper:#e7dfc6; --paper-deep:#ddd3b4; --card:#fbf8ef;
    --ink:#26221b; --ink-soft:#57503f;
    --pine:#3b5744; --pine-deep:#2b4033;
    --saffron:#c1862b; --brick:#9c3b2e; --thread:#b9ac86; --sky:#3d5f7a;
    --shadow: 2px 3px 0 rgba(38,34,27,0.12); --radius:3px;
  }
  *{box-sizing:border-box;}
  body{margin:0;background:var(--paper);color:var(--ink);
    font-family:'Source Serif 4', Georgia, serif;line-height:1.5;}
  .mono{font-family:'JetBrains Mono', ui-monospace, monospace;}
  a{color:var(--sky);}
  :focus-visible{outline:3px solid var(--saffron);outline-offset:2px;}
  header.top{padding:1.8rem clamp(1.2rem,4vw,3.5rem) 1.2rem;border-bottom:1px solid var(--thread);}
  .top-row{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;}
  .brand{display:flex;align-items:baseline;gap:.9rem;flex-wrap:wrap;}
  .brand h1{font-family:'Fraunces',serif;font-weight:600;font-size:clamp(2.1rem,4vw,3rem);margin:0;}
  .brand .kicker{font-family:'Fraunces',serif;font-style:italic;color:var(--pine-deep);font-size:1.1rem;}
  .user{display:flex;align-items:center;gap:.6rem;font-size:.9rem;}
  .top p.lede{max-width:70ch;margin:.5rem 0 0;color:var(--ink-soft);}
  .status-bar{margin-top:1rem;display:flex;gap:.5rem;flex-wrap:wrap;font-size:.8rem;}
  .pill{display:inline-flex;align-items:center;gap:.4rem;background:var(--card);border:1px solid var(--thread);
    border-radius:20px;padding:.2rem .7rem;font-family:'JetBrains Mono',monospace;}
  .dot{width:9px;height:9px;border-radius:50%;background:var(--thread);display:inline-block;}
  .dot.ok{background:var(--pine);} .dot.warn{background:var(--saffron);} .dot.bad{background:var(--brick);}
  main{display:grid;grid-template-columns:340px 1fr;}
  @media (max-width:900px){main{grid-template-columns:1fr;}}
  .ticket-rail{padding:2rem clamp(1rem,3vw,2rem);border-right:1px solid var(--thread);position:sticky;top:0;align-self:start;}
  @media (max-width:900px){.ticket-rail{position:static;border-right:none;border-bottom:1px solid var(--thread);}}
  .content{padding:2rem clamp(1rem,3vw,3rem) 4rem;min-width:0;}
  .ticket{background:var(--card);border:1px solid var(--thread);border-radius:var(--radius);
    box-shadow:var(--shadow);padding:1.5rem 1.4rem 1.6rem;}
  .ticket h2{font-family:'Fraunces',serif;font-weight:600;font-size:1.3rem;margin:0 0 1.1rem;}
  .field{margin-bottom:1rem;}
  .field label{display:block;font-size:.78rem;color:var(--ink-soft);margin-bottom:.3rem;}
  .field input{width:100%;font-family:'JetBrains Mono',monospace;font-size:.92rem;padding:.5rem .6rem;
    border:1px solid var(--thread);border-radius:var(--radius);background:#fff;color:var(--ink);}
  .row-2{display:grid;grid-template-columns:1fr 1fr;gap:.7rem;}
  .chips{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.4rem;}
  .chip{display:inline-flex;align-items:center;gap:.35rem;background:var(--paper-deep);
    border:1px solid var(--thread);border-radius:20px;padding:.15rem .6rem .15rem .7rem;
    font-size:.78rem;font-family:'JetBrains Mono',monospace;}
  .chip button{background:none;border:none;cursor:pointer;color:var(--brick);font-size:.85rem;padding:0;}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;background:var(--pine);
    color:var(--card);border:1px solid var(--pine-deep);border-radius:var(--radius);padding:.65rem 1.1rem;
    font-size:.95rem;font-weight:600;cursor:pointer;box-shadow:var(--shadow);font-family:inherit;}
  .btn.queue{background:var(--sky);border-color:#2c4559;}
  .btn.ghost{background:transparent;color:var(--pine-deep);box-shadow:none;border:1px dashed var(--thread);}
  .btn.small{padding:.4rem .75rem;font-size:.82rem;}
  .btn[disabled]{opacity:.55;cursor:progress;}
  .btn-stack{display:grid;gap:.6rem;}
  .btn-stack small{display:block;font-weight:400;font-size:.72rem;opacity:.85;}
  .field-note{font-size:.75rem;color:var(--ink-soft);margin-top:.3rem;}
  section{margin-bottom:3rem;}
  .section-head{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;margin-bottom:1.1rem;flex-wrap:wrap;}
  .section-head h2{font-family:'Fraunces',serif;font-weight:600;font-size:1.55rem;margin:0;}
  .section-head .sub{color:var(--ink-soft);font-size:.9rem;}
  .empty{border:1px dashed var(--thread);border-radius:var(--radius);padding:1.6rem 1.4rem;color:var(--ink-soft);}
  .empty strong{color:var(--ink);font-family:'Fraunces',serif;font-weight:600;display:block;margin-bottom:.3rem;font-size:1.1rem;}
  .week-strip{display:flex;overflow-x:auto;padding:1.4rem .6rem 2rem;margin:0 -.6rem;}
  .day-card{flex:0 0 190px;background:var(--card);border:1px solid var(--thread);border-radius:var(--radius);
    box-shadow:var(--shadow);padding:1rem 1rem 1.1rem;margin:0 .5rem;}
  .day-card:nth-child(odd){transform:rotate(-.6deg);}
  .day-card:nth-child(even){transform:rotate(.5deg);}
  .day-card .day-label{font-family:'JetBrains Mono',monospace;font-size:.72rem;color:var(--saffron);
    display:block;margin-bottom:.5rem;border-bottom:1px solid var(--thread);padding-bottom:.4rem;}
  .day-card .meal-name{font-family:'Fraunces',serif;font-weight:600;font-size:1.05rem;margin:0 0 .5rem;}
  .meal-tags{display:flex;flex-wrap:wrap;gap:.3rem;}
  .tag{font-family:'JetBrains Mono',monospace;font-size:.68rem;color:var(--pine-deep);
    background:rgba(59,87,68,.09);border-radius:10px;padding:.12rem .5rem;}
  .plan-meta{display:flex;align-items:center;gap:.9rem;flex-wrap:wrap;font-size:.85rem;color:var(--ink-soft);margin-bottom:.4rem;}
  .plan-meta .id{font-family:'JetBrains Mono',monospace;background:var(--paper-deep);padding:.15rem .5rem;
    border-radius:3px;font-size:.78rem;cursor:pointer;border:1px solid var(--thread);}
  .receipt{background:var(--card);border:1px solid var(--thread);border-radius:var(--radius);
    box-shadow:var(--shadow);padding:1.3rem 1.4rem 1.5rem;max-width:460px;}
  .receipt h3{font-family:'Fraunces',serif;font-weight:600;font-size:1.1rem;margin:0 0 .9rem;
    border-bottom:1px dashed var(--thread);padding-bottom:.6rem;}
  .receipt ul{list-style:none;margin:0;padding:0;}
  .receipt li{display:flex;justify-content:space-between;gap:1rem;padding:.32rem 0;font-size:.92rem;
    border-bottom:1px dotted var(--thread);}
  .receipt li:last-child{border-bottom:none;}
  .receipt .amt{font-family:'JetBrains Mono',monospace;color:var(--ink-soft);white-space:nowrap;}
  details.raw{margin-top:1.4rem;font-size:.82rem;color:var(--ink-soft);}
  details.raw pre{background:var(--ink);color:var(--paper);padding:1rem;border-radius:var(--radius);
    overflow:auto;font-family:'JetBrains Mono',monospace;font-size:.78rem;max-height:320px;}
  .lookup{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1rem;}
  .search{font-family:'JetBrains Mono',monospace;padding:.5rem .7rem;border:1px solid var(--thread);
    border-radius:var(--radius);background:#fff;min-width:220px;font-size:.88rem;}
  .catalog-head{display:flex;gap:.8rem;align-items:center;flex-wrap:wrap;margin-bottom:1.2rem;}
  .catalog-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:.9rem;}
  .recipe-card{background:var(--card);border:1px solid var(--thread);border-radius:var(--radius);
    padding:1rem 1.1rem 1.1rem;box-shadow:var(--shadow);}
  .recipe-card h4{font-family:'Fraunces',serif;font-weight:600;font-size:1.05rem;margin:0 0 .35rem;}
  .recipe-card .servings{font-family:'JetBrains Mono',monospace;font-size:.75rem;color:var(--ink-soft);
    margin-bottom:.5rem;display:block;}
  .recipe-card .ing-list{font-size:.85rem;color:var(--ink-soft);margin:0;padding-left:1.1rem;}
  .new-recipe{margin-top:2rem;}
  .new-recipe form{background:var(--card);border:1px solid var(--thread);border-radius:var(--radius);
    box-shadow:var(--shadow);padding:1.4rem 1.4rem 1.6rem;max-width:560px;}
  .ing-row{display:grid;grid-template-columns:1fr 90px 90px auto;gap:.5rem;margin-bottom:.5rem;}
  .ing-row input{font-family:'JetBrains Mono',monospace;font-size:.85rem;padding:.4rem .5rem;
    border:1px solid var(--thread);border-radius:var(--radius);min-width:0;}
  .ing-row button{background:none;border:1px dashed var(--thread);border-radius:var(--radius);
    color:var(--brick);cursor:pointer;font-size:.85rem;}
  table.list{width:100%;border-collapse:collapse;font-size:.85rem;background:var(--card);
    border:1px solid var(--thread);box-shadow:var(--shadow);}
  table.list th{text-align:left;font-weight:600;font-size:.75rem;color:var(--ink-soft);padding:.5rem .7rem;
    border-bottom:1px solid var(--thread);background:var(--paper-deep);}
  table.list td{padding:.45rem .7rem;border-bottom:1px dotted var(--thread);vertical-align:top;}
  table.list tr:last-child td{border-bottom:none;}
  .table-wrap{overflow-x:auto;}
  .badge{font-family:'JetBrains Mono',monospace;font-size:.72rem;border-radius:10px;padding:.1rem .55rem;
    white-space:nowrap;border:1px solid transparent;}
  .badge.sending,.badge.queued{background:rgba(193,134,43,.15);color:#7a5418;border-color:rgba(193,134,43,.4);}
  .badge.done,.badge.ok{background:rgba(59,87,68,.12);color:var(--pine-deep);border-color:rgba(59,87,68,.35);}
  .badge.failed,.badge.send_failed,.badge.error{background:rgba(156,59,46,.12);color:var(--brick);border-color:rgba(156,59,46,.35);}
  .badge.queued::before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;
    background:var(--saffron);margin-right:.35rem;animation:pulse 1s infinite alternate;}
  @keyframes pulse{from{opacity:.25}to{opacity:1}}
  .cid{font-family:'JetBrains Mono',monospace;font-size:.72rem;color:var(--ink-soft);}
  .linkbtn{background:none;border:none;color:var(--sky);cursor:pointer;text-decoration:underline;padding:0;font:inherit;}
  #toast{position:fixed;bottom:1.3rem;left:50%;transform:translateX(-50%);background:var(--ink);
    color:var(--paper);padding:.75rem 1.2rem;border-radius:var(--radius);font-size:.88rem;
    box-shadow:0 6px 18px rgba(0,0,0,.25);opacity:0;pointer-events:none;transition:opacity .2s ease;z-index:50;max-width:80vw;}
  #toast.show{opacity:1;}
  #toast.error{background:var(--brick);}
  .fatal{max-width:560px;margin:15vh auto;padding:2rem;background:var(--card);border:1px solid var(--thread);box-shadow:var(--shadow);}
  @media (prefers-reduced-motion: reduce){.btn,#toast{transition:none;}.badge.queued::before{animation:none;}}
`;

function injectStyles() {
  const fonts = document.createElement('link');
  fonts.rel = 'stylesheet';
  fonts.href = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,500&family=Source+Serif+4:ital,wght@0,400;0,600;1,400&family=JetBrains+Mono:wght@400;600&display=swap';
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(fonts, style);
}

// ---------- kleine DOM-Hilfe ----------
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
}

const $ = (id) => document.getElementById(id);

// ---------- Toast ----------
let toastTimer = null;
function toast(msg, isError) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
}

// ---------- Vorgaenge (Correlation-IDs) ----------
function jaegerSearchUrl(service, correlationId) {
  const tags = encodeURIComponent(JSON.stringify({ correlation_id: correlationId }));
  return `${JAEGER}/search?service=${encodeURIComponent(service)}&tags=${tags}&lookback=1h`;
}

function jaegerLink(entry) {
  if (entry.traceId) return h('a', { href: `${JAEGER}/trace/${entry.traceId}`, target: '_blank', rel: 'noopener' }, 'Trace');
  return h('a', { href: jaegerSearchUrl(entry.service, entry.correlationId), target: '_blank', rel: 'noopener' }, 'Jaeger');
}

function recordActivity(entry) {
  state.activity.unshift({ time: new Date(), ...entry });
  state.activity.length = Math.min(state.activity.length, 12);
  renderActivity();
}

function renderActivity() {
  const wrap = $('activity');
  wrap.replaceChildren();
  if (!state.activity.length) {
    wrap.append(h('div', { class: 'empty' }, 'Noch keine Vorgaenge. Jede Aktion bekommt eine eigene Correlation-ID, die in allen Services in den Logs und in Jaeger auftaucht.'));
    return;
  }
  wrap.append(h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Zeit'), h('th', {}, 'Aktion'), h('th', {}, 'Weg'), h('th', {}, 'Ergebnis'), h('th', {}, 'Correlation-ID'), h('th', {}, ''))),
    h('tbody', {}, state.activity.map((a) => h('tr', {},
      h('td', { class: 'mono' }, a.time.toLocaleTimeString('de-CH')),
      h('td', {}, a.action),
      h('td', { class: 'mono' }, a.via),
      h('td', {}, h('span', { class: `badge ${a.ok ? 'ok' : 'error'}` }, a.result)),
      h('td', {}, h('span', { class: 'cid', title: 'Fuer scripts/demo/logs.sh <id>' }, a.correlationId)),
      h('td', {}, jaegerLink(a)),
    ))),
  )));
}

// ---------- HTTP ----------
class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/**
 * fetch mit Token, neuer Correlation-ID und einheitlicher Fehlerbehandlung.
 * Bei 401 einmal Token erneuern und wiederholen, sonst neu einloggen.
 */
async function call(base, path, { method = 'GET', body, action, via, service, retried = false } = {}) {
  const correlationId = crypto.randomUUID();
  try {
    await keycloak.updateToken(30);
  } catch {
    keycloak.login();
    throw new ApiError('Sitzung abgelaufen, bitte neu anmelden.', 401);
  }
  const headers = { authorization: `Bearer ${keycloak.token}`, 'x-correlation-id': correlationId };
  if (body !== undefined) headers['content-type'] = 'application/json';

  let res;
  try {
    res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    const msg = `${service} nicht erreichbar (${base}).`;
    recordActivity({ action, via, service, correlationId, ok: false, result: 'nicht erreichbar' });
    throw new ApiError(msg, 0);
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (res.status === 401 && !retried) {
    await keycloak.updateToken(-1).catch(() => keycloak.login());
    return call(base, path, { method, body, action, via, service, retried: true });
  }
  if (action) {
    recordActivity({
      action, via, service, correlationId: res.headers.get('x-correlation-id') || correlationId,
      ok: res.ok, result: `${res.status}`,
    });
  }
  if (!res.ok && res.status !== 503) {
    throw new ApiError((data && data.error) || `HTTP ${res.status}`, res.status, data);
  }
  return { status: res.status, data, correlationId };
}

const batu = (path, opts = {}) => call(BATU, path, { via: 'HTTP → batu-api', service: 'batu-api', ...opts });
const rana = (path, opts = {}) => call('', path, { via: 'HTTP → rana → AMQP', service: 'rana-frontend', ...opts });

// ---------- Status-Leiste ----------
async function checkHealth() {
  const set = (id, cls, text) => {
    const pill = $(id);
    pill.querySelector('.dot').className = `dot ${cls}`;
    pill.querySelector('.txt').textContent = text;
  };
  let status;
  try {
    const res = await fetch('/status', { cache: 'no-store' });
    status = res.ok ? await res.json() : null;
  } catch {
    status = null;
  }
  if (!status) {
    set('st-rana', 'bad', 'rana-frontend: down');
    set('st-batu', 'bad', 'batu-api: ?');
    set('st-mq', 'bad', 'RabbitMQ: ?');
    return;
  }
  set('st-rana', 'ok', 'rana-frontend: up');
  const batuStatus = status.batu.status;
  set('st-batu', batuStatus === 'ok' ? 'ok' : batuStatus === 'down' ? 'bad' : 'warn', `batu-api: ${batuStatus}`);
  const q = status.queue;
  const queueText = q ? ` · ${q.waiting} wartend · ${q.consumers} Consumer` : '';
  set('st-mq', status.amqp !== 'up' ? 'bad' : q && q.consumers === 0 ? 'warn' : 'ok', `RabbitMQ: ${status.amqp}${queueText}`);
}

// ---------- Layout ----------
function chipInput({ id, list, placeholder, label, note }) {
  const input = h('input', { type: 'text', id, placeholder });
  const chips = h('div', { class: 'chips', id: `${id}Chips` });
  const render = () => {
    chips.replaceChildren(...list.map((val, i) => h('span', { class: 'chip' }, h('span', {}, val),
      h('button', { type: 'button', 'aria-label': `${val} entfernen`, onclick: () => { list.splice(i, 1); render(); } }, '×'))));
  };
  const add = () => {
    const v = input.value.trim();
    if (v && !list.includes(v)) { list.push(v); render(); }
    input.value = '';
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
  });
  input.addEventListener('blur', add);
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, chips, note ? h('p', { class: 'field-note' }, note) : null);
}

function buildLayout() {
  const user = keycloak.tokenParsed || {};
  const pill = (id, text) => h('span', { class: 'pill', id }, h('span', { class: 'dot' }), h('span', { class: 'txt' }, text));

  const header = h('header', { class: 'top' },
    h('div', { class: 'top-row' },
      h('div', { class: 'brand' }, h('h1', {}, 'Rezept-Planer'), h('span', { class: 'kicker' }, 'für die Woche gedacht')),
      h('div', { class: 'user' },
        h('span', {}, 'Angemeldet als ', h('strong', {}, user.preferred_username || user.sub || '?')),
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => keycloak.logout({ redirectUri: window.location.origin }) }, 'Abmelden')),
    ),
    h('p', { class: 'lede' }, 'Wochenplan aus dem Katalog der batu-api erstellen: sofort per HTTP oder entkoppelt über die Queue. Ist der Planer gerade weg, wartet die Bestellung in RabbitMQ und wird nachgeholt.'),
    h('div', { class: 'status-bar' },
      pill('st-batu', 'batu-api: …'), pill('st-rana', 'rana-frontend: …'), pill('st-mq', 'RabbitMQ: …'),
      h('span', { class: 'pill' }, h('span', { class: 'dot ok' }), 'Keycloak: angemeldet'),
      h('a', { class: 'pill', href: JAEGER, target: '_blank', rel: 'noopener' }, 'Jaeger ↗'),
    ),
  );

  // -- Plan-Formular --
  const planForm = h('form', { id: 'planForm' },
    h('div', { class: 'row-2' },
      h('div', { class: 'field' }, h('label', { for: 'days' }, 'Tage'), h('input', { type: 'number', id: 'days', min: '1', max: '31', value: '5', required: true })),
      h('div', { class: 'field' }, h('label', { for: 'servings' }, 'Portionen'), h('input', { type: 'number', id: 'servings', min: '1', max: '100', value: '2', required: true })),
    ),
    h('div', { class: 'field' }, h('label', { for: 'startDate' }, 'Startdatum (optional)'), h('input', { type: 'date', id: 'startDate' })),
    chipInput({ id: 'exTags', list: state.excludeTags, label: 'Ohne Tags', placeholder: 'z. B. fleisch – Enter', note: null }),
    chipInput({ id: 'exIngr', list: state.excludeIngredients, label: 'Ohne Zutaten', placeholder: 'z. B. Erdnuss – Enter', note: 'Wird als exclusions {tags, ingredients} gesendet (Vertrag 1.1+).' }),
    h('div', { class: 'btn-stack' },
      h('button', { class: 'btn', type: 'submit', id: 'btnSync', value: 'sync' }, h('span', {}, 'Sofort planen', h('small', {}, 'synchron · HTTP → batu-api'))),
      h('button', { class: 'btn queue', type: 'submit', id: 'btnQueue', value: 'queue' }, h('span', {}, 'Über Queue bestellen', h('small', {}, 'asynchron · rana → RabbitMQ → batu'))),
    ),
  );
  planForm.addEventListener('submit', onSubmitPlan);

  const rail = h('div', { class: 'ticket-rail' }, h('div', { class: 'ticket' }, h('h2', {}, 'Wochenplan bauen'), planForm));

  // -- Inhalt --
  const ordersSection = h('section', { id: 'ordersSection' },
    h('div', { class: 'section-head' }, h('h2', {}, 'Bestellungen über die Queue'), h('span', { class: 'sub', id: 'ordersSub' })),
    h('div', { id: 'orders' }));

  const planSection = h('section', { id: 'planSection' },
    h('div', { class: 'section-head' }, h('h2', {}, 'Wochenplan'), h('span', { class: 'sub', id: 'planSub' })),
    h('form', { class: 'lookup', id: 'lookupForm' },
      h('input', { class: 'search', id: 'planId', placeholder: 'Plan-ID (UUID) laden …', 'aria-label': 'Plan-ID' }),
      h('button', { class: 'btn ghost small', type: 'submit' }, 'Bei batu-api abrufen')),
    h('div', { id: 'planOutput' }, h('div', { class: 'empty' }, h('strong', {}, 'Noch kein Plan.'), 'Links planen oder bestellen. Der Plan erscheint hier mit Einkaufsliste.')));
  planSection.querySelector('#lookupForm').addEventListener('submit', onLookupPlan);

  const newRecipeWrap = h('div', { class: 'new-recipe', id: 'newRecipeWrap', hidden: true });
  buildRecipeForm(newRecipeWrap);
  const catalogSearch = h('input', { type: 'text', class: 'search', id: 'catalogSearch', placeholder: 'Katalog durchsuchen…' });
  catalogSearch.addEventListener('input', () => renderCatalog());
  const catalogSection = h('section', { id: 'catalogSection' },
    h('div', { class: 'section-head' }, h('h2', {}, 'Rezept-Katalog'), h('span', { class: 'sub', id: 'catalogSub' })),
    h('div', { class: 'catalog-head' }, catalogSearch,
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => toggleRecipeForm(newRecipeWrap) }, '+ Rezept hinzufügen'),
      h('button', { class: 'btn ghost small', type: 'button', onclick: loadCatalog }, 'Neu laden')),
    newRecipeWrap,
    h('div', { class: 'catalog-grid', id: 'catalogGrid' }));

  const activitySection = h('section', { id: 'activitySection' },
    h('div', { class: 'section-head' }, h('h2', {}, 'Vorgänge'), h('span', { class: 'sub' }, 'Correlation-IDs dieser Sitzung')),
    h('div', { id: 'activity' }));

  const content = h('div', { class: 'content' }, ordersSection, planSection, catalogSection, activitySection);
  $('app').replaceChildren(header, h('main', {}, rail, content), h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }));
}

function toggleRecipeForm(wrap) {
  wrap.hidden = !wrap.hidden;
  const rows = $('ingRows');
  if (!wrap.hidden && !rows.children.length) addIngRow(rows);
}

function buildRecipeForm(wrap) {
  const ingRows = h('div', { id: 'ingRows' });
  const form = h('form', { id: 'recipeForm' },
    h('div', { class: 'field' }, h('label', { for: 'rName' }, 'Name'), h('input', { type: 'text', id: 'rName', required: true, maxlength: '120' })),
    h('div', { class: 'row-2' },
      h('div', { class: 'field' }, h('label', { for: 'rServings' }, 'Portionen'), h('input', { type: 'number', id: 'rServings', min: '1', value: '2', required: true })),
      h('div', { class: 'field' }, h('label', { for: 'rTags' }, 'Tags (Komma-getrennt)'), h('input', { type: 'text', id: 'rTags', placeholder: 'vegan, schnell' }))),
    h('div', { class: 'field' }, h('label', {}, 'Zutaten'), ingRows,
      h('button', { type: 'button', class: 'btn ghost small', onclick: () => addIngRow(ingRows) }, '+ Zutat')),
    h('div', { style: 'margin-top:1rem;display:flex;gap:.6rem;' },
      h('button', { class: 'btn', type: 'submit', id: 'btnSaveRecipe' }, 'Rezept speichern'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { wrap.hidden = true; } }, 'Abbrechen')));
  form.addEventListener('submit', onSubmitRecipe);
  wrap.append(h('div', { class: 'section-head' }, h('h2', { style: 'font-size:1.2rem;' }, 'Neues Rezept')), form);
}

function addIngRow(container) {
  const row = h('div', { class: 'ing-row' },
    h('input', { type: 'text', placeholder: 'Zutat', class: 'ing-name', 'aria-label': 'Zutat' }),
    h('input', { type: 'number', placeholder: 'Menge', class: 'ing-amount', min: '0', step: 'any', 'aria-label': 'Menge' }),
    h('input', { type: 'text', placeholder: 'Einheit', class: 'ing-unit', 'aria-label': 'Einheit' }));
  row.append(h('button', { type: 'button', 'aria-label': 'Zutat entfernen', onclick: () => row.remove() }, '×'));
  container.appendChild(row);
}

// ---------- Plan: synchron oder ueber die Queue ----------
function planRequest() {
  const body = {
    days: parseInt($('days').value, 10),
    servings: parseInt($('servings').value, 10),
    exclusions: { tags: state.excludeTags.slice(), ingredients: state.excludeIngredients.slice() },
  };
  const startDate = $('startDate').value;
  if (startDate) body.start_date = startDate;
  return body;
}

async function onSubmitPlan(e) {
  e.preventDefault();
  const mode = e.submitter && e.submitter.value === 'queue' ? 'queue' : 'sync';
  const btn = e.submitter || $('btnSync');
  btn.disabled = true;
  try {
    if (mode === 'sync') {
      const { data } = await batu('/plans', { method: 'POST', body: planRequest(), action: 'Plan erstellen' });
      renderPlan(data, 'synchron von batu-api');
      toast('Plan erstellt.');
    } else {
      await placeOrder({ request_id: crypto.randomUUID(), ...planRequest() });
    }
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
}

/**
 * Bestellung an rana. Die request_id entsteht hier im Browser: Ein erneutes
 * Senden (Button "erneut senden") ist so derselbe Auftrag, kein zweiter Plan.
 */
async function placeOrder(body) {
  const { status, data } = await rana('/api/orders', { method: 'POST', body, action: 'Plan bestellen' });
  upsertOrder(data, body);
  if (status === 503) {
    toast(`${data.error} Bestellung kann gleich erneut gesendet werden.`, true);
  } else {
    toast('Bestellung liegt in der Queue.');
  }
  schedulePoll(500);
}

function upsertOrder(order, body) {
  if (body) order.retryBody = body;
  const i = state.orders.findIndex((o) => o.request_id === order.request_id);
  if (i >= 0) state.orders[i] = { ...state.orders[i], ...order };
  else state.orders.unshift(order);
  renderOrders();
}

async function refreshOrders() {
  try {
    const { data } = await rana('/api/orders');
    const before = new Map(state.orders.map((o) => [o.request_id, o]));
    state.orders = data.map((o) => ({ retryBody: before.get(o.request_id)?.retryBody, ...o }));
    for (const o of data) {
      const old = before.get(o.request_id);
      if (old && old.status !== o.status && (o.status === 'done' || o.status === 'failed')) {
        toast(o.status === 'done' ? 'Bestellter Plan ist fertig.' : `Bestellung fehlgeschlagen: ${o.error}`, o.status !== 'done');
        if (o.status === 'done') renderPlan(o.plan, `über die Queue, bearbeitet von ${describeInstance(o.processed_by)}`);
      }
    }
    renderOrders();
  } catch {
    // rana gerade nicht erreichbar -- die Status-Leiste zeigt das an.
  }
}

function schedulePoll(delay) {
  clearTimeout(state.pollTimer);
  state.pollTimer = setTimeout(async () => {
    await refreshOrders();
    const pending = state.orders.some((o) => o.status === 'sending' || o.status === 'queued');
    if (pending) schedulePoll(1500);
  }, delay);
}

const STATUS_TEXT = {
  sending: 'wird gesendet',
  queued: 'wartet in Queue',
  done: 'fertig',
  failed: 'abgelehnt',
  send_failed: 'nicht gesendet',
};

function describeInstance(p) {
  if (!p) return '–';
  return `${p.service || '?'} ${p.version || ''} @ ${(p.instance || '').slice(0, 12)}`.trim();
}

function renderOrders() {
  const wrap = $('orders');
  const pending = state.orders.filter((o) => o.status === 'queued' || o.status === 'sending').length;
  $('ordersSub').textContent = state.orders.length ? `${state.orders.length} Bestellung(en), ${pending} offen` : '';
  wrap.replaceChildren();
  if (!state.orders.length) {
    wrap.append(h('div', { class: 'empty' }, h('strong', {}, 'Noch keine Bestellung.'),
      '„Über Queue bestellen“ legt einen Auftrag in RabbitMQ. Er wird auch dann angenommen, wenn die batu-api gerade gestoppt ist, und abgearbeitet, sobald sie wieder läuft.'));
    return;
  }
  wrap.append(h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Bestellt'), h('th', {}, 'Auftrag'), h('th', {}, 'Status'), h('th', {}, 'Bearbeitet von'), h('th', {}, 'Correlation-ID'), h('th', {}, ''))),
    h('tbody', {}, state.orders.map((o) => {
      const req = o.request || o.retryBody || {};
      const actions = [];
      if (o.status === 'done') actions.push(h('button', { class: 'linkbtn', type: 'button', onclick: () => renderPlan(o.plan, `über die Queue, bearbeitet von ${describeInstance(o.processed_by)}`) }, 'anzeigen'));
      if (o.status === 'send_failed' && o.retryBody) actions.push(h('button', { class: 'linkbtn', type: 'button', onclick: () => placeOrder(o.retryBody).catch((err) => toast(err.message, true)) }, 'erneut senden'));
      actions.push(' ', jaegerLink({ traceId: o.trace_id, service: 'rana-frontend', correlationId: o.correlation_id }));
      return h('tr', {},
        h('td', { class: 'mono' }, new Date(o.created_at || Date.now()).toLocaleTimeString('de-CH')),
        h('td', {}, `${req.days ?? '?'} Tage · ${req.servings ?? '?'} Port.`),
        h('td', {}, h('span', { class: `badge ${o.status}`, title: o.error || '' }, STATUS_TEXT[o.status] || o.status)),
        h('td', { class: 'mono', style: 'font-size:.75rem' }, describeInstance(o.processed_by)),
        h('td', {}, h('span', { class: 'cid' }, o.correlation_id || '–')),
        h('td', {}, actions));
    })),
  )));
}

async function onLookupPlan(e) {
  e.preventDefault();
  const id = $('planId').value.trim();
  if (!id) return;
  try {
    const { data } = await batu(`/plans/${encodeURIComponent(id)}`, { action: 'Plan abrufen' });
    renderPlan(data, 'gespeichert in batu-api');
  } catch (err) {
    toast(err.status === 404 ? 'Kein Plan mit dieser ID.' : err.message, true);
  }
}

/**
 * Plan nach OpenAPI-Schema `Plan` anzeigen: `days` ist eine Liste von
 * {date, recipe}. Tolerant Reader: unbekannte Felder werden ignoriert,
 * fehlende optionale Felder einfach nicht angezeigt.
 */
function renderPlan(plan, source) {
  const out = $('planOutput');
  out.replaceChildren();
  if (!plan) return;

  const days = Array.isArray(plan.days) ? plan.days : [];
  const exclusions = plan.exclusions || {};
  const excluded = [...(exclusions.tags || []), ...(exclusions.ingredients || [])];
  $('planSub').textContent = [`${days.length} Tage`, plan.servings ? `${plan.servings} Portionen` : null, source].filter(Boolean).join(' · ');

  if (plan.id) {
    const idSpan = h('span', { class: 'id', title: 'Kopieren' }, String(plan.id));
    idSpan.addEventListener('click', () => { navigator.clipboard?.writeText(String(plan.id)); toast('Plan-ID kopiert.'); });
    out.append(h('div', { class: 'plan-meta' }, h('span', {}, 'Plan-ID'), idSpan,
      excluded.length ? h('span', {}, `ohne: ${excluded.join(', ')}`) : null));
  }

  if (days.length) {
    out.append(h('div', { class: 'week-strip' }, days.map((day, i) => {
      const recipe = day.recipe || {};
      const date = day.date ? new Date(`${day.date}T00:00:00Z`) : null;
      const label = date && !Number.isNaN(date.getTime())
        ? date.toLocaleDateString('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' })
        : `Tag ${i + 1}`;
      return h('div', { class: 'day-card' },
        h('span', { class: 'day-label' }, label),
        h('p', { class: 'meal-name' }, recipe.name || 'Ohne Namen'),
        h('div', { class: 'meal-tags' }, (recipe.tags || []).map((t) => h('span', { class: 'tag' }, t))));
    })));
  }

  const shopping = Array.isArray(plan.shopping_list) ? plan.shopping_list : [];
  if (shopping.length) {
    out.append(h('div', { class: 'receipt' }, h('h3', {}, 'Einkaufsliste'),
      h('ul', {}, shopping.map((item) => h('li', {}, h('span', {}, item.name),
        h('span', { class: 'amt' }, `${Math.round((item.amount ?? 0) * 100) / 100} ${item.unit || ''}`.trim()))))));
  }

  out.append(h('details', { class: 'raw' }, h('summary', {}, 'Rohdaten (JSON laut Kontrakt)'), h('pre', {}, JSON.stringify(plan, null, 2))));
  $('planSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- Katalog ----------
async function loadCatalog() {
  const sub = $('catalogSub');
  sub.textContent = 'lädt …';
  try {
    const { data } = await batu('/recipes', { action: 'Katalog laden' });
    state.catalog = Array.isArray(data) ? data : [];
    sub.textContent = `${state.catalog.length} Rezept${state.catalog.length === 1 ? '' : 'e'} aus batu-api`;
    renderCatalog();
  } catch (err) {
    sub.textContent = '';
    $('catalogGrid').replaceChildren(h('div', { class: 'empty' }, h('strong', {}, 'Katalog nicht erreichbar.'), err.message,
      ' Bestellungen über die Queue funktionieren trotzdem.'));
  }
}

function renderCatalog() {
  const q = ($('catalogSearch').value || '').trim().toLowerCase();
  const list = !q ? state.catalog : state.catalog.filter((r) =>
    (r.name || '').toLowerCase().includes(q) || (r.tags || []).join(' ').toLowerCase().includes(q));
  const grid = $('catalogGrid');
  grid.replaceChildren();
  if (!list.length) {
    grid.append(h('div', { class: 'empty' }, h('strong', {}, q ? 'Kein Treffer.' : 'Katalog ist leer.'), q ? '' : 'Mit „+ Rezept hinzufügen“ eins anlegen.'));
    return;
  }
  for (const r of list) {
    const ingredients = r.ingredients || [];
    grid.append(h('div', { class: 'recipe-card' },
      h('h4', {}, r.name || 'Ohne Namen'),
      r.servings ? h('span', { class: 'servings' }, `${r.servings} Portionen`) : null,
      (r.tags || []).length ? h('div', { class: 'meal-tags', style: 'margin-bottom:.5rem;' }, r.tags.map((t) => h('span', { class: 'tag' }, t))) : null,
      ingredients.length ? h('ul', { class: 'ing-list' }, ingredients.slice(0, 6).map((ing) =>
        h('li', {}, `${ing.name}${ing.amount !== undefined ? ` — ${ing.amount} ${ing.unit || ''}`.trimEnd() : ''}`))) : null));
  }
}

async function onSubmitRecipe(e) {
  e.preventDefault();
  const name = $('rName').value.trim();
  const servings = parseInt($('rServings').value, 10);
  const tags = $('rTags').value.split(',').map((s) => s.trim()).filter(Boolean);
  const ingredients = [...document.querySelectorAll('#ingRows .ing-row')].map((row) => {
    const iname = row.querySelector('.ing-name').value.trim();
    const amount = parseFloat(row.querySelector('.ing-amount').value);
    return iname ? { name: iname, amount: Number.isNaN(amount) ? 0 : amount, unit: row.querySelector('.ing-unit').value.trim() } : null;
  }).filter(Boolean);
  if (!name) { toast('Name fehlt.', true); return; }

  const btn = $('btnSaveRecipe');
  btn.disabled = true;
  try {
    await batu('/recipes', { method: 'POST', body: { name, servings, tags, ingredients }, action: 'Rezept anlegen' });
    toast('Rezept gespeichert.');
    e.target.reset();
    $('ingRows').replaceChildren();
    $('newRecipeWrap').hidden = true;
    loadCatalog();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
}

// ---------- Start ----------
function fatal(title, detail) {
  $('app').replaceChildren(h('div', { class: 'fatal' }, h('h2', {}, title), h('p', {}, detail),
    h('button', { class: 'btn', type: 'button', onclick: () => window.location.reload() }, 'Erneut versuchen')));
}

async function init() {
  injectStyles();
  keycloak = new Keycloak(CONFIG.keycloak || { url: 'http://localhost:8180', realm: 'm321', clientId: 'rana-web' });
  try {
    await keycloak.init({ onLoad: 'login-required', pkceMethod: 'S256', checkLoginIframe: false });
  } catch {
    fatal('Anmeldung nicht möglich', `Keycloak unter ${keycloak.authServerUrl || CONFIG.keycloak?.url} ist nicht erreichbar. Läuft das Gesamtsystem (podman compose up)?`);
    return;
  }
  keycloak.onTokenExpired = () => keycloak.updateToken(30).catch(() => keycloak.login());

  buildLayout();
  renderActivity();
  renderOrders();
  checkHealth();
  setInterval(checkHealth, 4000);
  loadCatalog();
  await refreshOrders();
  if (state.orders.some((o) => o.status === 'queued' || o.status === 'sending')) schedulePoll(1500);
}

init();
