import amqplib, { type Channel, type ChannelModel } from "amqplib";
import type { AppEnv } from "../../config/env.js";

export const DOMAIN_EXCHANGE = "greefon.domain";

export type DomainEventName =
  | "chat.discovered"
  | "knowledge.changed"
  | "message.sent"
  | "org.synced";

export type DomainEvent<T extends Record<string, unknown> = Record<string, unknown>> = {
  name: DomainEventName;
  occurredAt: string;
  payload: T;
};

export class RabbitEventBus {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private offline = false;
  private readonly localHandlers = new Map<string, Array<(event: DomainEvent) => Promise<void>>>();

  constructor(private readonly env: AppEnv) {}

  async connect(): Promise<void> {
    try {
      this.connection = await amqplib.connect(this.env.RABBITMQ_URL);
      this.channel = await this.connection.createChannel();
      await this.channel.assertExchange(DOMAIN_EXCHANGE, "topic", { durable: true });
      this.offline = false;
    } catch (error) {
      this.offline = true;
      console.warn("RabbitMQ недоступен, события идут локально.", error instanceof Error ? error.message : error);
    }
  }

  async publish<T extends Record<string, unknown>>(name: DomainEventName, payload: T): Promise<void> {
    const event: DomainEvent<T> = {
      name,
      occurredAt: new Date().toISOString(),
      payload,
    };
    if (this.offline || !this.channel) {
      const handlers = this.localHandlers.get(name) ?? [];
      await Promise.all(handlers.map((handler) => handler(event)));
      return;
    }
    this.channel.publish(DOMAIN_EXCHANGE, name, Buffer.from(JSON.stringify(event)), {
      contentType: "application/json",
      persistent: true,
    });
  }

  async consume(queue: string, routingKey: string, handler: (event: DomainEvent) => Promise<void>): Promise<void> {
    const existing = this.localHandlers.get(routingKey) ?? [];
    existing.push(handler);
    this.localHandlers.set(routingKey, existing);
    if (this.offline || !this.channel) {
      return;
    }
    await this.channel.assertQueue(queue, { durable: true });
    await this.channel.bindQueue(queue, DOMAIN_EXCHANGE, routingKey);
    await this.channel.consume(queue, async (msg) => {
      if (!msg || !this.channel) {
        return;
      }
      try {
        const event = JSON.parse(msg.content.toString()) as DomainEvent;
        await handler(event);
        this.channel.ack(msg);
      } catch {
        this.channel.nack(msg, false, false);
      }
    });
  }

  async close(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
    this.channel = null;
    this.connection = null;
  }
}
