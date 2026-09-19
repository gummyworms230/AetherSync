import test from 'node:test';
import assert from 'node:assert';
import { RgaSequence } from '../crdt/rga.js';
import { LwwMap } from '../crdt/lww-map.js';

test('RGA: Sequential local inserts produce expected text', () => {
  const rga = new RgaSequence('alice');
  rga.insert(0, 'H');
  rga.insert(1, 'e');
  rga.insert(2, 'l');
  rga.insert(3, 'l');
  rga.insert(4, 'o');

  assert.strictEqual(rga.toString(), 'Hello');
});

test('RGA: Concurrent inserts at same position deterministically converge', () => {
  const alice = new RgaSequence('alice');
  const bob = new RgaSequence('bob');

  // Both start with "AB"
  const op1 = alice.insert(0, 'A');
  const op2 = alice.insert(1, 'B');
  bob.applyRemoteInsert(op1);
  bob.applyRemoteInsert(op2);

  assert.strictEqual(alice.toString(), 'AB');
  assert.strictEqual(bob.toString(), 'AB');

  // Alice inserts 'X' between 'A' and 'B' (index 1)
  const aliceOp = alice.insert(1, 'X');

  // Bob concurrently inserts 'Y' between 'A' and 'B' (index 1)
  const bobOp = bob.insert(1, 'Y');

  // Exchange operations
  alice.applyRemoteInsert(bobOp);
  bob.applyRemoteInsert(aliceOp);

  // Both replicas MUST converge to the exact same text
  assert.strictEqual(alice.toString(), bob.toString());
  console.log('RGA Convergence Result:', alice.toString());
});

test('RGA: Deletion tombstones and concurrent edit/delete convergence', () => {
  const replicaA = new RgaSequence('siteA');
  const replicaB = new RgaSequence('siteB');

  const op1 = replicaA.insert(0, 'C');
  const op2 = replicaA.insert(1, 'A');
  const op3 = replicaA.insert(2, 'T');
  replicaB.applyRemoteInsert(op1);
  replicaB.applyRemoteInsert(op2);
  replicaB.applyRemoteInsert(op3);

  assert.strictEqual(replicaA.toString(), 'CAT');
  assert.strictEqual(replicaB.toString(), 'CAT');

  // Replica A deletes 'A' (index 1)
  const delOp = replicaA.delete(1);
  assert.strictEqual(replicaA.toString(), 'CT');

  // Replica B concurrently inserts 'H' after 'A' (index 2)
  const insertOp = replicaB.insert(2, 'H');

  // Replicas cross-apply
  replicaA.applyRemoteInsert(insertOp);
  replicaB.applyRemoteDelete(delOp);

  assert.strictEqual(replicaA.toString(), replicaB.toString());
  assert.strictEqual(replicaA.toString(), 'CHT');
});

test('LWW-Map: Concurrent key mutations converge using timestamps and site tie-breaking', () => {
  const mapA = new LwwMap('siteA');
  const mapB = new LwwMap('siteB');

  // Site A sets key 'shape1'
  const opA = mapA.set('shape1', { x: 100, y: 200, color: 'blue' });

  // Site B sets key 'shape1' concurrently
  const opB = mapB.set('shape1', { x: 150, y: 250, color: 'emerald' });

  // Cross-apply
  mapA.applyRemoteOp(opB);
  mapB.applyRemoteOp(opA);

  assert.deepStrictEqual(mapA.toObject(), mapB.toObject());
  console.log('LWW-Map Convergence Winner:', mapA.get('shape1'));
});
