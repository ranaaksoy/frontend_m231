'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { OrderStore, toView } = require('../src/orders');

const reply = (status = 'ok') => ({
  requestId: 'r1',
  correlationId: 'c1',
  status,
  plan: status === 'ok' ? { id: 'p1' } : null,
  error: status === 'ok' ? null : 'days muss >= 1 sein',
  processedBy: { service: 'batu-api', version: '1.2.0', instance: 'w1' },
});

test('Antwort wird genau einmal uebernommen (idempotent)', () => {
  const store = new OrderStore();
  store.create({ requestId: 'r1', correlationId: 'c1', owner: 'alice', request: {} });
  store.markQueued('r1');

  assert.equal(store.applyReply(reply()), 'applied');
  assert.equal(store.get('r1').status, 'done');
  assert.equal(store.get('r1').processed_by.instance, 'w1');

  // Zweite Zustellung derselben Antwort, z. B. nach einem Neustart vor dem ACK.
  const second = { ...reply(), processedBy: { service: 'batu-api', version: '1.2.0', instance: 'w2' } };
  assert.equal(store.applyReply(second), 'duplicate');
  assert.equal(store.get('r1').processed_by.instance, 'w1', 'erste Antwort bleibt');
});

test('Antwort zu unbekanntem Auftrag', () => {
  const store = new OrderStore();
  assert.equal(store.applyReply(reply()), 'unknown');
});

test('fachlicher Fehler setzt Status failed', () => {
  const store = new OrderStore();
  store.create({ requestId: 'r1', correlationId: 'c1', owner: 'alice', request: {} });
  store.applyReply(reply('error'));
  assert.equal(store.get('r1').status, 'failed');
  assert.match(store.get('r1').error, /days/);
});

test('jede Person sieht nur eigene Auftraege, ohne owner-Feld', () => {
  const store = new OrderStore();
  store.create({ requestId: 'a', correlationId: 'c', owner: 'alice', request: {} });
  store.create({ requestId: 'b', correlationId: 'c', owner: 'bob', request: {} });
  const mine = store.listFor('alice');
  assert.deepEqual(mine.map((o) => o.request_id), ['a']);
  assert.equal('owner' in toView(mine[0]), false);
});
