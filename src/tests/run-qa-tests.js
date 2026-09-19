/**
 * Automated QA Test Runner & JUnit XML Report Generator
 * 
 * Executes all automated tests and exports a standard JUnit XML report
 * for CI/CD pipelines (Jenkins, GitHub Actions, GitLab CI, Jira Xray, TestRail).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RgaSequence } from '../crdt/rga.js';
import { LwwMap } from '../crdt/lww-map.js';
import { WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTestSuite() {
  console.log('====================================================');
  console.log('🧪 Running AetherSync QA Automated Test Suite...');
  console.log('====================================================');

  const testResults = [];
  const startTime = Date.now();

  async function executeTest(id, name, suite, testFn) {
    const start = performance.now();
    try {
      await testFn();
      const duration = (performance.now() - start) / 1000;
      testResults.push({ id, name, suite, duration, status: 'pass' });
      console.log(`  ✔ [PASS] ${id}: ${name} (${Math.round(duration * 1000)}ms)`);
    } catch (err) {
      const duration = (performance.now() - start) / 1000;
      testResults.push({ id, name, suite, duration, status: 'fail', error: err.message, stack: err.stack });
      console.error(`  ❌ [FAIL] ${id}: ${name} - ${err.message}`);
    }
  }

  // --- Suite 1: CRDT Conflict Resolution ---
  await executeTest('TC-CRDT-001', 'RGA Sequential Character Insertion', 'CRDT_Conflict_Resolution', () => {
    const rga = new RgaSequence('alice');
    rga.insert(0, 'H');
    rga.insert(1, 'e');
    rga.insert(2, 'l');
    rga.insert(3, 'l');
    rga.insert(4, 'o');
    if (rga.toString() !== 'Hello') throw new Error(`Expected 'Hello', got '${rga.toString()}'`);
  });

  await executeTest('TC-CRDT-002', 'Concurrent RGA Insertions at Identical Cursor Index', 'CRDT_Conflict_Resolution', () => {
    const alice = new RgaSequence('alice');
    const bob = new RgaSequence('bob');

    const op1 = alice.insert(0, 'A');
    const op2 = alice.insert(1, 'B');
    bob.applyRemoteInsert(op1);
    bob.applyRemoteInsert(op2);

    const aliceOp = alice.insert(1, 'X');
    const bobOp = bob.insert(1, 'Y');

    alice.applyRemoteInsert(bobOp);
    bob.applyRemoteInsert(aliceOp);

    if (alice.toString() !== bob.toString()) {
      throw new Error(`CRDT Divergence: Alice '${alice.toString()}' vs Bob '${bob.toString()}'`);
    }
  });

  await executeTest('TC-CRDT-003', 'Concurrent Deletion and Insertion with Tombstones', 'CRDT_Conflict_Resolution', () => {
    const replicaA = new RgaSequence('siteA');
    const replicaB = new RgaSequence('siteB');

    replicaB.applyRemoteInsert(replicaA.insert(0, 'C'));
    replicaB.applyRemoteInsert(replicaA.insert(1, 'A'));
    replicaB.applyRemoteInsert(replicaA.insert(2, 'T'));

    const delOp = replicaA.delete(1); // delete 'A'
    const insertOp = replicaB.insert(2, 'H'); // insert 'H' after 'A'

    replicaA.applyRemoteInsert(insertOp);
    replicaB.applyRemoteDelete(delOp);

    if (replicaA.toString() !== replicaB.toString() || replicaA.toString() !== 'CHT') {
      throw new Error(`Expected 'CHT', got '${replicaA.toString()}' and '${replicaB.toString()}'`);
    }
  });

  await executeTest('TC-CRDT-004', 'LWW-Map Concurrent Canvas Item Mutations', 'CRDT_Conflict_Resolution', () => {
    const mapA = new LwwMap('siteA');
    const mapB = new LwwMap('siteB');

    const opA = mapA.set('card-1', { x: 100, y: 200, color: 'blue' });
    const opB = mapB.set('card-1', { x: 150, y: 250, color: 'emerald' });

    mapA.applyRemoteOp(opB);
    mapB.applyRemoteOp(opA);

    const objA = JSON.stringify(mapA.toObject());
    const objB = JSON.stringify(mapB.toObject());

    if (objA !== objB) {
      throw new Error(`LWW-Map Divergence: ${objA} vs ${objB}`);
    }
  });

  await executeTest('TC-CRDT-005', 'Out-of-Order Operation Idempotency', 'CRDT_Conflict_Resolution', () => {
    const rga = new RgaSequence('alice');
    const op = rga.insert(0, 'M');
    const appliedFirst = rga.applyRemoteInsert(op);
    const appliedSecond = rga.applyRemoteInsert(op);

    if (appliedSecond !== false) {
      throw new Error('Duplicate operation should not be re-applied');
    }
  });

  // --- Suite 2: Multi-Node WebSocket Event Bus Scaling ---
  await executeTest('TC-BUS-001', 'Cross-Node WebSocket Synchronization', 'Multi_Node_Event_Bus', async () => {
    const roomId = `qa_e2e_${Date.now()}`;
    const ws1 = new WebSocket(`ws://localhost:4001?room=${roomId}&clientId=qa-client-1`);
    const ws2 = new WebSocket(`ws://localhost:4002?room=${roomId}&clientId=qa-client-2`);

    const receivedBy2 = [];

    await new Promise((resolve, reject) => {
      let ready = 0;
      const timeout = setTimeout(() => reject(new Error('WebSocket connection timeout')), 3000);
      const onOpen = () => {
        ready++;
        if (ready === 2) {
          clearTimeout(timeout);
          resolve();
        }
      };
      ws1.on('open', onOpen);
      ws2.on('open', onOpen);
      ws1.on('error', reject);
      ws2.on('error', reject);
    });

    ws2.on('message', (msg) => {
      receivedBy2.push(JSON.parse(msg.toString()));
    });

    await wait(200);

    const testOp = {
      type: 'mutation',
      opId: 'qa-op-100',
      op: {
        type: 'rga_insert',
        id: 'qa-client-1:100',
        value: 'Q',
        originLeftId: '__HEAD__',
        clock: 10,
        siteId: 'qa-client-1'
      }
    };

    ws1.send(JSON.stringify(testOp));
    await wait(300);

    ws1.close();
    ws2.close();

    const found = receivedBy2.find(m => m.type === 'mutation' && m.op?.id === 'qa-client-1:100');
    if (!found) {
      throw new Error('Mutation published to Node 1 was not received by Node 2');
    }
  });

  // --- Generate JUnit XML Report ---
  const totalDuration = (Date.now() - startTime) / 1000;
  const failures = testResults.filter(r => r.status === 'fail').length;
  const passed = testResults.filter(r => r.status === 'pass').length;

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<testsuites name="AetherSync_QA_Suite" time="${totalDuration.toFixed(3)}" tests="${testResults.length}" failures="${failures}">\n`;
  xml += `  <testsuite name="AetherSync_Automated_Tests" tests="${testResults.length}" failures="${failures}" errors="0" time="${totalDuration.toFixed(3)}">\n`;

  for (const r of testResults) {
    xml += `    <testcase classname="${r.suite}" name="${r.id}: ${r.name}" time="${r.duration.toFixed(3)}">\n`;
    if (r.status === 'fail') {
      xml += `      <failure message="${escapeXml(r.error)}"><![CDATA[${r.stack}]]></failure>\n`;
    }
    xml += `    </testcase>\n`;
  }

  xml += `  </testsuite>\n`;
  xml += `</testsuites>\n`;

  const reportPath = path.join(projectRoot, 'junit-results.xml');
  fs.writeFileSync(reportPath, xml, 'utf8');

  console.log('----------------------------------------------------');
  console.log(`📊 Test Summary: Total: ${testResults.length} | Passed: ${passed} | Failed: ${failures}`);
  console.log(`📄 JUnit XML Report generated at: ${reportPath}`);
  console.log('====================================================');
}

function escapeXml(str = '') {
  return str.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

runTestSuite().catch(console.error);
