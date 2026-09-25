/**
 * Client-Side CRDT Library (ES Module for Browser)
 * Implements RGA (Replicated Growable Array) and LWW-Map (Last-Write-Wins Map)
 */

export class LamportClock {
  constructor(siteId, initialTime = 0) {
    this.siteId = siteId;
    this.time = initialTime;
  }

  tick() {
    this.time += 1;
    return this.time;
  }

  update(remoteTime) {
    this.time = Math.max(this.time, remoteTime) + 1;
    return this.time;
  }

  getTime() {
    return this.time;
  }
}

export class RgaNode {
  constructor(id, value, originLeftId = null, clock = 0, siteId = '') {
    this.id = id;
    this.value = value;
    this.originLeftId = originLeftId;
    this.clock = clock;
    this.siteId = siteId;
    this.deleted = false;
  }
}

export class ClientRgaSequence {
  constructor(siteId) {
    this.siteId = siteId;
    this.clock = new LamportClock(siteId);
    this.head = new RgaNode('__HEAD__', '', null, -1, 'SYSTEM');
    this.nodes = [this.head];
    this.nodeMap = new Map();
    this.nodeMap.set('__HEAD__', this.head);
  }

  insert(visualIndex, char) {
    const timestamp = this.clock.tick();
    const id = `${this.siteId}:${timestamp}`;
    const originLeftId = this.findOriginLeftId(visualIndex);

    const newNode = new RgaNode(id, char, originLeftId, timestamp, this.siteId);
    this._integrate(newNode);

    return {
      type: 'rga_insert',
      id: newNode.id,
      value: newNode.value,
      originLeftId: newNode.originLeftId,
      clock: newNode.clock,
      siteId: newNode.siteId
    };
  }

  delete(visualIndex) {
    const node = this.getNodeAtVisualIndex(visualIndex);
    if (!node || node.id === '__HEAD__') return null;

    this.clock.tick();
    node.deleted = true;

    return {
      type: 'rga_delete',
      id: node.id,
      siteId: this.siteId,
      clock: this.clock.getTime()
    };
  }

  applyRemoteInsert(op) {
    if (this.nodeMap.has(op.id)) return false;

    this.clock.update(op.clock);
    const newNode = new RgaNode(op.id, op.value, op.originLeftId, op.clock, op.siteId);
    this._integrate(newNode);
    return true;
  }

  applyRemoteDelete(op) {
    this.clock.update(op.clock);
    const node = this.nodeMap.get(op.id);
    if (node) {
      node.deleted = true;
      return true;
    }
    return false;
  }

  _integrate(newNode) {
    this.nodeMap.set(newNode.id, newNode);

    let originIndex = 0;
    if (newNode.originLeftId && this.nodeMap.has(newNode.originLeftId)) {
      originIndex = this.nodes.findIndex(n => n.id === newNode.originLeftId);
      if (originIndex === -1) originIndex = 0;
    }

    let insertIndex = originIndex + 1;
    while (insertIndex < this.nodes.length) {
      const current = this.nodes[insertIndex];
      if (this._comparePriority(newNode, current) < 0) {
        insertIndex++;
      } else {
        break;
      }
    }

    this.nodes.splice(insertIndex, 0, newNode);
  }

  _comparePriority(a, b) {
    if (a.clock !== b.clock) {
      return a.clock - b.clock;
    }
    return a.siteId.localeCompare(b.siteId);
  }

