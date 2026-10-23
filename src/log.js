'use strict';
/**
 * Strukturierte Logs im selben Format wie die batu_api: eine JSON-Zeile pro
 * Ereignis mit `timestamp`, `level`, `message`, `target` und der
 * Correlation-ID unter `span.correlation_id`. So liest
 * `shared/scripts/demo/logs.sh` beide Services gleich.
 */
const crypto = require('node:crypto');
const pino = require('pino');
const { trace } = require('@opentelemetry/api');
const config = require('./config');

const HEADER = 'x-correlation-id';
// Erlaubt sind kurze, druckbare IDs -- alles andere wird ersetzt, damit
// niemand ueber den Header Zeilenumbrueche o. Ae. in die Logs schmuggelt.
const VALID_ID = /^[\w.:-]{1,128}$/;

const logger = pino({
  level: config.logLevel,
  messageKey: 'message',
  base: { target: 'rana_frontend', service: 'rana-frontend', instance: config.instance },
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  formatters: { level: (label) => ({ level: label.toUpperCase() }) },
});

/** Logger fuer einen Vorgang: jede Zeile traegt dessen Correlation-ID. */
function forCorrelation(correlationId) {
  return logger.child({ span: { correlation_id: correlationId } });
}

function newCorrelationId() {
  return crypto.randomUUID();
}

/**
 * Express-Middleware: Correlation-ID aus dem Header uebernehmen oder neu
 * erzeugen, in der Antwort zurueckgeben, an den Trace-Span haengen und einen
 * Request-Logger unter `req.log` bereitstellen.
 */
function correlationMiddleware(req, res, next) {
  const incoming = req.get(HEADER);
  const correlationId = incoming && VALID_ID.test(incoming) ? incoming : newCorrelationId();
  req.correlationId = correlationId;
  req.log = forCorrelation(correlationId);
  res.set(HEADER, correlationId);

  const span = trace.getActiveSpan();
  if (span) span.setAttribute('correlation_id', correlationId);

  if (req.path.startsWith('/api') || req.path === '/') {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const latencyMs = Number(process.hrtime.bigint() - started) / 1e6;
      req.log.info(
        { method: req.method, uri: req.originalUrl, status: res.statusCode, latency_ms: Math.round(latencyMs) },
        'request beendet',
      );
    });
  }
  next();
}

/** Trace-ID des aktiven Spans, fuer den Link nach Jaeger in der UI. */
function currentTraceId() {
  const span = trace.getActiveSpan();
  const id = span && span.spanContext().traceId;
  return id && !/^0+$/.test(id) ? id : null;
}

module.exports = { logger, forCorrelation, newCorrelationId, correlationMiddleware, currentTraceId, HEADER, VALID_ID };
