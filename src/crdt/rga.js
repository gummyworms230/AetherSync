/**
 * Replicated Growable Array (RGA) Sequence CRDT
 * 
 * Provides conflict-free collaborative text editing.
 * Characters are stored in a linear sequence with unique IDs (siteId + timestamp).
 * Concurrency resolution uses Lamport timestamps with siteId tie-breaking.
 */

import { LamportClock } from './lamport.js';

export class RgaNode {
  constructor(id, value, originLeftId = null, clock = 0, siteId = '') {
    this.id = id; // e.g. "client-A:1"
    this.value = value;
    this.originLeftId = originLeftId; // ID of the character to the left when inserted
    this.clock = clock;
    this.siteId = siteId;
    this.deleted = false;
  }
}

export class RgaSequence {
  constructor(siteId = 'default') {
    this.siteId = siteId;
    this.clock = new LamportClock(siteId);
    // Sentinel head node (not part of visual text)
    this.head = new RgaNode('__HEAD__', '', null, -1, 'SYSTEM');
    this.nodes = [this.head]; // Fast indexed array for traversal
    this.nodeMap = new Map(); // id -> RgaNode
    this.nodeMap.set('__HEAD__', this.head);
  }

  /**
   * Insert character locally at visual text index (0-based)
   */
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

  /**
   * Delete character locally at visual text index (0-based)
   */
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

  /**
   * Apply remote insert operation
   */
  applyRemoteInsert(op) {
    if (this.nodeMap.has(op.id)) {
      return false; // Already integrated (idempotency)
    }

    this.clock.update(op.clock);
    const newNode = new RgaNode(op.id, op.value, op.originLeftId, op.clock, op.siteId);
    this._integrate(newNode);
    return true;
  }

  /**
   * Apply remote delete operation
   */
  applyRemoteDelete(op) {
    this.clock.update(op.clock);
    const node = this.nodeMap.get(op.id);
    if (node) {
      node.deleted = true;
      return true;
    }
    return false;
  }

  /**
   * Core RGA deterministic integration algorithm
   */
  _integrate(newNode) {
    this.nodeMap.set(newNode.id, newNode);

    // Find index of originLeft
    let originIndex = 0;
    if (newNode.originLeftId && this.nodeMap.has(newNode.originLeftId)) {
      originIndex = this.nodes.findIndex(n => n.id === newNode.originLeftId);
      if (originIndex === -1) originIndex = 0;
    }

    // Advance past any nodes inserted after originLeft with higher priority
    let insertIndex = originIndex + 1;
    while (insertIndex < this.nodes.length) {
      const current = this.nodes[insertIndex];
      // If current node shares the same origin or was inserted later
      // Compare clocks for total order: higher clock comes first.
      // If clocks are equal, siteId breaks tie.
      if (this._comparePriority(newNode, current) < 0) {
        insertIndex++;
      } else {
        break;
      }
    }

    this.nodes.splice(insertIndex, 0, newNode);
  }

  /**
   * Priority comparison: Returns > 0 if a should come before b
   */
  _comparePriority(a, b) {
    if (a.clock !== b.clock) {
      return a.clock - b.clock; // Higher clock wins
    }
    return a.siteId.localeCompare(b.siteId); // Lexicographic tie-breaker
  }

  /**
   * Find originLeft ID for a visual index
   */
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
    // If beyond length, attach to last active node
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      if (!this.nodes[i].deleted) {
        return this.nodes[i].id;
      }
    }
    return '__HEAD__';
  }

  /**
   * Find node at a visual index (0-based)
   */
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

  /**
   * Visual text representation (excluding deleted tombstones and head)
   */
  toString() {
    let result = '';
    for (let i = 1; i < this.nodes.length; i++) {
      if (!this.nodes[i].deleted) {
        result += this.nodes[i].value;
      }
    }
    return result;
  }

  /**
   * Snapshot serialization for new peer bootstrap
   */
  getStateSnapshot() {
    return {
      siteId: this.siteId,
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
   * Load snapshot
   */
  loadStateSnapshot(snapshot) {
    this.nodes = [];
    this.nodeMap.clear();
    for (const item of snapshot.nodes) {
      const node = new RgaNode(item.id, item.value, item.originLeftId, item.clock, item.siteId);
      node.deleted = item.deleted;
      this.nodes.push(node);
      this.nodeMap.set(node.id, node);
    }
    this.head = this.nodes[0] || new RgaNode('__HEAD__', '', null, -1, 'SYSTEM');
    this.clock.update(snapshot.clock || 0);
  }
}
