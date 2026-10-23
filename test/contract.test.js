'use strict';
/**
 * Contract-Test: Die Nachrichten, die rana wirklich sendet, muessen zum
 * AMQP-Kontrakt der batu_api passen (shared/contracts, JSON Schema).
 *
 * CONTRACTS_DIR zeigt auf `shared/contracts` (Standard: ../shared/contracts).
 * Fehlt der Ordner, wird uebersprungen -- ausser REQUIRE_CONTRACTS=1 (CI).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { parseOrder, toPlanCreate, parseReply } = require('../src/messages');

const contractsDir = process.env.CONTRACTS_DIR || path.join(__dirname, '..', '..', 'shared', 'contracts');
const schemaDir = path.join(contractsDir, 'recipe-planner', 'schemas');
const available = fs.existsSync(schemaDir);

if (!available && process.env.REQUIRE_CONTRACTS === '1') {
  throw new Error(`Kontrakte fehlen unter ${schemaDir}`);
}

function validator(file) {
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  return ajv.compile(JSON.parse(fs.readFileSync(path.join(schemaDir, file), 'utf8')));
}

test('plan.create von rana erfuellt request.schema.json', { skip: !available && 'Kontrakte nicht gefunden' }, () => {
  const validate = validator('request.schema.json');
  const variants = [
    { request_id: crypto.randomUUID(), days: 1, servings: 1 },
    { request_id: crypto.randomUUID(), days: 7, servings: 4, exclusions: { tags: ['fleisch'], ingredients: ['Erdnuss'] }, start_date: '2026-10-26' },
  ];
  for (const body of variants) {
    const message = toPlanCreate(parseOrder(body), 'contract-test');
    assert.ok(validate(message), JSON.stringify(validate.errors));
  }
});

test('Beispielantwort aus dem Kontrakt ist fuer rana lesbar', { skip: !available && 'Kontrakte nicht gefunden' }, () => {
  const validate = validator('response.schema.json');
  const sample = {
    request_id: crypto.randomUUID(),
    correlation_id: 'contract-test',
    status: 'ok',
    plan: {
      id: crypto.randomUUID(),
      created_at: '2026-10-23T10:00:00Z',
      servings: 2,
      days: [],
      shopping_list: [],
    },
    processed_by: { service: 'batu-api', version: '1.2.0', instance: 'test' },
  };
  const error = { request_id: crypto.randomUUID(), correlation_id: 'contract-test', status: 'error', error: 'days muss >= 1 sein' };
  for (const message of [sample, error]) {
    // Erst sicherstellen, dass das Beispiel selbst kontraktkonform ist ...
    assert.ok(validate(message), JSON.stringify(validate.errors));
    // ... dann, dass rana es lesen kann.
    const reply = parseReply(Buffer.from(JSON.stringify(message)));
    assert.ok(reply);
    assert.equal(reply.status, message.status);
  }
});
