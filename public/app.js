/**
 * Rezept-Planer — Browser-Frontend, reines JavaScript.
 * Baut DOM und CSS zur Laufzeit selbst auf, damit index.html leer bleiben kann.
 * Spricht per fetch() mit der batu-api (axum): GET/POST /recipes, POST /plans, GET /plans/{id}.
 */
(function () {
  'use strict';

  // ---------- Zustand ----------
  let apiBase = localStorage.getItem('rp_api_base') || 'http://127.0.0.1:8080';
  let excludeList = [];
  let catalog = [];

  // ---------- CSS ----------
  const css = `
    :root{
      --paper:#e7dfc6; --paper-deep:#ddd3b4; --card:#fbf8ef;
      --ink:#26221b; --ink-soft:#57503f;
      --pine:#3b5744; --pine-deep:#2b4033;
      --saffron:#c1862b; --brick:#9c3b2e; --thread:#b9ac86;
      --shadow: 2px 3px 0 rgba(38,34,27,0.12); --radius:3px;
    }
    *{box-sizing:border-box;}
    body{margin:0;background:var(--paper);color:var(--ink);
      font-family:'Source Serif 4', Georgia, serif;line-height:1.5;}
    .mono{font-family:'JetBrains Mono', ui-monospace, monospace;}
    :focus-visible{outline:3px solid var(--saffron);outline-offset:2px;}
    header.top{padding:2.2rem clamp(1.2rem,4vw,3.5rem) 1.4rem;border-bottom:1px solid var(--thread);}
    .brand{display:flex;align-items:baseline;gap:.9rem;flex-wrap:wrap;}
    .brand h1{font-family:'Fraunces',serif;font-weight:600;font-size:clamp(2.1rem,4vw,3rem);margin:0;}
    .brand .kicker{font-family:'Fraunces',serif;font-style:italic;color:var(--pine-deep);font-size:1.1rem;}
    .top p.lede{max-width:52ch;margin:.6rem 0 0;color:var(--ink-soft);}
    .conn{margin-top:1.1rem;display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;font-size:.85rem;}
    .conn input{font-family:'JetBrains Mono',monospace;font-size:.82rem;background:var(--card);
      border:1px solid var(--thread);border-radius:var(--radius);padding:.35rem .55rem;min-width:min(340px,60vw);}
    .dot{width:9px;height:9px;border-radius:50%;background:var(--brick);display:inline-block;}
    .dot.ok{background:var(--pine);}
    main{display:grid;grid-template-columns:320px 1fr;}
    @media (max-width:880px){main{grid-template-columns:1fr;}}
    .ticket-rail{padding:2rem clamp(1rem,3vw,2rem);border-right:1px solid var(--thread);position:sticky;top:0;align-self:start;}
    @media (max-width:880px){.ticket-rail{position:static;border-right:none;border-bottom:1px solid var(--thread);}}
    .content{padding:2rem clamp(1rem,3vw,3rem) 4rem;}
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
      font-size:.95rem;font-weight:600;cursor:pointer;box-shadow:var(--shadow);}
    .btn.ghost{background:transparent;color:var(--pine-deep);box-shadow:none;border:1px dashed var(--thread);}
    .btn.small{padding:.4rem .75rem;font-size:.82rem;}
    .btn[disabled]{opacity:.55;cursor:progress;}
    .field-note{font-size:.75rem;color:var(--ink-soft);margin-top:.3rem;}
    .section-head{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;margin-bottom:1.1rem;flex-wrap:wrap;}
    .section-head h2{font-family:'Fraunces',serif;font-weight:600;font-size:1.55rem;margin:0;}
    .section-head .sub{color:var(--ink-soft);font-size:.9rem;}
    .empty{border:1px dashed var(--thread);border-radius:var(--radius);padding:2.2rem 1.6rem;color:var(--ink-soft);}
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
    .catalog-head{display:flex;gap:.8rem;align-items:center;flex-wrap:wrap;margin-bottom:1.2rem;}
    .search{font-family:'JetBrains Mono',monospace;padding:.5rem .7rem;border:1px solid var(--thread);
      border-radius:var(--radius);background:#fff;min-width:220px;font-size:.88rem;}
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
      border:1px solid var(--thread);border-radius:var(--radius);}
    .ing-row button{background:none;border:1px dashed var(--thread);border-radius:var(--radius);
      color:var(--brick);cursor:pointer;font-size:.85rem;}
    #toast{position:fixed;bottom:1.3rem;left:50%;transform:translateX(-50%);background:var(--ink);
      color:var(--paper);padding:.75rem 1.2rem;border-radius:var(--radius);font-size:.88rem;
      box-shadow:0 6px 18px rgba(0,0,0,.25);opacity:0;pointer-events:none;transition:opacity .2s ease;z-index:50;max-width:80vw;}
    #toast.show{opacity:1;}
    #toast.error{background:var(--brick);}
    @media (prefers-reduced-motion: reduce){.btn,#toast{transition:none;}}
  `;

  function injectStyles() {
    const link1 = document.createElement('link');
    link1.rel = 'preconnect';
    link1.href = 'https://fonts.googleapis.com';
    const link2 = document.createElement('link');
    link2.rel = 'stylesheet';
    link2.href = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,500&family=Source+Serif+4:ital,wght@0,400;0,600;1,400&family=JetBrains+Mono:wght@400;600&display=swap';
    document.head.append(link1, link2);
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ---------- kleine DOM-Hilfe ----------
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c == null) continue;
      el.append(c.nodeType ? c : document.createTextNode(c));
    }
    return el;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(msg, isError) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
  }

  // ---------- API ----------
  async function apiFetch(path, opts) {
    const url = apiBase.replace(/\/+$/, '') + path;
    let res;
    try {
      res = await fetch(url, opts);
    } catch (err) {
      document.getElementById('connDot').classList.remove('ok');
      throw new Error('Keine Verbindung zu ' + url + '. Läuft die API und stimmt die Basis-URL?');
    }
    document.getElementById('connDot').classList.add('ok');
    const text = await res.text();
    let body = null;
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    if (!res.ok) {
      const msg = body && body.error ? body.error : 'HTTP ' + res.status;
      throw new Error(msg);
    }
    return body;
  }

  function pick(obj, keys) {
    for (const k of keys) if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
    return undefined;
  }

  // ---------- Layout aufbauen ----------
  function buildLayout() {
    const app = document.getElementById('app');

    const header = h('header', { class: 'top' },
      h('div', { class: 'brand' },
        h('h1', {}, 'Rezept-Planer'),
        h('span', { class: 'kicker' }, 'für die Woche gedacht')
      ),
      h('p', { class: 'lede' }, 'Wochenplan aus dem Katalog zusammenstellen, Einkaufsliste bekommen, Rezepte ergänzen. Spricht direkt mit der batu-api.'),
      h('div', { class: 'conn' },
        h('span', { class: 'dot', id: 'connDot' }),
        h('span', {}, 'API:'),
        h('input', { type: 'text', id: 'apiBase', class: 'mono', value: apiBase }),
        h('button', { class: 'btn ghost small', type: 'button', onclick: checkConnection }, 'Verbindung prüfen')
      )
    );

    // -- Plan-Ticket (linke Spalte) --
    const excludeInput = h('input', { type: 'text', id: 'excludeInput', placeholder: 'z. B. nuts – Enter zum Hinzufügen' });
    const excludeChips = h('div', { class: 'chips', id: 'excludeChips' });
    excludeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = e.target.value.trim();
        if (v && !excludeList.includes(v)) { excludeList.push(v); renderChips(); }
        e.target.value = '';
      }
    });

    const daysInput = h('input', { type: 'number', id: 'days', min: '1', max: '31', value: '7', required: true });
    const servingsInput = h('input', { type: 'number', id: 'servings', min: '1', value: '2', required: true });
    const startDateInput = h('input', { type: 'date', id: 'startDate' });
    const btnPlan = h('button', { class: 'btn', type: 'submit' }, 'Plan erstellen');

    const planForm = h('form', { id: 'planForm' },
      h('div', { class: 'row-2' },
        h('div', { class: 'field' }, h('label', { for: 'days' }, 'Tage'), daysInput),
        h('div', { class: 'field' }, h('label', { for: 'servings' }, 'Portionen'), servingsInput)
      ),
      h('div', { class: 'field' }, h('label', { for: 'startDate' }, 'Startdatum (optional)'), startDateInput),
      h('div', { class: 'field' },
        h('label', { for: 'excludeInput' }, 'Ausschlüsse'),
        excludeInput, excludeChips,
        h('p', { class: 'field-note' }, 'Zutaten oder Tags, die im Plan nicht vorkommen sollen.')
      ),
      btnPlan
    );
    planForm.addEventListener('submit', onSubmitPlan);

    const ticketRail = h('div', { class: 'ticket-rail' },
      h('div', { class: 'ticket' }, h('h2', {}, 'Wochenplan bauen'), planForm)
    );

    // -- Plan-Ausgabe --
    const planSub = h('span', { class: 'sub', id: 'planSub' });
    const planOutput = h('div', { id: 'planOutput' },
      h('div', { class: 'empty' },
        h('strong', {}, 'Noch kein Plan.'),
        'Links Tage und Portionen eingeben und auf „Plan erstellen“ tippen — der Wochenplan erscheint hier als Kartenreihe, dazu die Einkaufsliste.'
      )
    );
    const planSection = h('section', { id: 'planSection' },
      h('div', { class: 'section-head' }, h('h2', {}, 'Aktueller Wochenplan'), planSub),
      planOutput
    );

    // -- Katalog --
    const catalogSub = h('span', { class: 'sub', id: 'catalogSub' });
    const catalogSearch = h('input', { type: 'text', class: 'search mono', id: 'catalogSearch', placeholder: 'Katalog durchsuchen…' });
    catalogSearch.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      renderCatalog(!q ? catalog : catalog.filter((r) => {
        const name = (pick(r, ['name', 'title']) || '').toLowerCase();
        const tags = (pick(r, ['tags']) || []).join(' ').toLowerCase();
        return name.includes(q) || tags.includes(q);
      }));
    });
    const catalogGrid = h('div', { class: 'catalog-grid', id: 'catalogGrid' });
    const newRecipeWrap = h('div', { class: 'new-recipe', id: 'newRecipeWrap', hidden: true });
    buildRecipeForm(newRecipeWrap);

    const btnToggleNew = h('button', { class: 'btn ghost small', type: 'button' }, '+ Rezept hinzufügen');
    btnToggleNew.addEventListener('click', () => {
      newRecipeWrap.hidden = !newRecipeWrap.hidden;
      const rows = document.getElementById('ingRows');
      if (!newRecipeWrap.hidden && rows && !rows.children.length) addIngRow(rows);
    });
    const btnReload = h('button', { class: 'btn ghost small', type: 'button', onclick: loadCatalog }, 'Katalog neu laden');

    const catalogSection = h('section', { id: 'catalogSection', style: 'margin-top:3rem;' },
      h('div', { class: 'section-head' }, h('h2', {}, 'Rezept-Katalog'), catalogSub),
      h('div', { class: 'catalog-head' }, catalogSearch, btnToggleNew, btnReload),
      catalogGrid,
      newRecipeWrap
    );

    const content = h('div', { class: 'content' }, planSection, catalogSection);
    const main = h('main', {}, ticketRail, content);
    const toastEl = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });

    app.append(header, main, toastEl);

    document.getElementById('apiBase').addEventListener('change', (e) => {
      apiBase = e.target.value.trim() || 'http://localhost:8080';
      localStorage.setItem('rp_api_base', apiBase);
      checkConnection();
    });
  }

  function buildRecipeForm(wrap) {
    const rName = h('input', { type: 'text', id: 'rName', required: true });
    const rServings = h('input', { type: 'number', id: 'rServings', min: '1', value: '2', required: true });
    const rTags = h('input', { type: 'text', id: 'rTags', placeholder: 'vegan, schnell' });
    const ingRows = h('div', { id: 'ingRows' });
    const btnAddIng = h('button', { type: 'button', class: 'btn ghost small' }, '+ Zutat');
    btnAddIng.addEventListener('click', () => addIngRow(ingRows));

    const btnSave = h('button', { class: 'btn', type: 'submit', id: 'btnSaveRecipe' }, 'Rezept speichern');
    const btnCancel = h('button', { class: 'btn ghost', type: 'button' }, 'Abbrechen');
    btnCancel.addEventListener('click', () => { wrap.hidden = true; });

    const form = h('form', { id: 'recipeForm' },
      h('div', { class: 'field' }, h('label', { for: 'rName' }, 'Name'), rName),
      h('div', { class: 'row-2' },
        h('div', { class: 'field' }, h('label', { for: 'rServings' }, 'Portionen'), rServings),
        h('div', { class: 'field' }, h('label', { for: 'rTags' }, 'Tags (Komma-getrennt)'), rTags)
      ),
      h('div', { class: 'field' }, h('label', {}, 'Zutaten'), ingRows, btnAddIng),
      h('div', { style: 'margin-top:1rem;display:flex;gap:.6rem;' }, btnSave, btnCancel)
    );
    form.addEventListener('submit', onSubmitRecipe);
    wrap.append(h('div', { class: 'section-head' }, h('h2', { style: 'font-size:1.2rem;' }, 'Neues Rezept')), form);
  }

  function addIngRow(container) {
    const nameI = h('input', { type: 'text', placeholder: 'Zutat', class: 'ing-name mono' });
    const amountI = h('input', { type: 'number', placeholder: 'Menge', class: 'ing-amount mono' });
    const unitI = h('input', { type: 'text', placeholder: 'Einheit', class: 'ing-unit mono' });
    const del = h('button', { type: 'button', 'aria-label': 'Zutat entfernen' }, '×');
    const row = h('div', { class: 'ing-row' }, nameI, amountI, unitI, del);
    del.addEventListener('click', () => row.remove());
    container.appendChild(row);
  }

  // ---------- Chips ----------
  function renderChips() {
    const wrap = document.getElementById('excludeChips');
    wrap.innerHTML = '';
    excludeList.forEach((val, i) => {
      const btn = h('button', { type: 'button', 'aria-label': val + ' entfernen' }, '×');
      btn.addEventListener('click', () => { excludeList.splice(i, 1); renderChips(); });
      wrap.appendChild(h('span', { class: 'chip' }, h('span', {}, val), btn));
    });
  }

  // ---------- Plan erstellen ----------
  async function onSubmitPlan(e) {
    e.preventDefault();
    const days = parseInt(document.getElementById('days').value, 10);
    const servings = parseInt(document.getElementById('servings').value, 10);
    const startDate = document.getElementById('startDate').value;
    const payload = { days, servings };
    if (excludeList.length) payload.exclude = excludeList.slice();
    if (startDate) payload.start_date = startDate;

    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Baue Plan …';
    try {
      const plan = await apiFetch('/plans', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      renderPlan(plan);
      toast('Plan erstellt.');
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Plan erstellen';
    }
  }

  function renderPlan(planResp) {
    const plan = planResp && planResp.plan ? planResp.plan : planResp;
    const out = document.getElementById('planOutput');
    const sub = document.getElementById('planSub');
    out.innerHTML = '';

    const id = pick(plan, ['id', 'plan_id']);
    const days = pick(plan, ['days']);
    const servings = pick(plan, ['servings']);
    sub.textContent = [days ? days + ' Tage' : null, servings ? servings + ' Portionen' : null].filter(Boolean).join(' · ');

    if (id !== undefined) {
      const idSpan = h('span', { class: 'id mono', title: 'Zum Kopieren tippen' }, String(id));
      idSpan.addEventListener('click', () => { navigator.clipboard && navigator.clipboard.writeText(String(id)); toast('Plan-ID kopiert.'); });
      out.appendChild(h('div', { class: 'plan-meta' }, h('span', {}, 'Plan-ID'), idSpan));
    }

    const entries = pick(plan, ['meals', 'day_plans', 'entries', 'days_list', 'plan_days']);
    if (Array.isArray(entries) && entries.length) {
      const strip = h('div', { class: 'week-strip' });
      entries.forEach((entry, i) => {
        const recipe = entry.recipe || entry;
        const name = pick(recipe, ['name', 'title']) || ('Eintrag ' + (i + 1));
        const label = pick(entry, ['date', 'day', 'weekday']) || ('Tag ' + (i + 1));
        const tags = pick(recipe, ['tags']) || [];
        strip.appendChild(h('div', { class: 'day-card' },
          h('span', { class: 'day-label mono' }, String(label)),
          h('p', { class: 'meal-name' }, name),
          h('div', { class: 'meal-tags' }, tags.map((t) => h('span', { class: 'tag' }, t)))
        ));
      });
      out.appendChild(strip);
    }

    const shopping = pick(plan, ['shopping_list', 'shoppingList', 'ingredients']);
    if (Array.isArray(shopping) && shopping.length) {
      const list = h('ul', {}, shopping.map((item) => {
        const name = pick(item, ['name']) || String(item);
        const amount = pick(item, ['amount']);
        const unit = pick(item, ['unit']) || '';
        const amt = amount !== undefined ? (amount + ' ' + unit).trim() : '';
        return h('li', {}, h('span', {}, name), h('span', { class: 'amt mono' }, amt));
      }));
      out.appendChild(h('div', { class: 'receipt' }, h('h3', {}, 'Einkaufsliste'), list));
    }

    const pre = h('pre', {}, JSON.stringify(planResp, null, 2));
    out.appendChild(h('details', { class: 'raw' }, h('summary', {}, 'Rohdaten anzeigen'), pre));
  }

  // ---------- Katalog ----------
  async function loadCatalog() {
    const grid = document.getElementById('catalogGrid');
    const sub = document.getElementById('catalogSub');
    sub.textContent = 'lädt …';
    try {
      const res = await apiFetch('/recipes', { method: 'GET' });
      catalog = Array.isArray(res) ? res : (pick(res, ['recipes']) || []);
      sub.textContent = catalog.length + ' Rezept' + (catalog.length === 1 ? '' : 'e');
      renderCatalog(catalog);
    } catch (err) {
      sub.textContent = '';
      grid.innerHTML = '';
      grid.appendChild(h('div', { class: 'empty' }, h('strong', {}, 'Katalog nicht erreichbar.'), err.message));
    }
  }

  function renderCatalog(list) {
    const grid = document.getElementById('catalogGrid');
    grid.innerHTML = '';
    if (!list.length) {
      grid.appendChild(h('div', { class: 'empty' }, h('strong', {}, 'Katalog ist leer.'), 'Noch kein Rezept angelegt — unten eins hinzufügen.'));
      return;
    }
    for (const r of list) {
      const name = pick(r, ['name', 'title']) || 'Ohne Namen';
      const servings = pick(r, ['servings']);
      const tags = pick(r, ['tags']) || [];
      const ingredients = pick(r, ['ingredients']) || [];
      const ingList = h('ul', { class: 'ing-list' }, ingredients.slice(0, 5).map((ing) => {
        const iname = pick(ing, ['name']) || String(ing);
        const amount = pick(ing, ['amount']);
        const unit = pick(ing, ['unit']) || '';
        const amt = amount !== undefined ? (amount + ' ' + unit).trim() : '';
        return h('li', {}, iname + (amt ? ' — ' + amt : ''));
      }));
      grid.appendChild(h('div', { class: 'recipe-card' },
        h('h4', {}, name),
        servings ? h('span', { class: 'servings mono' }, servings + ' Portionen') : null,
        tags.length ? h('div', { class: 'meal-tags', style: 'margin-bottom:.5rem;' }, tags.map((t) => h('span', { class: 'tag' }, t))) : null,
        ingredients.length ? ingList : null
      ));
    }
  }

  // ---------- Rezept anlegen ----------
  async function onSubmitRecipe(e) {
    e.preventDefault();
    const name = document.getElementById('rName').value.trim();
    const servings = parseInt(document.getElementById('rServings').value, 10);
    const tags = document.getElementById('rTags').value.split(',').map((s) => s.trim()).filter(Boolean);
    const ingredients = Array.from(document.querySelectorAll('#ingRows .ing-row')).map((row) => {
      const iname = row.querySelector('.ing-name').value.trim();
      const amount = parseFloat(row.querySelector('.ing-amount').value);
      const unit = row.querySelector('.ing-unit').value.trim();
      return iname ? { name: iname, amount: Number.isNaN(amount) ? 0 : amount, unit } : null;
    }).filter(Boolean);

    if (!name) { toast('Name fehlt.', true); return; }

    const btn = document.getElementById('btnSaveRecipe');
    btn.disabled = true;
    btn.textContent = 'Speichere …';
    try {
      await apiFetch('/recipes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, servings, tags, ingredients }),
      });
      toast('Rezept gespeichert.');
      e.target.reset();
      document.getElementById('ingRows').innerHTML = '';
      addIngRow(document.getElementById('ingRows'));
      document.getElementById('newRecipeWrap').hidden = true;
      loadCatalog();
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Rezept speichern';
    }
  }

  async function checkConnection() {
    try {
      await apiFetch('/recipes', { method: 'GET' });
      toast('Verbindung steht.');
    } catch (err) {
      toast(err.message, true);
    }
  }

  // ---------- Start ----------
  function init() {
    injectStyles();
    if (!document.getElementById('app')) {
      document.body.appendChild(h('div', { id: 'app' }));
    }
    buildLayout();
    renderChips();
    loadCatalog();
    checkConnection();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
