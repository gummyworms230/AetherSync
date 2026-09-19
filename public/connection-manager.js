/**
 * Connection State Manager
 * 
 * Manages WebSocket connection lifecycle, exponential backoff reconnects,
 * heartbeat latency pings, optimistic local mutation queueing,
 * and chaos network simulation (latency injection, packet dropping, socket dropouts).
 */

export class ConnectionManager {
  constructor(options = {}) {
    this.siteId = options.siteId || `user_${Math.random().toString(36).substring(2, 7)}`;
    // iOS Safari can return '' for window.location.port even with explicit ports.
    // Parse it from the full URL as a reliable fallback.
    const _detectedPort = window.location.port ||
      (window.location.href.match(/:(\d+)(?:\/|$|\?)/) || [])[1] || '4001';
    this.serverPort = options.serverPort || _detectedPort;
    this.roomId = options.roomId || 'general';

    this.state = 'DISCONNECTED'; // CONNECTED, CONNECTING, RECONNECTING, OFFLINE
    this.ws = null;
    this.seq = 0;
    this.pendingMutationQueue = []; // Array of { opId, op, timestamp, retries }
    this.eventListeners = new Map();

    // Reconnection parameters (exponential backoff with jitter)
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 30;
    this.baseDelay = 800; // ms
    this.maxDelay = 10000; // ms
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.currentLatency = 0; // ms RTT

    // Network Chaos Simulator parameters
    this.artificialLatencyMs = 0;
    this.packetDropRate = 0; // 0.0 to 1.0
    this.forcedDisconnect = false;

    // Load any persisted uncommitted mutations from localStorage
    this._loadPersistedQueue();
  }

