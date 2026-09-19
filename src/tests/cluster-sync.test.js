import test from 'node:test';
import assert from 'node:assert';
import { WebSocket } from 'ws';

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('Cluster E2E: Cross-Node WebSocket synchronization across port 4001 and 4002', async () => {
  const roomId = `e2e_room_${Date.now()}`;
  const ws1 = new WebSocket(`ws://localhost:4001?room=${roomId}&clientId=test-client-1`);
  const ws2 = new WebSocket(`ws://localhost:4002?room=${roomId}&clientId=test-client-2`);

  const client1Received = [];
  const client2Received = [];

  await new Promise(resolve => {
    let openCount = 0;
    const check = () => {
      openCount++;
      if (openCount === 2) resolve();
    };
    ws1.on('open', check);
    ws2.on('open', check);
  });

  ws1.on('message', (data) => {
    client1Received.push(JSON.parse(data.toString()));
  });

  ws2.on('message', (data) => {
    client2Received.push(JSON.parse(data.toString()));
  });

  // Allow initial sync_full to settle
  await wait(200);

  // Client 1 sends an RGA mutation to Node 1
  const testMutation = {
    type: 'mutation',
    opId: 'test-op-1',
    op: {
      type: 'rga_insert',
      id: 'test-client-1:1',
      value: 'Z',
      originLeftId: '__HEAD__',
      clock: 1,
      siteId: 'test-client-1'
    }
  };

  ws1.send(JSON.stringify(testMutation));

  // Wait for propagation through Event Bus to Node 2 and Client 2
  await wait(300);

  // Verify Client 1 received the ACK
  const ack = client1Received.find(m => m.type === 'ack' && m.opId === 'test-op-1');
  assert.ok(ack, 'Client 1 should receive ACK from Node 1');

  // Verify Client 2 received the mutation over Node 2
  const remoteMut = client2Received.find(m => m.type === 'mutation' && m.op?.id === 'test-client-1:1');
  assert.ok(remoteMut, 'Client 2 on Node 2 should receive mutation broadcasted via Event Bus from Node 1');
  assert.strictEqual(remoteMut.op.value, 'Z');

  // Clean up sockets
  ws1.close();
  ws2.close();
  await wait(100);
});
