'use strict';
/**
 * Auftraege, die ueber die Queue laufen, im Speicher dieser Instanz.
 *
 * Absichtlich kein eigener Datenspeicher: Die Plaene gehoeren der batu_api
 * (dort persistent unter ihrer ID). rana merkt sich nur den Status der
 * eigenen offenen Auftraege fuer die Anzeige -- nach einem Neustart sind
 * diese Eintraege weg, der Plan selbst nicht.
 */
const MAX_ORDERS = 500;

class OrderStore {
  constructor() {
    this.orders = new Map();
  }

  get(requestId) {
    return this.orders.get(requestId) || null;
  }

  /** Neuer Auftrag, Status `sending` bis der Broker ihn bestaetigt hat. */
  create({ requestId, correlationId, owner, request, traceId }) {
    const now = new Date().toISOString();
    const order = {
      request_id: requestId,
      correlation_id: correlationId,
      trace_id: traceId || null,
      owner,
      status: 'sending',
      request,
      plan: null,
      error: null,
      processed_by: null,
      created_at: now,
      updated_at: now,
    };
    this.orders.set(requestId, order);
    this.evict();
    return order;
  }

  /** Broker hat den Auftrag uebernommen: er wartet jetzt in der Queue. */
  markQueued(requestId) {
    return this.update(requestId, { status: 'queued' });
  }

  /** Publizieren fehlgeschlagen: der Browser darf mit derselben request_id erneut senden. */
  markSendFailed(requestId, message) {
    return this.update(requestId, { status: 'send_failed', error: message });
  }

  /**
   * Antwort der batu_api uebernehmen. Idempotent: Eine zweite Antwort zum
   * selben Auftrag (at-least-once-Zustellung) aendert nichts mehr.
   *
   * @returns {'applied'|'duplicate'|'unknown'}
   */
  applyReply(reply) {
    const order = this.orders.get(reply.requestId);
    if (!order) return 'unknown';
    if (order.status === 'done' || order.status === 'failed') return 'duplicate';
    this.update(reply.requestId, {
      status: reply.status === 'ok' ? 'done' : 'failed',
      plan: reply.plan,
      error: reply.error,
      processed_by: reply.processedBy,
    });
    return 'applied';
  }

  listFor(owner) {
    return [...this.orders.values()]
      .filter((o) => o.owner === owner)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 50);
  }

  update(requestId, fields) {
    const order = this.orders.get(requestId);
    if (!order) return null;
    Object.assign(order, fields, { updated_at: new Date().toISOString() });
    return order;
  }

  evict() {
    while (this.orders.size > MAX_ORDERS) {
      this.orders.delete(this.orders.keys().next().value);
    }
  }
}

/** Sicht nach aussen: ohne `owner`. */
function toView(order) {
  const { owner: _owner, ...view } = order;
  return view;
}

module.exports = { OrderStore, toView };