  on(event, handler) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event).add(handler);
  }

  emit(event, data) {
    const handlers = this.eventListeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (err) {
          console.error(`Error in event listener for ${event}:`, err);
        }
      }
    }
  }

  setState(newState) {
    if (this.state !== newState) {
      this.state = newState;
      this.emit('state_change', {
        state: this.state,
        queuedCount: this.pendingMutationQueue.length,
        latency: this.currentLatency
      });
    }
  }

  connect(targetPort = null) {
    if (targetPort) {
      this.serverPort = targetPort;
    }
    this.forcedDisconnect = false;
    this.setState('CONNECTING');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname || 'localhost';
    const wsUrl = `${protocol}//${host}:${this.serverPort}?room=${this.roomId}&clientId=${this.siteId}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.setState('CONNECTED');
        this.emit('connected', { port: this.serverPort });
        this._startHeartbeat();

        // Flush any pending mutations accumulated while offline
        this._flushPendingQueue();
      };

      this.ws.onmessage = (event) => {
        this._handleIncomingRawMessage(event.data);
      };

      this.ws.onclose = () => {
        this._cleanupSocket();
        if (!this.forcedDisconnect) {
          this.setState('RECONNECTING');
          this._scheduleReconnect();
        } else {
          this.setState('OFFLINE');
        }
      };

      this.ws.onerror = (err) => {
        console.warn('[ConnectionManager] WebSocket error:', err);
      };
    } catch (err) {
      console.error('[ConnectionManager] Failed to construct WebSocket:', err);
      this._scheduleReconnect();
    }
  }

  disconnect() {
    this.forcedDisconnect = true;
    this._cleanupSocket();
    this.setState('OFFLINE');
  }

  switchNode(newPort) {
    this.disconnect();
    this.connect(newPort);
  }

  _cleanupSocket() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setState('OFFLINE');
      console.warn('[ConnectionManager] Max reconnect attempts reached.');
      return;
    }

    this.reconnectAttempts++;
    // Exponential backoff + jitter
    const delay = Math.min(
      this.maxDelay,
      this.baseDelay * Math.pow(1.5, this.reconnectAttempts) + Math.random() * 400
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  _startHeartbeat() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.state === 'CONNECTED' && this.ws?.readyState === WebSocket.OPEN) {
        this.sendRaw({
          type: 'ping',
          timestamp: Date.now()
        });
      }
    }, 3000);
  }

  /**
   * Submit a local mutation:
   * 1. Generates monotonic opId
   * 2. Pushes to pendingMutationQueue (optimistic tracking)
   * 3. Sends immediately over socket if connected (or queues for reconnect)
   */
  submitMutation(op) {
    this.seq++;
    const opId = `${this.siteId}_${this.seq}_${Date.now()}`;
    const queuedItem = {
      opId,
      op,
      timestamp: Date.now(),
      retries: 0
    };

    this.pendingMutationQueue.push(queuedItem);
    this._persistQueue();

    this.emit('queue_updated', {
      queue: this.pendingMutationQueue,
      count: this.pendingMutationQueue.length
    });

    if (this.state === 'CONNECTED' && this.ws?.readyState === WebSocket.OPEN) {
      this._dispatchMutation(queuedItem);
    }

    return opId;
  }

  _dispatchMutation(queuedItem) {
    this.sendRaw({
      type: 'mutation',
      opId: queuedItem.opId,
      op: queuedItem.op
    });
  }

  /**
   * Flush pending mutations on reconnect / recovery
   */
  _flushPendingQueue() {
    if (this.pendingMutationQueue.length === 0) return;

    // Send as batch catchup message to server
    this.sendRaw({
      type: 'offline_catchup',
      mutations: this.pendingMutationQueue.map(item => ({
        opId: item.opId,
        op: item.op
      }))
    });
  }

  /**
   * Handles incoming WebSocket messages with chaos network simulation hooks
   */
  _handleIncomingRawMessage(rawData) {
    // Chaos simulation: Packet loss check
    if (this.packetDropRate > 0 && Math.random() < this.packetDropRate) {
      this.emit('chaos_event', { type: 'packet_dropped', direction: 'inbound' });
      return; // simulate dropped inbound packet
    }

    const deliver = () => {
      try {
        const msg = JSON.parse(rawData);
        this._processMessage(msg);
      } catch (e) {
        console.error('[ConnectionManager] Bad message payload:', e);
      }
    };

    // Chaos simulation: Artificial latency
    if (this.artificialLatencyMs > 0) {
      setTimeout(deliver, this.artificialLatencyMs);
    } else {
      deliver();
    }
  }

  _processMessage(msg) {
    switch (msg.type) {
      case 'pong': {
        const rtt = Date.now() - msg.timestamp;
        this.currentLatency = rtt;
        this.emit('latency', { rtt });
        break;
      }

      case 'ack': {
        // Remove from pendingMutationQueue
        const index = this.pendingMutationQueue.findIndex(item => item.opId === msg.opId);
        if (index !== -1) {
          this.pendingMutationQueue.splice(index, 1);
          this._persistQueue();
          this.emit('queue_updated', {
            queue: this.pendingMutationQueue,
            count: this.pendingMutationQueue.length
          });
        }
        break;
      }

      case 'batch_ack': {
        const ackedSet = new Set(msg.ackedIds || []);
        this.pendingMutationQueue = this.pendingMutationQueue.filter(item => !ackedSet.has(item.opId));
        this._persistQueue();
        this.emit('queue_updated', {
          queue: this.pendingMutationQueue,
          count: this.pendingMutationQueue.length
        });

        if (msg.snapshot) {
          this.emit('sync_full', msg.snapshot);
        }
        break;
      }

      case 'sync_full': {
        this.emit('sync_full', msg.snapshot);
        break;
      }

      case 'mutation': {
        this.emit('remote_mutation', msg.op);
        break;
      }

      case 'presence': {
        this.emit('presence', msg.presence);
        break;
      }
    }
  }

  /**
   * Send data through WebSocket applying chaos hooks (latency, packet drop)
   */
  sendRaw(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    if (this.packetDropRate > 0 && Math.random() < this.packetDropRate) {
      this.emit('chaos_event', { type: 'packet_dropped', direction: 'outbound' });
      return; // simulate dropped outbound packet
    }

    const payload = JSON.stringify(data);
    if (this.artificialLatencyMs > 0) {
      setTimeout(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(payload);
        }
      }, this.artificialLatencyMs);
    } else {
      this.ws.send(payload);
    }
  }

  sendPresence(presenceData) {
    this.sendRaw({
      type: 'presence_update',
      presence: presenceData
    });
  }

  // Persistence helpers
  _persistQueue() {
    try {
      localStorage.setItem(`collab_queue_${this.roomId}`, JSON.stringify(this.pendingMutationQueue));
    } catch (e) {}
  }

  _loadPersistedQueue() {
    try {
      const data = localStorage.getItem(`collab_queue_${this.roomId}`);
      if (data) {
        this.pendingMutationQueue = JSON.parse(data);
      }
    } catch (e) {
      this.pendingMutationQueue = [];
    }
  }
}
