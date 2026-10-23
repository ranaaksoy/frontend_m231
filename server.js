#!/usr/bin/env node
/**
 * Rezept-Planer — Express-Server.
 *  - liefert public/ (index.html + app.js) aus
 *  - stellt die REST-API unter /api bereit:
 *      GET  /api/recipes        Katalog
 *      POST /api/recipes        Rezept anlegen
 *      POST /api/plans          Wochenplan + Einkaufsliste erzeugen
 *      GET  /api/plans/:id      gespeicherten Plan abrufen
 *  - Persistenz: einfache JSON-Datei (data/db.json), keine Datenbank nötig.
 */
'use strict';

const express = require('express');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// ---------- Fehler ----------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- Speicher ----------
const SEED_RECIPES = [
  { name: 'Spaghetti Bolognese', servings: 2, tags: ['fleisch', 'pasta'], ingredients: [
    { name: 'Spaghetti', amount: 200, unit: 'g' }, { name: 'Rinderhackfleisch', amount: 250, unit: 'g' },
    { name: 'Tomaten, gehackt', amount: 400, unit: 'g' }, { name: 'Zwiebel', amount: 1, unit: 'Stk' }] },
  { name: 'Linsen-Dal', servings: 2, tags: ['vegan', 'schnell'], ingredients: [
    { name: 'Rote Linsen', amount: 200, unit: 'g' }, { name: 'Kokosmilch', amount: 200, unit: 'ml' },
    { name: 'Zwiebel', amount: 1, unit: 'Stk' }, { name: 'Currypulver', amount: 2, unit: 'TL' }] },
  { name: 'Gemüsepfanne mit Reis', servings: 2, tags: ['vegan', 'schnell'], ingredients: [
    { name: 'Reis', amount: 150, unit: 'g' }, { name: 'Paprika', amount: 2, unit: 'Stk' },
    { name: 'Zucchini', amount: 1, unit: 'Stk' }, { name: 'Sojasauce', amount: 3, unit: 'EL' }] },
  { name: 'Rösti mit Spiegelei', servings: 2, tags: ['vegetarisch'], ingredients: [
    { name: 'Kartoffeln', amount: 500, unit: 'g' }, { name: 'Eier', amount: 4, unit: 'Stk' },
    { name: 'Butter', amount: 30, unit: 'g' }] },
  { name: 'Pesto-Pasta', servings: 2, tags: ['vegetarisch', 'nuts', 'pasta'], ingredients: [
    { name: 'Penne', amount: 200, unit: 'g' }, { name: 'Basilikum-Pesto', amount: 80, unit: 'g' },
    { name: 'Pinienkerne', amount: 20, unit: 'g' }, { name: 'Parmesan', amount: 30, unit: 'g' }] },
  { name: 'Ofenlachs mit Kartoffeln', servings: 2, tags: ['fisch'], ingredients: [
    { name: 'Lachsfilet', amount: 300, unit: 'g' }, { name: 'Kartoffeln', amount: 400, unit: 'g' },
    { name: 'Zitrone', amount: 1, unit: 'Stk' }] },
];

let db = null;

function seedDb() {
  const recipes = SEED_RECIPES.map((r, i) => ({ id: i + 1, ...r }));
  return { nextRecipeId: recipes.length + 1, recipes, plans: {} };
}

function loadDb() {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    db = seedDb();
  }
}

// Schreibzugriffe hintereinander schalten; atomar via tmp-Datei + rename.
let writeChain = Promise.resolve();
function saveDb() {
  writeChain = writeChain.catch(() => {}).then(async () => {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(db, null, 2));
    await fsp.rename(tmp, DB_FILE);
  });
  return writeChain;
}

// ---------- Validierung ----------
const lc = (s) => String(s).trim().toLowerCase();