  findOriginLeftId(visualIndex) {
    if (visualIndex <= 0) return '__HEAD__';

    let count = 0;
    for (let i = 1; i < this.nodes.length; i++) {
      if (!this.nodes[i].deleted) {
        count++;
        if (count === visualIndex) {
          return this.nodes[i].id;
        }
      }
    }
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      if (!this.nodes[i].deleted) {
        return this.nodes[i].id;
      }
    }
    return '__HEAD__';
  }

  getNodeAtVisualIndex(visualIndex) {
    let count = 0;
    for (let i = 1; i < this.nodes.length; i++) {
      if (!this.nodes[i].deleted) {
        if (count === visualIndex) {
          return this.nodes[i];
        }
        count++;
      }
    }
    return null;
  }

  toString() {
    let result = '';
    for (let i = 1; i < this.nodes.length; i++) {
      if (!this.nodes[i].deleted) {
        result += this.nodes[i].value;
      }
    }
    return result;
  }

  loadSnapshot(snapshot) {
    this.nodes = [];
    this.nodeMap.clear();
    for (const item of snapshot.nodes || []) {
      const node = new RgaNode(item.id, item.value, item.originLeftId, item.clock, item.siteId);
      node.deleted = item.deleted;
      this.nodes.push(node);
      this.nodeMap.set(node.id, node);
    }
    this.head = this.nodes[0] || new RgaNode('__HEAD__', '', null, -1, 'SYSTEM');
    this.clock.update(snapshot.clock || 0);
  }

  getActiveNodesWithAuthors() {
    const list = [];
    for (let i = 1; i < this.nodes.length; i++) {
      if (!this.nodes[i].deleted) {
        list.push({
          value: this.nodes[i].value,
          siteId: this.nodes[i].siteId,
          clock: this.nodes[i].clock,
          id: this.nodes[i].id
        });
      }
    }
    return list;
  }

  getStateSnapshot() {
    return {
      clock: this.clock.getTime(),
      nodes: this.nodes.map(n => ({
        id: n.id,
        value: n.value,
        originLeftId: n.originLeftId,
        clock: n.clock,
        siteId: n.siteId,
        deleted: n.deleted
      }))
    };
  }

  /**
   * Fast checksum calculation to verify convergence across clients
   */
  computeChecksum() {
    const str = this.toString();
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 33) ^ str.charCodeAt(i);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }
}

export class ClientLwwMap {
  constructor(siteId) {
    this.siteId = siteId;
    this.clock = new LamportClock(siteId);
    this.entries = new Map();
  }

  set(key, value) {
    const timestamp = this.clock.tick();
    const entry = {
      value,
      timestamp,
      siteId: this.siteId,
      deleted: false
    };
    this.entries.set(key, entry);

    return {
      type: 'lww_set',
      key,
      value,
      timestamp,
      siteId: this.siteId,
      deleted: false
    };
  }

  delete(key) {
    const timestamp = this.clock.tick();
    const entry = {
      value: null,
      timestamp,
      siteId: this.siteId,
      deleted: true
    };
    this.entries.set(key, entry);

    return {
      type: 'lww_delete',
      key,
      value: null,
      timestamp,
      siteId: this.siteId,
      deleted: true
    };
  }

  applyRemoteOp(op) {
    this.clock.update(op.timestamp);
    const existing = this.entries.get(op.key);

    if (!existing) {
      this.entries.set(op.key, {
        value: op.value,
        timestamp: op.timestamp,
        siteId: op.siteId,
        deleted: op.deleted
      });
      return true;
    }

    const incomingWins =
      op.timestamp > existing.timestamp ||
      (op.timestamp === existing.timestamp && op.siteId > existing.siteId);

    if (incomingWins) {
      this.entries.set(op.key, {
        value: op.value,
        timestamp: op.timestamp,
        siteId: op.siteId,
        deleted: op.deleted
      });
      return true;
    }

    return false;
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry || entry.deleted) return undefined;
    return entry.value;
  }

  toObject() {
    const obj = {};
    for (const [key, entry] of this.entries.entries()) {
      if (!entry.deleted) {
        obj[key] = entry.value;
      }
    }
    return obj;
  }

  loadSnapshot(snapshot) {
    this.entries.clear();
    for (const [key, entry] of Object.entries(snapshot.entries || {})) {
      this.entries.set(key, { ...entry });
    }
    this.clock.update(snapshot.clock || 0);
  }
}
