/**
 * Multi-Node Cluster Runner
 * 
 * Boots two independent Server Nodes concurrently:
 * - Node 1 on http://localhost:4001
 * - Node 2 on http://localhost:4002
 * Both communicate through the Distributed Event Bus (Redis or Cluster Bus).
 */

import { ServerNode } from './server-node.js';

async function bootstrapCluster() {
  console.log('====================================================');
  console.log('⚡ Distributed Real-Time Collaboration Cluster ⚡');
  console.log('====================================================');

  const node1 = new ServerNode({ port: 4001, nodeId: 'cluster-node-1', peerPort: 4002 });
  const node2 = new ServerNode({ port: 4002, nodeId: 'cluster-node-2', peerPort: 4001 });
  const node3 = new ServerNode({ port: 4003, nodeId: 'cluster-node-3', peerPort: 4001 });

  await node1.start();
  await node2.start();
  await node3.start();

  console.log('----------------------------------------------------');
  console.log('🎉 3-Node Distributed Cluster Online:');
  console.log('👉 Node 1: http://localhost:4001');
  console.log('👉 Node 2: http://localhost:4002');
  console.log('👉 Node 3: http://localhost:4003');
  console.log('📱 LAN Device Access:');
  console.log('👉 http://192.168.0.145:4001');
  console.log('👉 http://192.168.0.145:4002');
  console.log('👉 http://192.168.0.145:4003');
  console.log('----------------------------------------------------');
  console.log('Clients can connect to any of the 3 ports and will synchronize in real-time!');
}

bootstrapCluster().catch(err => {
  console.error('Fatal cluster startup error:', err);
  process.exit(1);
});
