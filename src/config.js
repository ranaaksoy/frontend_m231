'use strict';
/**
 * Konfiguration ausschliesslich aus Umgebungsvariablen -- keine fest
 * verdrahteten Hosts. Die Defaults passen fuer einen lokalen Start neben
 * `shared/docker-compose.yml`.
 */
const os = require('node:os');

const env = (name, fallback) => {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
};

const config = {
  port: Number(env('PORT', 3000)),
  instance: os.hostname(),

  // Adresse der batu_api, wie der *Browser* sie erreicht (nicht das Docker-Netz).
  batuApiUrl: env('BATU_API_URL', 'http://localhost:8080'),
  // Dieselbe API aus Sicht dieses Servers (im Container: Docker-Netz). Nur
  // fuer die Status-Anzeige, Fachdaten holt der Browser selbst.
  batuInternalUrl: env('BATU_INTERNAL_URL', env('BATU_API_URL', 'http://localhost:8080')),
  jaegerUiUrl: env('JAEGER_UI_URL', 'http://localhost:16686'),

  amqp: {
    url: env('AMQP_ADDR', 'amqp://guest:guest@localhost:5672/%2f'),
    requestQueue: 'recipe.requests',
    // Pro Instanz eine eigene Antwort-Queue: so landet die Antwort bei der
    // Instanz, die den Auftrag angenommen hat, auch wenn rana skaliert wird.
    replyQueue: env('AMQP_REPLY_QUEUE', `rana.replies.${os.hostname()}`),
    reconnectDelayMs: Number(env('AMQP_RECONNECT_MS', 5000)),
    confirmTimeoutMs: Number(env('AMQP_CONFIRM_TIMEOUT_MS', 5000)),
  },

  oidc: {
    // Der Browser holt Tokens ueber localhost:8180 -- das steht dann in `iss`.
    issuer: env('OIDC_ISSUER', 'http://localhost:8180/realms/m321'),
    // Im Container nur ueber das Docker-Netz erreichbar.
    jwksUrl: env('OIDC_JWKS_URL', 'http://localhost:8180/realms/m321/protocol/openid-connect/certs'),
    clientId: env('OIDC_CLIENT_ID', 'rana-web'),
    audience: env('OIDC_AUDIENCE', 'rana-frontend'),
  },

  logFormat: env('LOG_FORMAT', 'json'),
  logLevel: env('LOG_LEVEL', 'info'),
};

module.exports = config;