function parseRecipe(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Ungültiger Body.');

  const name = String(body.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Name fehlt.');
  if (name.length > 120) throw new HttpError(400, 'Name ist zu lang (max. 120 Zeichen).');

  const servings = body.servings ?? 2;
  if (!Number.isInteger(servings) || servings < 1 || servings > 100) {
    throw new HttpError(400, 'Portionen müssen eine ganze Zahl zwischen 1 und 100 sein.');
  }

  const rawTags = body.tags ?? [];
  if (!Array.isArray(rawTags) || rawTags.length > 20) throw new HttpError(400, 'Tags müssen eine Liste (max. 20) sein.');
  const tags = [...new Set(rawTags.map((t) => String(t).trim()).filter(Boolean))];

  const rawIngs = body.ingredients ?? [];
  if (!Array.isArray(rawIngs) || rawIngs.length > 100) throw new HttpError(400, 'Zutaten müssen eine Liste (max. 100) sein.');
  const ingredients = rawIngs.map((ing) => {
    const iname = String(ing?.name ?? '').trim();
    const amount = Number(ing?.amount ?? 0);
    if (!iname) throw new HttpError(400, 'Jede Zutat braucht einen Namen.');
    if (!Number.isFinite(amount) || amount < 0) throw new HttpError(400, `Ungültige Menge bei „${iname}“.`);
    return { name: iname, amount, unit: String(ing?.unit ?? '').trim() };
  });

  return { name, servings, tags, ingredients };
}

function parsePlanRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Ungültiger Body.');

  const days = body.days;
  if (!Number.isInteger(days) || days < 1 || days > 31) throw new HttpError(400, 'Tage müssen eine ganze Zahl zwischen 1 und 31 sein.');

  const servings = body.servings;
  if (!Number.isInteger(servings) || servings < 1 || servings > 100) {
    throw new HttpError(400, 'Portionen müssen eine ganze Zahl zwischen 1 und 100 sein.');
  }

  const exclude = body.exclude ?? [];
  if (!Array.isArray(exclude)) throw new HttpError(400, '„exclude“ muss eine Liste sein.');

  let startDate = null;
  if (body.start_date != null && body.start_date !== '') {
    const d = new Date(`${body.start_date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.start_date) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== body.start_date) {
      throw new HttpError(400, 'start_date muss ein gültiges Datum im Format JJJJ-MM-TT sein.');
    }
    startDate = body.start_date;
  }

  return { days, servings, exclude: exclude.map(lc).filter(Boolean), startDate };
}

// ---------- Plan-Logik ----------
function isExcluded(recipe, exclude) {
  const tags = recipe.tags.map(lc);
  const names = recipe.ingredients.map((i) => lc(i.name));
  return exclude.some((e) => tags.includes(e) || names.some((n) => n.includes(e)));
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Rezepte reihum (gemischt) auf die Tage verteilen, ohne direkte Wiederholung, wenn möglich.
function pickRecipes(pool, days) {
  const result = [];
  let queue = [];
  for (let i = 0; i < days; i++) {
    if (!queue.length) {
      queue = shuffle(pool);
      if (pool.length > 1 && result.length && queue[0].id === result[result.length - 1].id) {
        queue.push(queue.shift());
      }
    }
    result.push(queue.shift());
  }
  return result;
}

const dateFmt = new Intl.DateTimeFormat('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });

function buildShoppingList(recipes, servings) {
  const totals = new Map();
  for (const r of recipes) {
    const factor = servings / r.servings;
    for (const ing of r.ingredients) {
      const key = `${lc(ing.name)}|${lc(ing.unit)}`;
      const entry = totals.get(key) || { name: ing.name, amount: 0, unit: ing.unit };
      entry.amount += ing.amount * factor;
      totals.set(key, entry);
    }
  }
  return [...totals.values()]
    .map((e) => ({ ...e, amount: Math.round(e.amount * 100) / 100 }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function buildPlan({ days, servings, exclude, startDate }) {
  const pool = db.recipes.filter((r) => !isExcluded(r, exclude));
  if (!pool.length) throw new HttpError(422, 'Kein Rezept passt zu den Ausschlüssen.');

  const chosen = pickRecipes(pool, days);
  const meals = chosen.map((r, i) => {
    const meal = {
      day: `Tag ${i + 1}`,
      day_number: i + 1,
      recipe: { id: r.id, name: r.name, tags: r.tags },
    };
    if (startDate) {
      const d = new Date(`${startDate}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      meal.iso_date = d.toISOString().slice(0, 10);
      meal.date = dateFmt.format(d);
    }
    return meal;
  });

  return {
    id: crypto.randomBytes(4).toString('hex'),
    created_at: new Date().toISOString(),
    days,
    servings,
    start_date: startDate,
    exclude,
    meals,
    shopping_list: buildShoppingList(chosen, servings),
  };
}

// ---------- API ----------
const api = express.Router();

api.get('/recipes', (req, res) => {
  res.json(db.recipes);
});

api.post('/recipes', async (req, res) => {
  const recipe = { id: db.nextRecipeId++, ...parseRecipe(req.body) };
  db.recipes.push(recipe);
  await saveDb();
  res.status(201).json(recipe);
});

api.post('/plans', async (req, res) => {
  const plan = buildPlan(parsePlanRequest(req.body));
  db.plans[plan.id] = plan;
  await saveDb();
  res.status(201).json(plan);
});

api.get('/plans/:id', (req, res) => {
  const plan = Object.hasOwn(db.plans, req.params.id) ? db.plans[req.params.id] : null;
  if (!plan) throw new HttpError(404, 'Plan nicht gefunden.');
  res.json(plan);
});

api.use((req, res) => {
  res.status(404).json({ error: `Unbekannter Endpunkt: ${req.method} ${req.originalUrl}` });
});

// ---------- App ----------
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use('/api', api);
app.use(express.static(PUBLIC_DIR));

app.use((req, res) => {
  res.status(404).type('text/plain; charset=utf-8').send(`Nicht gefunden: ${req.path}`);
});

// Zentrale Fehlerbehandlung (Express 5 leitet auch async-Fehler hierher)
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Ungültiges JSON.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Anfrage zu groß.' });
  const status = err instanceof HttpError ? err.status : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Interner Serverfehler.' : err.message });
});

loadDb();

const server = app.listen(PORT, () => {
  console.log(`Rezept-Planer läuft auf http://localhost:${PORT}`);
  console.log(`API unter http://localhost:${PORT}/api  (Daten: ${DB_FILE})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => writeChain.finally(() => process.exit(0)));
  });
}
