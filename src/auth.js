'use strict';
/**
 * Pruefung von Access Tokens aus Keycloak (Realm m321).
 *
 * rana-frontend ist fuer `/api/*` ein Resource Server wie die batu_api: Es
 * sieht nie ein Passwort, sondern prueft nur Signatur (JWKS), `iss`, `aud`
 * und `exp` des mitgeschickten JWT. Die Schluessel werden von `jose`
 * gecacht und nur bei unbekannter `kid` neu geladen.
 */
const config = require('./config');

let jwks = null;
let jose = null;

async function verify(token) {
  // jose ist ein ES-Modul; einmal laden und behalten.
  jose = jose || (await import('jose'));
  jwks = jwks || jose.createRemoteJWKSet(new URL(config.oidc.jwksUrl), { timeoutDuration: 6000, cooldownDuration: 10000 });
  const { payload } = await jose.jwtVerify(token, jwks, {
    issuer: config.oidc.issuer,
    audience: config.oidc.audience,
  });
  return payload;
}

/** Express-Middleware: ohne gueltiges Token 401, sonst `req.user`. */
async function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    req.log.warn({ reason: 'kein Bearer-Token' }, 'nicht authentifiziert');
    return res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'Nicht angemeldet.' });
  }
  try {
    const claims = await verify(match[1]);
    req.user = { sub: claims.sub, username: claims.preferred_username || claims.sub };
    req.log = req.log.child({ user: req.user.username });
    return next();
  } catch (err) {
    // Grund nur ins Log, der Client sieht immer dasselbe 401.
    req.log.warn({ reason: err.code || err.message }, 'Token abgelehnt');
    return res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'Anmeldung abgelaufen oder ungueltig.' });
  }
}

module.exports = { requireAuth };
