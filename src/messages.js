'use strict';
/**
 * DTOs fuer die AMQP-Schnittstelle zum Rezept-Planer, umgesetzt nach
 * `shared/contracts/recipe-planner/asyncapi.yaml` (Vertrag 1.2).
 *
 * Bewusst eigene, kleine Abbildung statt geteilter Klassen: rana kennt nur
 * die Felder, die es braucht (Tolerant Reader), und schickt `plan.create`
 * im neuen Format mit `exclusions` (nicht mehr das veraltete `exclude`).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

class ValidationError extends Error {}

function stringList(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 50) throw new ValidationError(`${field} muss eine Liste (max. 50) sein.`);
  return [...new Set(value.map((v) => String(v).trim()).filter(Boolean))];
}

function intInRange(value, field, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(`${field} muss eine ganze Zahl zwischen ${min} und ${max} sein.`);
  }
  return value;
}

/**
 * Body von `POST /api/orders` → validierter Auftrag. Die `request_id` kommt
 * vom Browser: Schickt er denselben Auftrag nach einem Fehler nochmals, bleibt
 * es derselbe Auftrag (Idempotenz ueber die ganze Kette).
 */
function parseOrder(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('Ungueltiger Body.');
  if (typeof body.request_id !== 'string' || !UUID.test(body.request_id)) {
    throw new ValidationError('request_id muss eine UUID sein.');
  }
  const order = {
    requestId: body.request_id.toLowerCase(),
    days: intInRange(body.days, 'days', 1, 31),
    servings: intInRange(body.servings, 'servings', 1, 100),
    exclusions: {
      tags: stringList(body.exclusions && body.exclusions.tags, 'exclusions.tags'),
      ingredients: stringList(body.exclusions && body.exclusions.ingredients, 'exclusions.ingredients'),
    },
    startDate: null,
  };
  if (body.start_date !== undefined && body.start_date !== null && body.start_date !== '') {
    const valid = typeof body.start_date === 'string' && DATE.test(body.start_date) &&
      new Date(`${body.start_date}T00:00:00Z`).toISOString().startsWith(body.start_date);
    if (!valid) throw new ValidationError('start_date muss ein Datum im Format JJJJ-MM-TT sein.');
    order.startDate = body.start_date;
  }
  return order;
}

/** Auftrag → Nachricht `plan.create` fuer die Queue `recipe.requests`. */
function toPlanCreate(order, correlationId) {
  const message = {
    type: 'plan.create',
    request_id: order.requestId,
    correlation_id: correlationId,
    days: order.days,
    servings: order.servings,
    exclusions: order.exclusions,
  };
  if (order.startDate) message.start_date = order.startDate;
  return message;
}

/**
 * Antwort aus der Reply-Queue lesen. Tolerant Reader: nur `request_id` und
 * `status` sind Pflicht, unbekannte Felder werden ignoriert.
 */
function parseReply(buffer) {
  let data;
  try {
    data = JSON.parse(buffer.toString('utf8'));
  } catch {
    return null;
  }
  if (!data || typeof data.request_id !== 'string' || !['ok', 'error'].includes(data.status)) return null;
  return {
    requestId: data.request_id.toLowerCase(),
    correlationId: typeof data.correlation_id === 'string' ? data.correlation_id : null,
    status: data.status,
    plan: data.plan && typeof data.plan === 'object' ? data.plan : null,
    error: typeof data.error === 'string' ? data.error : null,
    processedBy: data.processed_by && typeof data.processed_by === 'object' ? data.processed_by : null,
  };
}

module.exports = { parseOrder, toPlanCreate, parseReply, ValidationError };
