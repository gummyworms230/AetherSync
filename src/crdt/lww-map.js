/**
 * Last-Write-Wins Map (LWW-Map) CRDT
 * 
 * Manages key-value pairs for whiteboard canvas elements (sticky notes, cards, shapes)
 * and cursor/presence metadata.
 * Uses Lamport timestamp and siteId for deterministic conflict-free resolution.
 */

import { LamportClock } from './lamport.js';

export class LwwMap {
  constructor(siteId = 'default') {
    this.siteId = siteId;
    this.clock = new LamportClock(siteId);
    // map: key -> { value, timestamp, siteId, deleted }
    this.entries = new Map();
  }

  /**
   * Set or update a key-value pair locally
   */
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

  /**
   * Delete a key locally (tombstone)
   */
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

  /**
   * Apply remote operation
   */
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

    // Conflict resolution: Higher timestamp wins; if equal, higher siteId wins
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

    return false; // Local state had higher priority
  }

  /**
   * Get value by key (returns undefined if deleted or non-existent)
   */
  get(key) {
    const entry = this.entries.get(key);
    if (!entry || entry.deleted) return undefined;
    return entry.value;
  }

  /**
   * Get all active key-value entries as plain object
   */
  toObject() {
    const obj = {};
    for (const [key, entry] of this.entries.entries()) {
      if (!entry.deleted) {
        obj[key] = entry.value;
      }
    }
    return obj;
  }

  /**
   * Snapshot serialization
   */
  getStateSnapshot() {
    const snapshot = {};
    for (const [key, entry] of this.entries.entries()) {
      snapshot[key] = { ...entry };
    }
    return {
      siteId: this.siteId,
      clock: this.clock.getTime(),
      entries: snapshot
    };
  }

  /**
   * Load snapshot
   */
  loadStateSnapshot(snapshot) {
    this.entries.clear();
    for (const [key, entry] of Object.entries(snapshot.entries || {})) {
      this.entries.set(key, { ...entry });
    }
    this.clock.update(snapshot.clock || 0);
  }

  loadSnapshot(snapshot) {
    return this.loadStateSnapshot(snapshot);
  }
}
