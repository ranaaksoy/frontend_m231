#!/usr/bin/env node
/**
 * rana-frontend — Web-Oberflaeche des Rezept-Planers (Owner: Rana).
 *
 * Liefert die Browser-App aus und nimmt Plan-Bestellungen entgegen, die
 * asynchron ueber RabbitMQ an die batu_api gehen. Rezepte und Plaene liest
 * und schreibt der Browser direkt bei der batu_api (HTTP + Bearer-Token).
 *
 * Start: `npm start` (laedt vorher src/telemetry.js fuer das Tracing).
 */
'use strict';

const config = require('./src/config');
const telemetry = require('./src/telemetry');
const { logger } = require('./src/log');
const { createApp } = require('./src/app');
const { Broker } = require('./src/broker');
const { OrderStore } = require('./src/orders');

const store = new OrderStore();
const broker = new Broker((reply) => store.applyReply(reply));
const app = createApp({ broker, store });

broker.start();

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, batu_api: config.batuApiUrl }, `rana-frontend laeuft auf http://localhost:${config.port}`);
});

// `docker stop` (SIGTERM): keine neuen Requests, laufende fertig, dann AMQP
// sauber schliessen. Unbestaetigte Antworten gehen an den Broker zurueck.
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'faehrt herunter');
    server.close(async () => {
      await broker.stop();
      await telemetry.shutdown();
      process.exit(0);
    });
    // Offene Keep-Alive-Verbindungen nicht ewig abwarten.
    setTimeout(() => process.exit(0), 8000).unref();
    server.closeIdleConnections();
  });
}
