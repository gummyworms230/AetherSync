/**
 * Server Node - Distributed WebSocket & State Engine instance
 */

import express from 'express';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RgaSequence } from '../crdt/rga.js';
import { LwwMap } from '../crdt/lww-map.js';
import { DistributedEventBus } from '../event-bus/event-bus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class Room {
  constructor(roomId, eventBus, nodeId) {
    this.roomId = roomId;
    this.eventBus = eventBus;
    this.nodeId = nodeId;
    this.channel = `collab:room:${roomId}`;

    this.rga = new RgaSequence(`server-${nodeId}`);
    this.canvasMap = new LwwMap(`server-${nodeId}`);
    this.clients = new Set(); // Set of WebSocket instances
    this.userPresence = new Map(); // clientId -> { name, color, cursor, activeTab }

    // Seed room with initial welcome content if blank
    this._initInitialState();

    // Subscribe to distributed event bus
    this.eventBus.subscribe(this.channel, (message) => {
      this._handleBusMessage(message);
    });
  }

  _initInitialState() {
    const welcomeText = `// Distributed Real-Time Collaboration Engine\n// CRDT (RGA + LWW-Map) with Multi-Node Redis Sync\n\nfunction calculateConsensus(replicas) {\n  console.log("Achieving strong eventual consistency...");\n  return replicas.every(r => r.isConverged);\n}\n\n// Edit simultaneously with concurrent users!`;
    for (let i = 0; i < welcomeText.length; i++) {
      this.rga.insert(i, welcomeText[i]);
    }

    // Initial canvas items
    this.canvasMap.set('card-welcome', {
      id: 'card-welcome',
      type: 'card',
      title: 'Distributed State Sync',
      text: 'Horizontal scaling via Redis Pub/Sub across port 4001 & 4002.',
      x: 60,
      y: 80,
      color: '#3b82f6'
    });

    this.canvasMap.set('card-crdt', {
      id: 'card-crdt',
      type: 'card',
      title: 'CRDT Math Guarantee',
      text: 'RGA sequence for text & LWW-Map with Lamport clocks.',
      x: 380,
      y: 120,
      color: '#10b981'
    });
  }

  addClient(ws, clientId) {
    this.clients.add(ws);
    ws.roomId = this.roomId;
    ws.clientId = clientId;

    // Send initial full snapshot
    this.sendToClient(ws, {
      type: 'sync_full',
      nodeId: this.nodeId,
      roomId: this.roomId,
      clientId,
      snapshot: {
        rga: this.rga.getStateSnapshot(),
        canvas: this.canvasMap.getStateSnapshot(),
        presence: Object.fromEntries(this.userPresence.entries())
      }
    });

    // Notify all nodes about user presence
    this.broadcastPresence();
  }

  removeClient(ws) {
    this.clients.delete(ws);
    if (ws.clientId) {
      this.userPresence.delete(ws.clientId);
      this.broadcastPresence();
    }
  }

  handleClientMessage(ws, data) {
    switch (data.type) {
      case 'ping': {
        this.sendToClient(ws, { type: 'pong', timestamp: data.timestamp });
        break;
      }

      case 'mutation': {
        const { opId, op } = data;
        let applied = false;

        if (op.type === 'rga_insert') {
          applied = this.rga.applyRemoteInsert(op);
        } else if (op.type === 'rga_delete') {
          applied = this.rga.applyRemoteDelete(op);
        } else if (op.type === 'lww_set' || op.type === 'lww_delete') {
          applied = this.canvasMap.applyRemoteOp(op);
        }

        // Send ACK back to the author client immediately
        this.sendToClient(ws, {
          type: 'ack',
          opId,
          applied
        });

        // Broadcast to all other local clients on this node
        this.broadcastLocal(ws, {
          type: 'mutation',
          op
        });

        // Publish to Event Bus for other server nodes in the cluster
        this.eventBus.publish(this.channel, {
          type: 'mutation',
          op,
          senderClientId: ws.clientId
        });

        break;
      }

      case 'presence_update': {
        this.userPresence.set(ws.clientId, data.presence);
        this.broadcastPresence();
        break;
      }

      case 'offline_catchup': {
        // Client reconnected with a batch of pending mutations
        const { mutations } = data;
        const ackedIds = [];

        if (Array.isArray(mutations)) {
          for (const item of mutations) {
            const { opId, op } = item;
            if (op.type === 'rga_insert') {
              this.rga.applyRemoteInsert(op);
            } else if (op.type === 'rga_delete') {
              this.rga.applyRemoteDelete(op);
            } else if (op.type === 'lww_set' || op.type === 'lww_delete') {
              this.canvasMap.applyRemoteOp(op);
            }
            ackedIds.push(opId);

            // Broadcast to peers
            this.broadcastLocal(ws, { type: 'mutation', op });
            this.eventBus.publish(this.channel, {
              type: 'mutation',
              op,
              senderClientId: ws.clientId
            });
          }
        }

        // Return batch ACK and fresh sync snapshot
        this.sendToClient(ws, {
          type: 'batch_ack',
          ackedIds,
          snapshot: {
            rga: this.rga.getStateSnapshot(),
            canvas: this.canvasMap.getStateSnapshot(),
            presence: Object.fromEntries(this.userPresence.entries())
          }
        });
        break;
      }
    }
  }

  _handleBusMessage(message) {
    if (message.type === 'mutation') {
      const { op, senderClientId } = message;

      if (op.type === 'rga_insert') {
        this.rga.applyRemoteInsert(op);
      } else if (op.type === 'rga_delete') {
        this.rga.applyRemoteDelete(op);
      } else if (op.type === 'lww_set' || op.type === 'lww_delete') {
        this.canvasMap.applyRemoteOp(op);
      }

      // Fan out to local clients
      for (const client of this.clients) {
        if (client.clientId !== senderClientId) {
          this.sendToClient(client, {
            type: 'mutation',
            op
          });
        }
      }
    } else if (message.type === 'presence') {
      // Merge remote presence
      for (const [id, pres] of Object.entries(message.presence || {})) {
        this.userPresence.set(id, pres);
      }
      for (const client of this.clients) {
        this.sendToClient(client, {
          type: 'presence',
          presence: Object.fromEntries(this.userPresence.entries())
        });
      }
    }
  }

  broadcastPresence() {
    const presenceObj = Object.fromEntries(this.userPresence.entries());
    const payload = {
      type: 'presence',
      presence: presenceObj
    };

    for (const client of this.clients) {
      this.sendToClient(client, payload);
    }

    this.eventBus.publish(this.channel, payload);
  }

  broadcastLocal(excludeWs, data) {
    for (const client of this.clients) {
      if (client !== excludeWs) {
        this.sendToClient(client, data);
      }
    }
  }

  sendToClient(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }
}

