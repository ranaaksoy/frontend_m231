# rana-frontend — Web-Oberfläche und Queue-Producer

**Owner: Rana** · Teil des Rezept-Planers (M321). Gesamtsystem, Diagramme und
Demo: Shared-Repo `../shared` ([README](../shared/README.md)).

## Was der Service tut

| Weg | Ablauf | Kontrakt |
|---|---|---|
| **synchron** | Browser → `batu-api` per HTTP + Bearer-Token: Katalog laden, Rezept anlegen, Plan sofort erstellen, Plan per ID abrufen | `shared/contracts/recipe-planner/openapi.json` |
| **asynchron** | Browser → `rana-frontend` `POST /api/orders` → RabbitMQ `recipe.requests` (`plan.create`) → batu → Antwort in `rana.replies.<instanz>` | `shared/contracts/recipe-planner/asyncapi.yaml` |

rana hat **keine eigenen Fachdaten**. Rezepte und Pläne gehören der batu_api.
rana merkt sich im Speicher nur den Status der eigenen offenen Bestellungen.

## Schnittstellen

| Route | Token | Zweck |
|---|---|---|
| `GET /` | – | Browser-App (`public/`) |
| `GET /config.js` | – | Laufzeit-Konfiguration für den Browser (batu-URL, Keycloak) |
| `GET /health` | – | `ok` / `degraded` (RabbitMQ weg) |
| `GET /status` | – | batu-Health, RabbitMQ, wartende Aufträge und Consumer auf `recipe.requests` |
| `POST /api/orders` | ✔ | Plan über die Queue bestellen → `202` (oder `503`, wenn RabbitMQ fehlt) |
| `GET /api/orders`, `GET /api/orders/:id` | ✔ | eigene Bestellungen und ihr Status |

`POST /api/orders`:

```json
{ "request_id": "<uuid aus dem Browser>", "days": 5, "servings": 2,
  "exclusions": { "tags": ["fleisch"], "ingredients": ["Erdnuss"] }, "start_date": "2026-10-26" }
```

Status: `sending` → `queued` (liegt in RabbitMQ) → `done` / `failed`; `send_failed`, wenn der Broker nicht bestätigt hat.

## Umgesetzte Kriterien

- **Kontrakte (2):** Eigene DTOs in `src/messages.js`, gesendet wird `plan.create` im Format ab Vertrag 1.1 (`exclusions`, nicht mehr das veraltete `exclude`). Tolerant Reader für Antworten. `test/contract.test.js` prüft die echten Nachrichten gegen die JSON-Schemas im Shared-Repo.
- **Asynchron & Idempotenz (3):** Persistente Nachrichten, Publisher Confirms, durable Queue. rana wartet nie auf batu. Die `request_id` entsteht im Browser: Doppelklick oder erneutes Senden ist derselbe Auftrag. Doppelte Antworten werden ignoriert (`OrderStore.applyReply`), ACK erst nach Übernahme.
- **Security (4):** Login über Keycloak (Client `rana-web`, Code Flow + PKCE). `/api/*` prüft das JWT selbst (Signatur über JWKS, `iss`, `aud = rana-frontend`, `exp`) in `src/auth.js`.
- **Observability (5):** JSON-Logs im selben Format wie die batu_api (`span.correlation_id`). Jede Browser-Aktion bekommt eine eigene `x-correlation-id`. OpenTelemetry exportiert nach Jaeger; `traceparent` reist in der AMQP-Nachricht mit, rana und batu landen im selben Trace.
- **Resilienz (6):** Reconnect zu RabbitMQ alle 5 s, Publish mit Timeout, `503` statt Hängen, `/health` meldet `degraded`. Der synchrone Weg läuft unabhängig weiter. Pro Instanz eine eigene Reply-Queue, deshalb lässt sich rana skalieren.
- **Deployment (8):** `Dockerfile` (non-root, Healthcheck), eigene CI (`.github/workflows/ci.yml`: Lint, Tests inkl. Contract-Tests, Image-Build).

## Starten

Im Gesamtsystem (empfohlen):

```shell
cd ../shared && podman compose up -d --build     # oder docker compose
```

Danach <http://localhost:3000>, Login `alice` / `alice` (oder `bob` / `bob`).

Lokal ohne Container (RabbitMQ, Keycloak und batu-api laufen über Compose):

```shell
npm ci
npm run dev
```

| Variable | Default | Bedeutung |
|---|---|---|
| `PORT` | `3000` | |
| `AMQP_ADDR` | `amqp://guest:guest@localhost:5672/%2f` | RabbitMQ |
| `BATU_API_URL` | `http://localhost:8080` | batu-api aus Sicht des **Browsers** |
| `BATU_INTERNAL_URL` | = `BATU_API_URL` | batu-api aus Sicht des Servers (nur für `/status`) |
| `OIDC_ISSUER` | `http://localhost:8180/realms/m321` | muss zu `iss` passen |
| `OIDC_JWKS_URL` | `…/protocol/openid-connect/certs` | im Container über `keycloak:8080` |
| `OIDC_CLIENT_ID` / `OIDC_AUDIENCE` | `rana-web` / `rana-frontend` | Login-Client / erwartete `aud` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | – | z. B. `http://jaeger:4318`; leer = kein Tracing |
| `JAEGER_UI_URL` | `http://localhost:16686` | Links in der UI |

## Entwickeln

```shell
npm run lint
npm test                                   # Kontrakte aus ../shared/contracts
CONTRACTS_DIR=/pfad/zu/contracts npm test
```

| Datei | Inhalt |
|---|---|
| `server.js` | Start, Graceful Shutdown |
| `src/app.js` | HTTP-Routen |
| `src/broker.js` | RabbitMQ: Publish mit Confirm, Reply-Consumer, Reconnect |
| `src/messages.js` | DTOs/Validierung nach AsyncAPI |
| `src/orders.js` | Bestellstatus im Speicher, idempotent |
| `src/auth.js` | JWT-Prüfung (Keycloak) |
| `src/log.js` | JSON-Logs, Correlation-ID |
| `src/telemetry.js` | OpenTelemetry → Jaeger |
| `public/app.js` | Browser-App (Keycloak-Login, beide Wege, Status, Vorgänge) |
