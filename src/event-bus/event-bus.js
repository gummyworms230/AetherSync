/**
 * Event Bus Layer
 * 
 * Supports Redis Pub/Sub for distributed horizontal WebSocket scaling,
 * with an automatic fallback to an in-memory Cluster Event Bus if Redis is not running.
 */

import EventEmitter from 'node:events';
import Redis from 'ioredis';

// Shared global emitter for in-process multi-node simulation
const clusterEmitter = new EventEmitter();
clusterEmitter.setMaxListeners(100);

export class DistributedEventBus {
  constructor(options = {}) {
    this.nodeId = options.nodeId || `node-${Math.floor(Math.random() * 1000)}`;
    this.redisUrl = options.redisUrl || process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    this.useRedis = false;
    this.subscribers = new Map(); // channel -> Set<callback>

    this.publisher = null;
    this.subscriber = null;
  }

  async init() {
    try {
      const pub = new Redis(this.redisUrl, {
        lazyConnect: true,
        connectTimeout: 800,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null // don't loop forever if no redis
      });
      pub.on('error', () => {}); // Catch connection refusal gracefully

      await pub.connect();
      const sub = pub.duplicate();
      sub.on('error', () => {}); // Catch connection refusal gracefully
      await sub.connect();

      this.publisher = pub;
      this.subscriber = sub;
      this.useRedis = true;

      this.subscriber.on('message', (channel, message) => {
        try {
          const parsed = JSON.parse(message);
          // Don't echo back to sender node
          if (parsed._originNodeId === this.nodeId) return;

          const handlers = this.subscribers.get(channel);
          if (handlers) {
            for (const handler of handlers) {
              handler(parsed.payload, channel);
            }
          }
        } catch (e) {
          console.error(`[${this.nodeId}] Failed parsing event bus message:`, e);
        }
      });

      console.log(`[${this.nodeId}] 🚀 Connected to Redis Pub/Sub at ${this.redisUrl}`);
    } catch (err) {
      this.useRedis = false;
      console.log(`[${this.nodeId}] ⚡ Redis not detected at ${this.redisUrl}. Using Embedded Cluster Bus.`);

      // Listen to clusterEmitter
      clusterEmitter.on('broadcast', (event) => {
        if (event.originNodeId === this.nodeId) return; // ignore own events
        const handlers = this.subscribers.get(event.channel);
        if (handlers) {
          for (const handler of handlers) {
            handler(event.payload, event.channel);
          }
        }
      });
    }
  }

  async publish(channel, payload) {
    if (this.useRedis && this.publisher) {
      const msg = JSON.stringify({
        _originNodeId: this.nodeId,
        payload
      });
      await this.publisher.publish(channel, msg);
    } else {
      clusterEmitter.emit('broadcast', {
        originNodeId: this.nodeId,
        channel,
        payload
      });
    }
  }

  async subscribe(channel, callback) {
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Set());
      if (this.useRedis && this.subscriber) {
        await this.subscriber.subscribe(channel);
      }
    }
    this.subscribers.get(channel).add(callback);
  }

  async unsubscribe(channel, callback) {
    const handlers = this.subscribers.get(channel);
    if (handlers) {
      handlers.delete(callback);
      if (handlers.size === 0) {
        this.subscribers.delete(channel);
        if (this.useRedis && this.subscriber) {
          await this.subscriber.unsubscribe(channel);
        }
      }
    }
  }

  isUsingRedis() {
    return this.useRedis;
  }
}
