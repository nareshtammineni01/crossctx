/**
 * Message Queue & Async Messaging Pattern Detector
 *
 * Scans source code for Kafka, RabbitMQ, SQS, Pub/Sub, Redis Pub/Sub, and NATS patterns.
 * Detects both publish and subscribe operations across multiple languages.
 */

import type { MessageEvent, MessagePattern } from "../types/index.js";

export function extractMessageEvents(
  fileContents: Map<string, string>,
  language: "java" | "csharp" | "python" | "typescript" | "go"
): MessageEvent[] {
  const events: MessageEvent[] = [];

  for (const [filePath, content] of fileContents) {
    switch (language) {
      case "java":
        events.push(...extractJavaMessageEvents(content, filePath));
        break;
      case "csharp":
        events.push(...extractCSharpMessageEvents(content, filePath));
        break;
      case "python":
        events.push(...extractPythonMessageEvents(content, filePath));
        break;
      case "typescript":
        events.push(...extractTypeScriptMessageEvents(content, filePath));
        break;
      case "go":
        events.push(...extractGoMessageEvents(content, filePath));
        break;
    }
  }

  return deduplicateEvents(events);
}

// ─────────────────────────────────────────────────────────────────────────────
// Java Message Patterns (Spring Kafka, Spring AMQP)
// ─────────────────────────────────────────────────────────────────────────────

