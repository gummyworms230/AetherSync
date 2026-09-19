/**
 * Lamport Clock & Vector Clock implementations for causality tracking
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

  clone() {
    return new LamportClock(this.siteId, this.time);
  }
}

export class VectorClock {
  constructor(initialMap = {}) {
    this.clock = { ...initialMap };
  }

  tick(siteId) {
    this.clock[siteId] = (this.clock[siteId] || 0) + 1;
    return this.clock[siteId];
  }

  update(remoteVector) {
    for (const [siteId, time] of Object.entries(remoteVector)) {
      this.clock[siteId] = Math.max(this.clock[siteId] || 0, time);
    }
  }

  get(siteId) {
    return this.clock[siteId] || 0;
  }

  toJSON() {
    return { ...this.clock };
  }

  clone() {
    return new VectorClock(this.clock);
  }
}
