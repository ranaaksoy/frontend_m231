'use strict';
/**
 * HTTP-Schnittstelle von rana-frontend.
 *
 *   GET  /                    Browser-App (public/)
 *   GET  /config.js           Laufzeit-Konfiguration fuer den Browser
 *   GET  /health              Betriebszustand (ohne Token)
 *   GET  /status              batu, RabbitMQ und Queue-Tiefe fuer die Status-Leiste
 *   GET  /api/orders          eigene Queue-Auftraege          (Bearer-Token)
 *   POST /api/orders          Plan ueber die Queue bestellen  (Bearer-Token) → 202
 *   GET  /api/orders/:id      ein Auftrag                     (Bearer-Token)
 *
 * Rezepte und Plaene selbst liegen nur in der batu_api; der Browser ruft sie
 * dort direkt per HTTP ab (synchroner Weg, OpenAPI-Kontrakt).
 */
const path = require('node:path');
const express = require('express');
const config = require('./config');
const { correlationMiddleware, currentTraceId } = require('./log');
const { requireAuth } = require('./auth');
const { parseOrder, toPlanCreate, ValidationError } = require('./messages');
const { toView } = require('./orders');
const { BrokerUnavailable } = require('./broker');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const KEYCLOAK_JS_DIR = path.dirname(require.resolve('keycloak-js'));

function createApp({ broker, store, auth = requireAuth }) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (req, res) => {
    res.json({
      status: broker.connected ? 'ok' : 'degraded',
      service: 'rana-frontend',
      instance: config.instance,
      amqp: broker.connected ? 'up' : 'down',
    });
  });

  // Systemzustand fuer die Status-Leiste der UI. Fragt batu mit kurzem
  // Timeout: Ist batu weg, antwortet /status trotzdem sofort.
  app.get('/status', async (req, res) => {
    const batu = await fetch(`${config.batuInternalUrl.replace(/\/+$/, '')}/health`, { signal: AbortSignal.timeout(1500) })
      .then((r) => r.json())
      .catch(() => null);
    res.set('Cache-Control', 'no-store').json({
      rana: { status: 'ok', instance: config.instance },
      amqp: broker.connected ? 'up' : 'down',
      queue: await broker.queueStats(),
      batu: batu ? { status: batu.status || 'ok' } : { status: 'down' },
    });
  });

  app.use(correlationMiddleware);

  app.get('/config.js', (req, res) => {
    const browserConfig = {
      batuApiUrl: config.batuApiUrl,
      jaegerUiUrl: config.jaegerUiUrl,
      keycloak: {
        url: config.oidc.issuer.replace(/\/realms\/.*$/, ''),
        realm: config.oidc.issuer.replace(/^.*\/realms\//, ''),
        clientId: config.oidc.clientId,
      },
    };
    res.type('application/javascript').set('Cache-Control', 'no-store')
      .send(`window.RANA_CONFIG = ${JSON.stringify(browserConfig)};\n`);
  });

  const api = express.Router();
  api.use(express.json({ limit: '50kb' }));
  api.use(auth);

  api.get('/orders', (req, res) => {
    res.json(store.listFor(req.user.sub).map(toView));
  });

  api.get('/orders/:id', (req, res) => {
    const order = store.get(String(req.params.id).toLowerCase());
    if (!order || order.owner !== req.user.sub) return res.status(404).json({ error: 'Auftrag nicht gefunden.' });
    res.json(toView(order));
  });

  api.post('/orders', async (req, res) => {
    const order = parseOrder(req.body);
    const existing = store.get(order.requestId);
    if (existing && existing.owner !== req.user.sub) {
      return res.status(409).json({ error: 'request_id ist bereits vergeben.' });
    }
    // Idempotent: Derselbe Auftrag ein zweites Mal (Doppelklick, Retry nach
    // Timeout) wird nicht nochmals publiziert -- ausser der erste Versuch kam
    // nie beim Broker an.
    if (existing && existing.status !== 'send_failed') {
      req.log.info({ request_id: order.requestId, status: existing.status }, 'Auftrag bereits bekannt, nicht erneut gesendet');
      return res.status(202).location(`/api/orders/${order.requestId}`).json(toView(existing));
    }

    const correlationId = req.correlationId;
    const message = toPlanCreate(order, correlationId);
    const entry = existing || store.create({
      requestId: order.requestId,
      correlationId,
      owner: req.user.sub,
      request: message,
      traceId: currentTraceId(),
    });

    try {
      await broker.publish(message, correlationId);
    } catch (err) {
      if (!(err instanceof BrokerUnavailable)) throw err;
      store.markSendFailed(order.requestId, err.message);
      req.log.warn({ request_id: order.requestId, error: err.message }, 'Auftrag nicht an die Queue uebergeben');
      return res.status(503).set('Retry-After', '5').json({ ...toView(entry), error: err.message });
    }
    store.markQueued(order.requestId);
    req.log.info({ request_id: order.requestId, days: order.days, servings: order.servings }, 'Auftrag in recipe.requests gelegt');
    res.status(202).location(`/api/orders/${order.requestId}`).json(toView(entry));
  });

  api.use((req, res) => {
    res.status(404).json({ error: `Unbekannter Endpunkt: ${req.method} ${req.originalUrl}` });
  });

  app.use('/api', api);
  app.use('/vendor/keycloak', express.static(KEYCLOAK_JS_DIR, { maxAge: '1h' }));
  app.use(express.static(PUBLIC_DIR));
  // Das Icon steht inline in index.html; Browser fragen trotzdem hier nach.
  app.get('/favicon.ico', (req, res) => res.status(204).end());

  app.use((req, res) => {
    res.status(404).type('text/plain; charset=utf-8').send(`Nicht gefunden: ${req.path}`);
  });

  // Zentrale Fehlerbehandlung (Express 5 leitet auch async-Fehler hierher).
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Ungueltiges JSON.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Anfrage zu gross.' });
    (req.log || console).error({ error: err.message, stack: err.stack }, 'interner Fehler');
    res.status(500).json({ error: 'Interner Serverfehler.' });
  });

  return app;
}

module.exports = { createApp };
