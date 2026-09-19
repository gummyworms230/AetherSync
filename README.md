# ⚡ AetherSync: Distributed Real-Time Collaboration & State Sync Engine

A production-grade, distributed real-time collaborative workspace built from first principles to synchronize state across concurrent users with minimal latency and strong eventual consistency.

---

## 🌟 Core Architecture & Highlights

```
┌────────────────────────────────────────────────────────┐
│               Client Tier (Browsers)                   │
│   Client 1 (Alice)                  Client 2 (Bob)     │
│   - Optimistic CRDT State           - Optimistic CRDT  │
│   - Pending Mutation Queue          - Pending Queue    │
│   - Connection State Machine        - State Machine    │
└───────────────┬────────────────────────────┬───────────┘
                │ ws://:4001                 │ ws://:4002
┌───────────────▼──────────────┐ ┌───────────▼───────────┐
│       Node 1 (:4001)         │ │       Node 2 (:4002)  │
│  - WebSocket Gateway         │ │  - WebSocket Gateway  │
│  - CRDT Room State           │ │  - CRDT Room State    │
└───────────────┬──────────────┘ └───────────┬───────────┘
                │                            │
                └──────────────┬─────────────┘
                               │ Pub / Sub
                ┌──────────────▼─────────────┐
                │    Distributed Event Bus   │
                │  - Redis Pub/Sub (ioredis) │
                │  - Local Cluster Fallback  │
                └────────────────────────────┘
```

### 1. Conflict Resolution via CRDTs (Conflict-Free Replicated Data Types)
- **Replicated Growable Array (RGA)**:
  - Sequence CRDT for the collaborative text and code editor.
  - Every character is represented by a unique logical identifier: `siteId:lamportClock`.
  - Concurrent insertions at identical cursor indices are deterministically ordered without locking or data corruption.
  - Deletions utilize tombstones with garbage collection.
- **Last-Write-Wins Map (LWW-Map)**:
  - State-based CRDT with Lamport timestamps for whiteboard sticky notes, architecture cards, and user presence.
  - Eliminates merge conflicts when concurrent users move or edit cards simultaneously.

### 2. Resilient Connection State Manager
- **Connection Lifecycle State Machine**:
  - `CONNECTED` ↔ `CONNECTING` ↔ `RECONNECTING` ↔ `OFFLINE`.
  - Exponential backoff with jitter (`min: 800ms`, `max: 10,000ms`) prevents thundering herds on socket dropouts.
  - Heartbeat ping/pong measuring live Round-Trip Time (RTT) latency.
- **Optimistic Mutation Queue (`pendingMutationQueue`)**:
  - Outgoing edits are rendered locally with 0ms perceivable latency.
  - Assigned monotonic transaction IDs (`clientId_seq_timestamp`).
  - Held in memory and persisted in `localStorage`.
  - Automatically flushed and reconciled upon reconnection via batch catchup.
- **Network Chaos Simulator**:
  - Injects artificial latency (0–2000ms) and simulated packet loss (0–50%).
  - Manual "Sever Connection" trigger to test offline queueing and recovery in real-time.

### 3. Event Bus & Horizontal Scaling (Redis Pub/Sub)
- Servers run as independent stateless worker nodes (`Node 1` on port 4001, `Node 2` on port 4002).
- When a client sends a mutation to Node 1:
  1. Node 1 applies it to its local CRDT replica and sends an immediate ACK.
  2. Node 1 publishes the mutation to the Event Bus channel (`collab:room:general`).
  3. Node 2 receives the event via Pub/Sub, integrates it into its CRDT state, and fans it out to its connected clients.
- **Dual-Mode Adapter**: Automatically connects to real Redis (`redis://127.0.0.1:6379`) if present, or seamlessly falls back to the embedded zero-dependency local cluster bus.

---

## 🚀 Quick Start

### 1. Installation
```powershell
cd C:\Users\JB\.gemini\antigravity-ide\scratch\collab-sync-engine
npm install
```

### 2. Run the Multi-Node Cluster
```powershell
npm start
```
This boots both nodes concurrently:
- **Node 1**: `http://localhost:4001`
- **Node 2**: `http://localhost:4002`

### 3. Run Automated Tests
```powershell
npm test
```
Runs unit tests for:
- RGA sequential and concurrent insert convergence.
- Deletion tombstones and concurrent edit/delete resolution.
- LWW-Map Lamport timestamp conflict resolution.
- End-to-end multi-node WebSocket cross-synchronization across ports 4001 and 4002.

---

## 🧪 Testing Multi-Node Sync in Browser

1. Open **Window A** at: `http://localhost:4001`
2. Open **Window B** at: `http://localhost:4002` (connected to the peer node!)
3. **Real-Time Code Editing**:
   - Type in Window A -> observe instantaneous convergence in Window B with matching document CRC checksums.
4. **Shared Whiteboard Canvas**:
   - Switch to the "Shared Whiteboard Canvas" tab.
   - Drag or edit any card -> observe smooth, conflict-free movement mirrored across both windows.
5. **Chaos & Resilience Testing**:
   - In Window A, switch to the "Cluster Topology & Chaos Lab" tab.
   - Click **"Sever Socket Connection"**.
   - Switch back to the editor and type a few lines while offline (notice the badge: `OFFLINE (N QUEUED)`).
   - Switch to the Chaos tab and click **"Reconnect & Flush Queue"**.
   - Notice the connection re-establishes, the queue empties, and Window B updates to match Window A with zero lost data!