export class ServerNode {
  constructor(options = {}) {
    this.port = options.port || 4001;
    this.nodeId = options.nodeId || `node-${this.port}`;
    this.peerPort = options.peerPort || (this.port === 4001 ? 4002 : 4001);
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    this.eventBus = new DistributedEventBus({ nodeId: this.nodeId });
    this.rooms = new Map(); // roomId -> Room
  }

  async start() {
    await this.eventBus.init();

    // Serve public static assets
    const publicPath = path.resolve(__dirname, '../../public');
    this.app.use(express.static(publicPath, { index: 'index.html' }));

    // Explicit root route — Safari on iOS requires this fallback
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(publicPath, 'index.html'));
    });

    // Catch-all SPA fallback for any unknown paths
    this.app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.includes('.')) {
        res.sendFile(path.join(publicPath, 'index.html'));
      } else {
        next();
      }
    });

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', nodeId: this.nodeId, port: this.port });
    });

    // Cluster metadata endpoint
    this.app.get('/api/node-info', (req, res) => {
      res.json({
        nodeId: this.nodeId,
        port: this.port,
        peerPort: this.peerPort,
        redisActive: this.eventBus.isUsingRedis(),
        activeConnections: this.wss.clients.size,
        activeRooms: this.rooms.size
      });
    });

    // WebSocket connection handler
    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const roomId = url.searchParams.get('room') || 'general';
      const clientId = url.searchParams.get('clientId') || `client_${Math.random().toString(36).slice(2, 8)}`;

      if (!this.rooms.has(roomId)) {
        this.rooms.set(roomId, new Room(roomId, this.eventBus, this.nodeId));
      }
      const room = this.rooms.get(roomId);
      room.addClient(ws, clientId);

      ws.on('message', (message) => {
        try {
          const parsed = JSON.parse(message.toString());
          room.handleClientMessage(ws, parsed);
        } catch (e) {
          console.error(`[${this.nodeId}] Invalid JSON received:`, e);
        }
      });

      ws.on('close', () => {
        room.removeClient(ws);
      });

      ws.on('error', (err) => {
        console.error(`[${this.nodeId}] WS Error:`, err);
      });
    });

    return new Promise((resolve) => {
      this.server.listen(this.port, '0.0.0.0', () => {
        console.log(`[${this.nodeId}] 🌐 Server running at http://localhost:${this.port} (0.0.0.0:${this.port})`);
        resolve(this);
      });
    });
  }

  async stop() {
    return new Promise((resolve) => {
      this.wss.close(() => {
        this.server.close(() => resolve());
      });
    });
  }
}
