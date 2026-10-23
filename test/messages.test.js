'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOrder, toPlanCreate, parseReply, ValidationError } = require('../src/messages');

const REQUEST_ID = '0b9c2d4e-1f3a-4b5c-8d6e-7f8091a2b3c4';

test('Bestellung wird zu plan.create im Format von Vertrag 1.1+ (exclusions)', () => {
  const order = parseOrder({
    request_id: REQUEST_ID,
    days: 3,
    servings: 2,
    exclusions: { tags: ['nuts', ' nuts ', ''], ingredients: ['Erdnuss'] },
    start_date: '2026-10-26',
  });
  const message = toPlanCreate(order, 'demo-1');
  assert.deepEqual(message, {
    type: 'plan.create',
    request_id: REQUEST_ID,
    correlation_id: 'demo-1',
    days: 3,
    servings: 2,
    exclusions: { tags: ['nuts'], ingredients: ['Erdnuss'] },
    start_date: '2026-10-26',
  });
  assert.equal('exclude' in message, false, 'das veraltete Feld exclude wird nicht mehr gesendet');
});

test('ungueltige Bestellungen werden abgelehnt', () => {
  const base = { request_id: REQUEST_ID, days: 3, servings: 2 };
  for (const bad of [
    { ...base, request_id: 'keine-uuid' },
    { ...base, days: 0 },
    { ...base, days: 32 },
    { ...base, servings: 1.5 },
    { ...base, start_date: '2026-02-30' },
    { ...base, exclusions: { tags: 'nuts' } },
    [],
    null,
  ]) {
    assert.throws(() => parseOrder(bad), ValidationError, JSON.stringify(bad));
  }
});

test('Antwort: Tolerant Reader ignoriert unbekannte Felder', () => {
  const reply = parseReply(Buffer.from(JSON.stringify({
    request_id: REQUEST_ID.toUpperCase(),
    correlation_id: 'demo-1',
    status: 'ok',
    plan: { id: 'x', days: [] },
    processed_by: { service: 'batu-api', version: '1.2.0', instance: 'abc' },
    neues_feld_aus_vertrag_9: true,
  })));
  assert.equal(reply.requestId, REQUEST_ID);
  assert.equal(reply.status, 'ok');
  assert.deepEqual(reply.processedBy, { service: 'batu-api', version: '1.2.0', instance: 'abc' });
});

test('Antwort ohne Pflichtfelder oder kein JSON → null', () => {
  assert.equal(parseReply(Buffer.from('{ kein json')), null);
  assert.equal(parseReply(Buffer.from(JSON.stringify({ status: 'ok' }))), null);
  assert.equal(parseReply(Buffer.from(JSON.stringify({ request_id: REQUEST_ID, status: 'vielleicht' }))), null);
});