function extractJavaMessageEvents(content: string, filePath: string): MessageEvent[] {
  const events: MessageEvent[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // @KafkaListener(topics = "orders.created")
    const kafkaListenerMatch = line.match(
      /@KafkaListener\s*\(\s*(?:topics|value)\s*=\s*["{]([^"}]+)["}]/i
    );
    if (kafkaListenerMatch) {
      const topics = kafkaListenerMatch[1].split(/[,\s]+/).filter(Boolean);
      for (const topic of topics) {
        events.push({
          topic: topic.replace(/^["']|["']$/g, "").trim(),
          direction: "subscribe",
          pattern: "kafka",
          sourceFile: filePath,
          line: lineNum,
        });
      }
    }

    // @RabbitListener(queues = "order-queue")
    const rabbitListenerMatch = line.match(
      /@RabbitListener\s*\(\s*(?:queues|value)\s*=\s*["{]([^"}]+)["}]/i
    );
    if (rabbitListenerMatch) {
      const queues = rabbitListenerMatch[1].split(/[,\s]+/).filter(Boolean);
      for (const queue of queues) {
        events.push({
          topic: queue.replace(/^["']|["']$/g, "").trim(),
          direction: "subscribe",
          pattern: "rabbitmq",
          sourceFile: filePath,
          line: lineNum,
        });
      }
    }

    // kafkaTemplate.send("orders.created", message) or send("orders.created", partition, message)
    const kafkaSendMatch = line.match(
      /kafkaTemplate\.send\s*\(\s*["']([^"']+)["']/i
    );
    if (kafkaSendMatch) {
      events.push({
        topic: kafkaSendMatch[1],
        direction: "publish",
        pattern: "kafka",
        sourceFile: filePath,
        line: lineNum,
      });
    }

    // rabbitTemplate.convertAndSend("orders.created", message) or convertAndSend(exchange, routingKey, message)
    const rabbitSendMatch = line.match(
      /rabbitTemplate\.convertAndSend\s*\(\s*["']([^"']+)["']/i
    );
    if (rabbitSendMatch) {
      events.push({
        topic: rabbitSendMatch[1],
        direction: "publish",
        pattern: "rabbitmq",
        sourceFile: filePath,
        line: lineNum,
      });
    }

    // rabbitTemplate.convertAndSend(exchange, routingKey, message)
    const rabbitExchangeMatch = line.match(
      /rabbitTemplate\.convertAndSend\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/i
    );
    if (rabbitExchangeMatch && !rabbitSendMatch) {
      events.push({
        topic: `${rabbitExchangeMatch[1]}:${rabbitExchangeMatch[2]}`,
        direction: "publish",
        pattern: "rabbitmq",
        sourceFile: filePath,
        line: lineNum,
      });
    }

    // @SendTo("orders.processed") on a method
    const sendToMatch = line.match(/@SendTo\s*\(\s*["']([^"']+)["']/i);
    if (sendToMatch) {
      events.push({
        topic: sendToMatch[1],
        direction: "publish",
        pattern: "kafka",
        sourceFile: filePath,
        line: lineNum,
      });
    }
  }

  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// C# Message Patterns (Kafka, RabbitMQ, MassTransit)
// ─────────────────────────────────────────────────────────────────────────────

function extractCSharpMessageEvents(content: string, filePath: string): MessageEvent[] {
  const events: MessageEvent[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // [EventSubscribe("OrderCreated")] or [Subscribe("OrderCreated")]
    const eventSubMatch = line.match(/\[(?:EventSubscribe|Subscribe)\s*\(\s*["']([^"']+)["']/i);
    if (eventSubMatch) {
      events.push({
        topic: eventSubMatch[1],
        direction: "subscribe",
        pattern: "kafka", // Could be inferred more specifically
        sourceFile: filePath,
        line: lineNum,
      });
    }

    // producer.ProduceAsync("orders.created", message)
    const kafkaProduceMatch = line.match(
      /producer\.ProduceAsync\s*\(\s*["']([^"']+)["']/i
    );
    if (kafkaProduceMatch) {
      events.push({
        topic: kafkaProduceMatch[1],
        direction: "publish",
        pattern: "kafka",
        sourceFile: filePath,
        line: lineNum,
      });
    }

    // channel.BasicPublish(exchange: "orders", routingKey: "created", ...)
    const basicPubMatch = line.match(
      /channel\.BasicPublish\s*\([^)]*exchange:\s*["']([^"']+)["']\s*,\s*routingKey:\s*["']([^"']+)["']/i
    );
    if (basicPubMatch) {
      events.push({
        topic: `${basicPubMatch[1]}:${basicPubMatch[2]}`,
        direction: "publish",
        pattern: "rabbitmq",
        sourceFile: filePath,
        line: lineNum,
      });
    }

    // channel.BasicConsume(queue: "order-queue", ...)
    const basicConsumeMatch = line.match(
      /channel\.BasicConsume\s*\([^)]*queue:\s*["']([^"']+)["']/i
    );
    if (basicConsumeMatch) {
      events.push({
        topic: basicConsumeMatch[1],
        direction: "subscribe",
        pattern: "rabbitmq",
        sourceFile: filePath,
        line: lineNum,
      });
    }

    // await _bus.Publish(new OrderCreatedEvent(...)) (MassTransit)
    const massTransitMatch = line.match(
      /\._?bus\.Publish\s*\(\s*new\s+(\w+)\s*\(/i
    );
    if (massTransitMatch) {
      const eventType = massTransitMatch[1];
      // Convert PascalCase to topic-name convention
      const topicName = eventType.replace(/([A-Z])/g, "-$1").toLowerCase().replace(/^-/, "");
      events.push({
        topic: topicName,
        direction: "publish",
        pattern: "rabbitmq",
        payloadType: eventType,
        sourceFile: filePath,
        line: lineNum,
      });
    }
  }

  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Python Message Patterns (Celery, confluent-kafka, pika)
// ─────────────────────────────────────────────────────────────────────────────

function extractPythonMessageEvents(content: string, filePath: string): MessageEvent[] {
  const events: MessageEvent[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // @app.task or @shared_task (Celery task definition)
    const celeryTaskMatch = line.match(/@(?:app\.task|shared_task)\b/);
    if (celeryTaskMatch) {
      // Try to get function name from next non-decorator line
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const nextLine = lines[j];
        const funcMatch = nextLine.match(/def\s+(\w+)\s*\(/);
        if (funcMatch) {
          events.push({
            topic: funcMatch[1],
            direction: "subscribe",
            pattern: "redis-pubsub",
            sourceFile: filePath,
            line: lineNum,
          });
          break;
        }
      }
    }

    // app.send_task("process_order", ...) (Celery task sending)
    const sendTaskMatch = line.match(/app\.send_task\s*\(\s*["']([^"']+)["']/);
    if (sendTaskMatch) {
      events.push({
        topic: sendTaskMatch[1],
        direction: "publish",
        pattern: "redis-pubsub",
        sourceFile: filePath,
        line: lineNum,
      });
    }

    // consumer.subscribe(["orders.created"]) (confluent-kafka)
    const kafkaSubMatch = line.match(
      /consumer\.subscribe\s*\(\s*\[\s*["']([^"']+)["']/
    );
    if (kafkaSubMatch) {
      events.push({
        topic: kafkaSubMatch[1],
        direction: "subscribe",
        pattern: "kafka",
        sourceFile: filePath,
        line: lineNum,
      });
    }

    // producer.produce("orders.created", value=...) (confluent-kafka)
    const kafkaProdMatch = line.match(
      /producer\.produce\s*\(\s*["']([^"']+)["']/
    );
    if (kafkaProdMatch) {
      events.push({
        topic: kafkaProdMatch[1],
        direction: "publish",
        pattern: "kafka",
        sourceFile: filePath,
        line: lineNum,
      });
    }

    // channel.basic_consume(queue="order-queue", ...) (pika / RabbitMQ)
    const basicConsumeMatch = line.match(
      /channel\.basic_consume\s*\(\s*queue\s*=\s*["']([^"']+)["']/
    );
    if (basicConsumeMatch) {
      events.push({
        topic: basicConsumeMatch[1],
        direction: "subscribe",
        pattern: "rabbitmq",
        sourceFile: filePath,
        line: lineNum,
      });
    }

    // channel.basic_publish(exchange="", routing_key="order-queue", ...) (pika / RabbitMQ)
    const basicPubMatch = line.match(
      /channel\.basic_publish\s*\(\s*exchange\s*=\s*["']([^"']+)["']\s*,\s*routing_key\s*=\s*["']([^"']+)["']/
    );
    if (basicPubMatch) {
      const exchange = basicPubMatch[1];
      const routingKey = basicPubMatch[2];
      events.push({
        topic: exchange ? `${exchange}:${routingKey}` : routingKey,
        direction: "publish",
        pattern: "rabbitmq",
        sourceFile: filePath,
        line: lineNum,
      });
    }
  }

  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// TypeScript/Node.js Message Patterns (NestJS, amqplib, kafkajs)
// ─────────────────────────────────────────────────────────────────────────────

function extractTypeScriptMessageEvents(content: string, filePath: string): MessageEvent[] {
  const events: MessageEvent[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // @EventPattern("orders.created") or @MessagePattern("orders.created") (NestJS)
    const eventPatternMatch = line.match(
      /@(?:EventPattern|MessagePattern)\s*\(\s*["']([^"']+)["']/
    );
    if (eventPatternMatch) {
      events.push({
        topic: eventPatternMatch[1],
        direction: "subscribe",
        pattern: "kafka",
        sourceFile: filePath,
        line: lineNum,
      });
    }

    // this.client.emit("orders.created", data) or this.client.emit({pattern: "orders.created"}, data)
    const emitMatch = line.match(
      /\.emit\s*\(\s*["']([^"']+)["']/
    );
    if (emitMatch && !line.includes("@EventPattern")) {
      events.push({
        topic: emitMatch[1],
        direction: "publish",
        pattern: "kafka",
        sourceFile: filePath,
        line: lineNum,
      });
    }

    // kafkaConsumer.subscribe({ topic: "orders.created" })
    const kafkaSubMatch = line.match(
      /kafkaConsumer\.subscribe\s*\(\s*\{\s*topic:\s*["']([^"']+)["']/
    );
    if (kafkaSubMatch) {
      events.push({
        topic: kafkaSubMatch[1],
        direction: "subscribe",
        pattern: "kafka",
        sourceFile: filePath,
        line: lineNum,
      });
    }

    // kafkaProducer.send({ topic: "orders.created", messages: [...] })
    const kafkaSendMatch = line.match(
      /kafkaProducer\.send\s*\(\s*\{\s*topic:\s*["']([^"']+)["']/
    );
    if (kafkaSendMatch) {
      events.push({
        topic: kafkaSendMatch[1],
        direction: "publish",
        pattern: "kafka",
        sourceFile: filePath,
        line: lineNum,
      });
    }

    // channel.consume("order-queue", ...) (amqplib)
    const consumeMatch = line.match(
      /channel\.consume\s*\(\s*["']([^"']+)["']/
    );
    if (consumeMatch) {
      events.push({
        topic: consumeMatch[1],
        direction: "subscribe",
        pattern: "rabbitmq",
        sourceFile: filePath,
        line: lineNum,
      });
    }

    // channel.sendToQueue("order-queue", ...) (amqplib)
    const sendToQueueMatch = line.match(
      /channel\.sendToQueue\s*\(\s*["']([^"']+)["']/
    );
    if (sendToQueueMatch) {
      events.push({
        topic: sendToQueueMatch[1],
        direction: "publish",
        pattern: "rabbitmq",
        sourceFile: filePath,
        line: lineNum,
      });
    }
  }

  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Go Message Patterns (sarama, amqp)
// ─────────────────────────────────────────────────────────────────────────────

function extractGoMessageEvents(content: string, filePath: string): MessageEvent[] {
  const events: MessageEvent[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // sarama.NewConsumer(...) with topics subscribed
    const saramaConsumerMatch = line.match(
      /consumer\.Topics\s*\(\s*\)\s*,.*topics.*\[/
    );
    if (saramaConsumerMatch) {
      // Look for topic strings in following lines
      for (let j = i; j < Math.min(i + 5, lines.length); j++) {
        const topicMatch = lines[j].match(/["']([^"']*\.[\w.-]+)["']/);
        if (topicMatch) {
          events.push({
            topic: topicMatch[1],
            direction: "subscribe",
            pattern: "kafka",
            sourceFile: filePath,
            line: j + 1,
          });
        }
      }
    }

    // producer.Input() <- &sarama.ProducerMessage{Topic: "orders.created"}
    const producerMatch = line.match(
      /Topic:\s*["']([^"']+)["']/
    );
    if (producerMatch && line.includes("ProducerMessage")) {
      events.push({
        topic: producerMatch[1],
        direction: "publish",
        pattern: "kafka",
        sourceFile: filePath,
        line: lineNum,
      });
    }

    // ch.Consume(q.Name, ...) (amqp)
    const amqpConsumeMatch = line.match(
      /ch\.Consume\s*\(\s*([^,]+)\s*,/
    );
    if (amqpConsumeMatch) {
      const queueVar = amqpConsumeMatch[1].trim();
      // Try to infer queue name from q.Name pattern
      if (queueVar.includes("q.Name") || queueVar.includes("queue.Name")) {
        events.push({
          topic: "queue",
          direction: "subscribe",
          pattern: "rabbitmq",
          sourceFile: filePath,
          line: lineNum,
        });
      }
    }

    // ch.Publish("", q.Name, ...) (amqp)
    const amqpPubMatch = line.match(
      /ch\.Publish\s*\(\s*["']([^"']*?)["']\s*,\s*([^,]+)/
    );
    if (amqpPubMatch) {
      const exchange = amqpPubMatch[1];
      const routingKey = amqpPubMatch[2].trim();
      events.push({
        topic: exchange || routingKey,
        direction: "publish",
        pattern: "rabbitmq",
        sourceFile: filePath,
        line: lineNum,
      });
    }
  }

  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deduplication
// ─────────────────────────────────────────────────────────────────────────────

function deduplicateEvents(events: MessageEvent[]): MessageEvent[] {
  const seen = new Set<string>();
  const unique: MessageEvent[] = [];

  for (const event of events) {
    const key = `${event.pattern}:${event.direction}:${event.topic}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(event);
    }
  }

  return unique;
}
