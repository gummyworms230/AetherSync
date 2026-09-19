/**
 * AetherSync Application Controller
 * Binds CRDT Engine, Resilient Connection Manager, Workspace Views, and Chaos Simulator
 */

import { ClientRgaSequence, ClientLwwMap } from './client-crdt.js';
import { ConnectionManager } from './connection-manager.js';

class AetherApp {
  constructor() {
    // Generate distinct user identity and color
    this.userColors = ['#38bdf8', '#10b981', '#8b5cf6', '#f59e0b', '#ff0000ff', '#06b6d4'];
    this.siteId = `peer_${Math.random().toString(36).substring(2, 6)}`;
    this.userColor = this.userColors[Math.floor(Math.random() * this.userColors.length)];
    this.userName = `user-${this.siteId.slice(-4).toUpperCase()}`;

    // Initialize CRDT replicas
    this.rga = new ClientRgaSequence(this.siteId);
    this.canvasMap = new ClientLwwMap(this.siteId);

    // Initialize Connection State Manager
    const initialPort = window.location.port || '4001';
    this.conn = new ConnectionManager({
      siteId: this.siteId,
      serverPort: initialPort,
      roomId: 'general'
    });

    this.activeTab = 'editor';
    this.peers = new Map(); // clientId -> { name, color, cursor }
    this.isLocalTyping = false;
    this.previousText = '';

    this._cacheDom();
    this._bindEvents();
    this._initUserDisplay();

    // Start WebSocket connection
    this.conn.connect();
  }

  _cacheDom() {
    // Top bar elements
    this.nodeSelectDropdown = document.getElementById('node-select-dropdown');
    this.btnSwitchNode = document.getElementById('btn-switch-node');
    this.connStatusBadge = document.getElementById('connection-status-badge');
    this.connStatusText = document.getElementById('connection-status-text');
    this.latencyVal = document.getElementById('latency-val');
    this.queueCountVal = document.getElementById('queue-count-val');
    this.checksumVal = document.getElementById('checksum-val');
    this.userColorDot = document.getElementById('user-color-dot');
    this.userNameDisplay = document.getElementById('username-display');
    this.peerAvatarsContainer = document.getElementById('peer-avatars-container');

    // Tab buttons & views
    this.tabBtns = document.querySelectorAll('.tab-btn');
    this.views = {
      editor: document.getElementById('view-editor'),
      canvas: document.getElementById('view-canvas'),
      chaos: document.getElementById('view-chaos')
    };

    // Editor elements
    this.editorTextarea = document.getElementById('code-editor-textarea');
    this.editorGutter = document.getElementById('editor-gutter');
    this.peerCursorsLayer = document.getElementById('peer-cursors-layer');
    this.rgaCharStats = document.getElementById('rga-char-stats');
    this.btnCopyCode = document.getElementById('btn-copy-code');

    // Canvas elements
    this.canvasGrid = document.getElementById('canvas-grid');
    this.btnAddNote = document.getElementById('btn-add-note');
    this.btnAddService = document.getElementById('btn-add-service');
    this.btnResetCanvas = document.getElementById('btn-reset-canvas');

    // Chaos Lab elements
    this.latencySlider = document.getElementById('latency-slider');
    this.latencySliderVal = document.getElementById('latency-slider-val');
    this.packetDropSlider = document.getElementById('packet-drop-slider');
    this.packetDropSliderVal = document.getElementById('packet-drop-slider-val');
    this.btnToggleDisconnect = document.getElementById('btn-toggle-disconnect');
    this.btnForceReconnect = document.getElementById('btn-force-reconnect');
    this.chaosEventLog = document.getElementById('chaos-event-log');
    this.queueBadgeCounter = document.getElementById('queue-badge-counter');
    this.queueItemsContainer = document.getElementById('queue-items-container');
    this.currentRouteLabel = document.getElementById('current-route-label');
    this.topoNode1 = document.getElementById('topo-node-1');
    this.topoNode2 = document.getElementById('topo-node-2');
    this.topoNode3 = document.getElementById('topo-node-3');
    this.topoNode1Clients = document.getElementById('topo-node-1-clients');
    this.topoNode2Clients = document.getElementById('topo-node-2-clients');
    this.topoNode3Clients = document.getElementById('topo-node-3-clients');
    this.proofRgaNodes = document.getElementById('proof-rga-nodes');
    this.proofLamportClock = document.getElementById('proof-lamport-clock');
    this.proofChecksum = document.getElementById('proof-checksum');
    this.btnTestConvergence = document.getElementById('btn-test-convergence');
  }

