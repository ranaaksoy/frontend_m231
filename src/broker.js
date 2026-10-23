'use strict';
/**
 * RabbitMQ-Anbindung von rana-frontend (Producer + Antwort-Consumer).
 *
 *   rana ──plan.create──▶ recipe.requests ──▶ batu-api / batu-worker ×N
 *   rana ◀──Antwort───── rana.replies.<instanz> (reply_to)
 *
 * - **Entkopplung:** rana wartet nie auf batu. Ist batu gestoppt, nimmt die
 *   durable Queue den Auftrag an (persistente Nachricht, Publisher Confirm),
 *   und der Browser sieht "wartet in Queue". Die Antwort kommt, sobald batu
 *   wieder laeuft.
 * - **Idempotenz:** Die `request_id` stammt aus dem Browser. batu beantwortet
 *   eine wiederholte `request_id` mit der gespeicherten Antwort; rana selbst
 *   verwirft doppelte Antworten (`OrderStore.applyReply`).
 * - **Resilienz:** Faellt RabbitMQ aus, verbindet sich rana alle 5 s neu.
 *   Bis dahin lehnt `publish` sofort ab (503 statt Haengen), der synchrone
 *   Weg Browser → batu-api laeuft unabhaengig weiter.
 */
const amqp = require('amqplib');
const { EventEmitter } = require('node:events');
const config = require('./config');
const { logger, forCorrelation } = require('./log');
const { parseReply } = require('./messages');

class BrokerUnavailable extends Error {}

class Broker extends EventEmitter {
  /** @param {(reply: object) => string} onReply  liefert 'applied' | 'duplicate' | 'unknown' */
  constructor(onReply) {
    super();
    this.onReply = onReply;
    this.connection = null;
    this.publishChannel = null;
    this.stopped = false;
    this.timer = null;
  }

  get connected() {
    return this.publishChannel !== null;
  }

  start() {
    this.connect();
  }

  async connect() {
    if (this.stopped) return;
    const log = logger.child({ amqp: config.amqp.url.replace(/\/\/[^@]*@/, '//***@') });
    try {
      const connection = await amqp.connect(config.amqp.url, { clientProperties: { connection_name: `rana-frontend@${config.instance}` } });
      connection.on('error', (err) => log.warn({ error: err.message }, 'AMQP-Verbindungsfehler'));
      connection.on('close', () => this.onClosed());

      const publishChannel = await connection.createConfirmChannel();
      // Gleiche Deklaration wie die batu_api: so geht ein Auftrag auch dann
      // nicht verloren, wenn batu noch nie gestartet ist.
      await publishChannel.assertQueue(config.amqp.requestQueue, { durable: true });

      const consumeChannel = await connection.createChannel();
      await consumeChannel.prefetch(10);
      await consumeChannel.assertQueue(config.amqp.replyQueue, {
        durable: true,
        // Verwaiste Antwort-Queues alter Instanzen raeumt RabbitMQ nach 1 h ab.
        arguments: { 'x-expires': 60 * 60 * 1000 },
      });
      await consumeChannel.consume(config.amqp.replyQueue, (msg) => this.handleReply(consumeChannel, msg), { noAck: false });

      this.connection = connection;
      this.publishChannel = publishChannel;
      log.info({ reply_queue: config.amqp.replyQueue }, 'mit RabbitMQ verbunden');
      this.emit('up');
    } catch (err) {
      log.warn({ error: err.message, retry_in_ms: config.amqp.reconnectDelayMs }, 'RabbitMQ nicht erreichbar');
      this.scheduleReconnect();
    }
  }

  onClosed() {
    const wasConnected = this.connected;
    this.connection = null;
    this.publishChannel = null;
    if (this.stopped) return;
    if (wasConnected) {
      logger.warn({ retry_in_ms: config.amqp.reconnectDelayMs }, 'Verbindung zu RabbitMQ verloren');
      this.emit('down');
    }
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect();
    }, config.amqp.reconnectDelayMs);
  }

  handleReply(channel, msg) {
    if (!msg) return; // Consumer wurde vom Broker abgebrochen
    const reply = parseReply(msg.content);
    if (!reply) {
      // Nicht nach Vertrag: nicht endlos neu zustellen, sondern loggen und weg.
      logger.warn({ body: msg.content.toString('utf8').slice(0, 200) }, 'unlesbare Antwort verworfen');
      channel.ack(msg);
      return;
    }
    const log = forCorrelation(reply.correlationId || reply.requestId);
    const outcome = this.onReply(reply);
    if (outcome === 'duplicate') {
      log.info({ request_id: reply.requestId }, 'doppelte Antwort ignoriert (idempotent)');
    } else if (outcome === 'unknown') {
      log.warn({ request_id: reply.requestId }, 'Antwort zu unbekanntem Auftrag (z. B. nach Neustart)');
    } else {
      log.info({ request_id: reply.requestId, status: reply.status, processed_by: reply.processedBy }, 'Antwort erhalten');
    }
    // ACK erst, nachdem die Antwort uebernommen ist.
    channel.ack(msg);
  }

  /**
   * Auftrag in `recipe.requests` legen und auf das Publisher Confirm warten
   * (hoechstens `confirmTimeoutMs`). Wirft `BrokerUnavailable`, wenn RabbitMQ
   * nicht da ist oder nicht bestaetigt.
   */
  publish(message, correlationId) {
    const channel = this.publishChannel;
    if (!channel) return Promise.reject(new BrokerUnavailable('Message-Broker nicht erreichbar.'));

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new BrokerUnavailable('Message-Broker hat den Auftrag nicht bestaetigt.')),
        config.amqp.confirmTimeoutMs,
      );
      try {
        channel.sendToQueue(
          config.amqp.requestQueue,
          Buffer.from(JSON.stringify(message)),
          {
            persistent: true,
            contentType: 'application/json',
            messageId: message.request_id,
            correlationId,
            replyTo: config.amqp.replyQueue,
            appId: 'rana-frontend',
            // traceparent setzt die OpenTelemetry-Instrumentierung dazu.
            headers: { 'x-correlation-id': correlationId },
          },
          (err) => {
            clearTimeout(timer);
            if (err) reject(new BrokerUnavailable('Message-Broker hat den Auftrag abgelehnt.'));
            else resolve();
          },
        );
      } catch (err) {
        clearTimeout(timer);
        reject(new BrokerUnavailable(err.message));
      }
    });
  }

  /** Wartende Auftraege und Consumer auf `recipe.requests`, fuer die Status-Anzeige. */
  async queueStats() {
    if (!this.publishChannel) return null;
    try {
      const { messageCount, consumerCount } = await this.publishChannel.checkQueue(config.amqp.requestQueue);
      return { waiting: messageCount, consumers: consumerCount };
    } catch {
      return null;
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.connection) {
      await this.connection.close().catch(() => {});
    }
  }
}

module.exports = { Broker, BrokerUnavailable };
