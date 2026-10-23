'use strict';
/**
 * Distributed Tracing mit OpenTelemetry. Wird per `node --require` vor allem
 * anderen geladen, damit http, express und amqplib instrumentiert sind.
 *
 * - Eingehende HTTP-Requests starten einen Span (oder setzen einen per
 *   `traceparent` mitgeschickten Trace fort).
 * - Beim Publizieren nach RabbitMQ schreibt die amqplib-Instrumentierung den
 *   W3C-Header `traceparent` in die Nachricht. Die batu_api uebernimmt ihn,
 *   in Jaeger erscheinen rana-frontend und batu-api so im selben Trace.
 *
 * Ohne `OTEL_EXPORTER_OTLP_ENDPOINT` bleibt Tracing aus.
 */
const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (endpoint) {
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
  const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
  const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
  const { AmqplibInstrumentation } = require('@opentelemetry/instrumentation-amqplib');
  const { resourceFromAttributes } = require('@opentelemetry/resources');
  const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = require('@opentelemetry/semantic-conventions');
  const { version } = require('../package.json');

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'rana-frontend',
      [ATTR_SERVICE_VERSION]: version,
    }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint.replace(/\/+$/, '')}/v1/traces` }),
    instrumentations: [
      new HttpInstrumentation({
        // Healthchecks und statische Dateien fluten Jaeger sonst.
        ignoreIncomingRequestHook: (req) => req.url === '/health' || !req.url.startsWith('/api'),
      }),
      new ExpressInstrumentation(),
      new AmqplibInstrumentation(),
    ],
  });
  sdk.start();

  const shutdown = () => sdk.shutdown().catch(() => {});
  process.once('beforeExit', shutdown);
  module.exports = { shutdown };
} else {
  module.exports = { shutdown: async () => {} };
}