  _initUserDisplay() {
    this.userColorDot.style.background = this.userColor;
    this.userNameDisplay.textContent = this.userName;
    if (this.nodeSelectDropdown) {
      this.nodeSelectDropdown.value = this.conn.serverPort;
    }
    this._updateTopologyHighlight();
  }

  _bindEvents() {
    // Tab switching
    this.tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        this.switchTab(tab);
      });
    });

    // Node switching
    this.btnSwitchNode.addEventListener('click', () => {
      const selectedPort = this.nodeSelectDropdown.value;
      this.logChaos(`[Node Switch] Migrating WebSocket to Port ${selectedPort}...`, 'log-warning');
      this.conn.switchNode(selectedPort);
      this._updateTopologyHighlight();
    });

    // Copy text
    this.btnCopyCode.addEventListener('click', () => {
      navigator.clipboard.writeText(this.rga.toString());
      this.btnCopyCode.textContent = 'Copied!';
      setTimeout(() => { this.btnCopyCode.textContent = 'Copy Text'; }, 1500);
    });

    // Editor input diffing
    this.editorTextarea.addEventListener('input', (e) => this._handleEditorInput(e));
    this.editorTextarea.addEventListener('keyup', () => this._broadcastCursor());
    this.editorTextarea.addEventListener('click', () => this._broadcastCursor());

    // Canvas actions
    this.btnAddNote.addEventListener('click', () => this._createCanvasItem('note'));
    this.btnAddService.addEventListener('click', () => this._createCanvasItem('service'));
    this.btnResetCanvas.addEventListener('click', () => this._resetCanvasDefaults());

    // Chaos Simulator Controls
    this.latencySlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      this.conn.artificialLatencyMs = val;
      this.latencySliderVal.textContent = `${val} ms`;
      this.logChaos(`[Latency] Artificial delay set to ${val}ms`, val > 0 ? 'log-warning' : '');
    });

    this.packetDropSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      this.conn.packetDropRate = val / 100;
      this.packetDropSliderVal.textContent = `${val}%`;
      this.logChaos(`[Packet Drop] Simulated loss rate set to ${val}%`, val > 0 ? 'log-danger' : '');
    });

    this.btnToggleDisconnect.addEventListener('click', () => {
      this.conn.disconnect();
      this.logChaos(`[Dropout] Connection severed manually. Mutations will queue locally.`, 'log-danger');
    });

    this.btnForceReconnect.addEventListener('click', () => {
      this.conn.connect();
      this.logChaos(`[Reconnect] Socket reconnecting... Flushing pending mutations.`, 'log-warning');
    });

    this.btnTestConvergence.addEventListener('click', () => {
      const crc = this.rga.computeChecksum();
      const nodeCount = this.rga.nodes.length;
      alert(`[CRDT Verification]\nCurrent Document CRC: #${crc}\nRGA Sequence Total Nodes: ${nodeCount}\nActive String Length: ${this.rga.toString().length}\n\nOpen another browser tab on ports 4001, 4002, or 4003 — all three will match this CRC identically.`);
    });

    // Connection Manager Listeners
    this.conn.on('state_change', ({ state, queuedCount }) => {
      this._updateConnectionUI(state, queuedCount);
    });

    this.conn.on('latency', ({ rtt }) => {
      this.latencyVal.textContent = rtt;
    });

    this.conn.on('queue_updated', ({ queue, count }) => {
      this.queueCountVal.textContent = count;
      this.queueBadgeCounter.textContent = `${count} items`;
      this._renderQueueList(queue);
    });

    this.conn.on('chaos_event', ({ type, direction }) => {
      this.logChaos(`[Chaos] Simulated ${type} on ${direction} stream`, 'log-danger');
    });

    this.conn.on('sync_full', (snapshot) => {
      this._handleFullSync(snapshot);
    });

    this.conn.on('remote_mutation', (op) => {
      this._handleRemoteMutation(op);
    });

    this.conn.on('presence', (presenceMap) => {
      this._handleRemotePresence(presenceMap);
    });
  }

  switchTab(tab) {
    this.activeTab = tab;
    this.tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    Object.entries(this.views).forEach(([name, el]) => {
      el.classList.toggle('active', name === tab);
    });

    if (tab === 'chaos') {
      this._updateTopologyHighlight();
    }
  }

  _updateConnectionUI(state, queuedCount) {
    this.connStatusBadge.className = 'status-pill';
    if (state === 'CONNECTED') {
      this.connStatusBadge.classList.add('status-connected');
      this.connStatusText.textContent = 'CONNECTED';
    } else if (state === 'CONNECTING') {
      this.connStatusBadge.classList.add('status-connecting');
      this.connStatusText.textContent = 'CONNECTING';
    } else if (state === 'RECONNECTING') {
      this.connStatusBadge.classList.add('status-reconnecting');
      this.connStatusText.textContent = `RECONNECTING (${this.conn.reconnectAttempts})`;
    } else {
      this.connStatusBadge.classList.add('status-offline');
      this.connStatusText.textContent = `OFFLINE (${queuedCount} QUEUED)`;
    }
  }

  _updateTopologyHighlight() {
    const port = String(this.conn.serverPort);
    const nodeMap = { '4001': 1, '4002': 2, '4003': 3 };
    const activeNode = nodeMap[port] || 1;
    [this.topoNode1, this.topoNode2, this.topoNode3].forEach((el, idx) => {
      if (el) el.classList.toggle('active-node', idx + 1 === activeNode);
    });
    this.currentRouteLabel.innerHTML =
      `Client (${this.siteId}) &rarr; <strong class="highlight-node">Node ${activeNode} (:${port})</strong>`;
  }

  /* ==========================================================================
     Editor Synchronization & CRDT Handlers
     ========================================================================== */
  _handleEditorInput(e) {
    if (this.isLocalTyping) return;
    this.isLocalTyping = true;

    const currentText = this.editorTextarea.value;
    const prevText = this.previousText;

    // Diff currentText with prevText
    // Find common prefix
    let prefix = 0;
    while (prefix < prevText.length && prefix < currentText.length && prevText[prefix] === currentText[prefix]) {
      prefix++;
    }

    // Find common suffix
    let prevSuffix = prevText.length - 1;
    let currSuffix = currentText.length - 1;
    while (prevSuffix >= prefix && currSuffix >= prefix && prevText[prevSuffix] === currentText[currSuffix]) {
      prevSuffix--;
      currSuffix--;
    }

    // Characters deleted from prevText: range [prefix, prevSuffix]
    const deletedCount = prevSuffix - prefix + 1;
    if (deletedCount > 0) {
      for (let i = 0; i < deletedCount; i++) {
        // Always delete at prefix position as nodes shift
        const delOp = this.rga.delete(prefix);
        if (delOp) {
          this.conn.submitMutation(delOp);
        }
      }
    }

    // Characters inserted into currentText: range [prefix, currSuffix]
    const insertedStr = currentText.slice(prefix, currSuffix + 1);
    for (let i = 0; i < insertedStr.length; i++) {
      const char = insertedStr[i];
      const insertOp = this.rga.insert(prefix + i, char);
      if (insertOp) {
        this.conn.submitMutation(insertOp);
      }
    }

    this.previousText = currentText;
    this.isLocalTyping = false;

    this._updateEditorGutter();
    this._updateProofStats();
    this._broadcastCursor();
  }

  _handleRemoteMutation(op) {
    if (op.type === 'rga_insert') {
      this.rga.applyRemoteInsert(op);
      this._refreshEditorFromRga();
    } else if (op.type === 'rga_delete') {
      this.rga.applyRemoteDelete(op);
      this._refreshEditorFromRga();
    } else if (op.type === 'lww_set' || op.type === 'lww_delete') {
      this.canvasMap.applyRemoteOp(op);
      this._renderCanvasFromLww();
    }

    this._updateProofStats();
  }

  _refreshEditorFromRga() {
    const text = this.rga.toString();
    const selStart = this.editorTextarea.selectionStart;
    const selEnd = this.editorTextarea.selectionEnd;

    this.isLocalTyping = true;
    this.editorTextarea.value = text;
    this.previousText = text;
    this.editorTextarea.setSelectionRange(selStart, selEnd);
    this.isLocalTyping = false;

    this._updateEditorGutter();
  }

  _updateEditorGutter() {
    const lines = this.editorTextarea.value.split('\n').length;
    let gutterHtml = '';
    for (let i = 1; i <= lines; i++) {
      gutterHtml += `<div class="gutter-num">${i}</div>`;
    }
    this.editorGutter.innerHTML = gutterHtml;

    const charCount = this.rga.toString().length;
    const clockVal = this.rga.clock.getTime();
    this.rgaCharStats.textContent = `Chars: ${charCount} | Lamport: ${clockVal}`;
  }

  _broadcastCursor() {
    const pos = this.editorTextarea.selectionStart;
    this.conn.sendPresence({
      name: this.userName,
      color: this.userColor,
      cursorPos: pos,
      activeTab: this.activeTab
    });
  }

  _handleRemotePresence(presenceMap) {
    this.peers.clear();
    this.peerAvatarsContainer.innerHTML = '';

    for (const [clientId, data] of Object.entries(presenceMap)) {
      if (clientId === this.siteId) continue; // skip self
      this.peers.set(clientId, data);

      // Create avatar badge
      const avatar = document.createElement('div');
      avatar.className = 'peer-avatar';
      avatar.style.background = data.color || '#8b5cf6';
      avatar.textContent = (data.name || 'P')[0];
      avatar.title = `${data.name} (${clientId})`;
      this.peerAvatarsContainer.appendChild(avatar);
    }
  }

  /* ==========================================================================
     Whiteboard Canvas Synchronization (LWW-Map)
     ========================================================================== */
  _createCanvasItem(type = 'note') {
    const id = `item_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    const isService = type === 'service';
    const item = {
      id,
      type,
      title: isService ? 'Redis Node' : 'Quick Note',
      text: isService ? 'Pub/Sub Ingress Channel' : 'Collaborative thought...',
      x: 100 + Math.floor(Math.random() * 200),
      y: 100 + Math.floor(Math.random() * 200),
      color: isService ? '#8b5cf6' : '#38bdf8'
    };

    const op = this.canvasMap.set(id, item);
    this.conn.submitMutation(op);
    this._renderCanvasFromLww();
  }

  _renderCanvasFromLww() {
    const items = this.canvasMap.toObject();
    this.canvasGrid.innerHTML = '';

    for (const [id, item] of Object.entries(items)) {
      if (!item) continue;
      const el = document.createElement('div');
      el.className = 'canvas-item';
      el.id = `canvas-item-${id}`;
      el.style.left = `${item.x}px`;
      el.style.top = `${item.y}px`;
      el.style.borderColor = item.color || '#38bdf8';

      el.innerHTML = `
        <div class="canvas-item-header" style="background: ${item.color}22">
          <span class="canvas-item-title">${item.title || 'Note'}</span>
          <button class="canvas-item-del" title="Delete" data-id="${id}">&times;</button>
        </div>
        <div class="canvas-item-body">
          <textarea class="canvas-item-textarea" data-id="${id}">${item.text || ''}</textarea>
        </div>
        <div class="canvas-item-footer">
          <span>ID: ${id.slice(-6)}</span>
          <span>${item.x}px, ${item.y}px</span>
        </div>
      `;

      // Wire drag
      this._wireItemDrag(el, id, item);

      // Wire text edit
      const textarea = el.querySelector('.canvas-item-textarea');
      textarea.addEventListener('input', (e) => {
        item.text = e.target.value;
        const op = this.canvasMap.set(id, item);
        this.conn.submitMutation(op);
      });

      // Wire delete
      const delBtn = el.querySelector('.canvas-item-del');
      delBtn.addEventListener('click', () => {
        const op = this.canvasMap.delete(id);
        this.conn.submitMutation(op);
        this._renderCanvasFromLww();
      });

      this.canvasGrid.appendChild(el);
    }
  }

  _wireItemDrag(el, id, item) {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    const onMouseDown = (e) => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      initialLeft = item.x;
      initialTop = item.y;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const newX = Math.max(0, initialLeft + dx);
      const newY = Math.max(0, initialTop + dy);

      el.style.left = `${newX}px`;
      el.style.top = `${newY}px`;
      item.x = Math.round(newX);
      item.y = Math.round(newY);

      // Broadcast LWW-Map update throttled
      const op = this.canvasMap.set(id, item);
      this.conn.submitMutation(op);
    };

    const onMouseUp = () => {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    el.addEventListener('mousedown', onMouseDown);
  }

  _resetCanvasDefaults() {
    this._createCanvasItem('service');
    this._createCanvasItem('note');
  }

  /* ==========================================================================
     Full State Snapshot Reconciliation
     ========================================================================== */
  _handleFullSync(snapshot) {
    if (snapshot.rga) {
      this.rga.loadSnapshot(snapshot.rga);
      this._refreshEditorFromRga();
    }
    if (snapshot.canvas) {
      this.canvasMap.loadSnapshot(snapshot.canvas);
      this._renderCanvasFromLww();
    }
    if (snapshot.presence) {
      this._handleRemotePresence(snapshot.presence);
    }
    this._updateProofStats();
    this.logChaos(`[Snapshot] Full state reconciled with Node ${this.conn.serverPort}`, 'log-info');
  }

  /* ==========================================================================
     Chaos & Proof Metrics
     ========================================================================== */
  _updateProofStats() {
    const checksum = this.rga.computeChecksum();
    this.checksumVal.textContent = `#${checksum}`;
    this.proofChecksum.textContent = `#${checksum}`;
    this.proofRgaNodes.textContent = this.rga.nodes.length;
    this.proofLamportClock.textContent = this.rga.clock.getTime();
  }

  _renderQueueList(queue) {
    if (!queue || queue.length === 0) {
      this.queueItemsContainer.innerHTML = `<div class="queue-empty">Queue is empty — all mutations acknowledged by cluster.</div>`;
      return;
    }

    let html = '';
    for (const item of queue.slice(-10)) {
      html += `
        <div class="queue-row">
          <span class="queue-op-type">${item.op.type}</span>
          <span>${item.opId.slice(-12)}</span>
          <span>${Math.round((Date.now() - item.timestamp) / 100) / 10}s ago</span>
        </div>
      `;
    }
    this.queueItemsContainer.innerHTML = html;
  }

  logChaos(message, type = '') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const time = new Date().toLocaleTimeString();
    entry.textContent = `[${time}] ${message}`;
    this.chaosEventLog.prepend(entry);
  }
}

// Bootstrap once DOM ready
window.addEventListener('DOMContentLoaded', () => {
  window.__aetherApp = new AetherApp();
});
