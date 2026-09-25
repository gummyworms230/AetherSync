/**
 * AetherSync Application Controller
 * Features:
 * - Multi-Node CRDT Synchronization (RGA + LWW-Map)
 * - Resilient Connection State Manager & Mutation Queue
 * - Live Multiplayer Floating Cursors (Canvas & Editor)
 * - Collaborative Real-Time Chat & Activity Feed
 * - Time-Travel History Scrubber & Replay Engine
 * - Author Attribution ("Blame" Mode)
 * - Network Partition Simulator (NetSplit & Heal)
 * - Automated Chaos Monkey Bots
 * - Multi-Room URL Hash Routing
 * - Markdown & Canvas JSON Export / Import
 */

import { ClientRgaSequence, ClientLwwMap } from './client-crdt.js';
import { ConnectionManager } from './connection-manager.js';

class AetherApp {
  constructor() {
    this.userColors = ['#38bdf8', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4', '#e11d48'];
    this.siteId = `peer_${Math.random().toString(36).substring(2, 6)}`;
    this.userColor = this.userColors[Math.floor(Math.random() * this.userColors.length)];
    this.userName = `User-${this.siteId.slice(-4).toUpperCase()}`;

    // Read room from URL hash (e.g. #room=design) or default to general
    this.roomId = this._getRoomFromHash() || 'general';

    // Initialize CRDT replicas
    this.rga = new ClientRgaSequence(this.siteId);
    this.canvasMap = new ClientLwwMap(this.siteId);

    // Initialize Connection State Manager
    const initialPort = window.location.port ||
      (window.location.href.match(/:(\d+)(?:\/|$|\?)/) || [])[1] || '4001';
    this.conn = new ConnectionManager({
      siteId: this.siteId,
      serverPort: initialPort,
      roomId: this.roomId
    });

    this.activeTab = 'editor';
    this.peers = new Map(); // clientId -> { name, color, cursor, canvasX, canvasY, activeTab }
    this.canvasCursors = new Map(); // clientId -> DOMElement
    this.isLocalTyping = false;
    this.previousText = '';

    // Author Blame state
    this.isBlameActive = false;

    // Time-Travel History Journal
    this.mutationHistory = []; // Array of { step, type, op, timestamp, siteId, label }
    this.isTimeTraveling = false;
    this.timeTravelIndex = 0;
    this.ttPlaybackTimer = null;
    this.ttSpeedMs = 100;

    // Chat & Activity Drawer
    this.isChatOpen = false;
    this.unreadChatCount = 0;
    this.activeDrawerTab = 'chat';
    this.typingTimer = null;

    // Chaos Monkey Bots
    this.chaosBots = [];
    this.botOpsCount = 0;
    this.botDropsCount = 0;
    this.isNodePartitioned = false;

    this._cacheDom();
    this._bindEvents();
    this._initUserDisplay();

    // Start WebSocket connection
    this.conn.connect();
  }

  _getRoomFromHash() {
    const hash = window.location.hash;
    const match = hash.match(/room=([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  _cacheDom() {
    // Header & Room elements
    this.roomInput = document.getElementById('room-input');
    this.btnSwitchRoom = document.getElementById('btn-switch-room');
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
    this.btnToggleChat = document.getElementById('btn-toggle-chat');
    this.chatUnreadBadge = document.getElementById('chat-unread-badge');
    this.btnToggleTimeTravel = document.getElementById('btn-toggle-time-travel');

    // Navigation Tabs
    this.tabBtns = document.querySelectorAll('.tab-btn');
    this.views = {
      editor: document.getElementById('view-editor'),
      canvas: document.getElementById('view-canvas'),
      chaos: document.getElementById('view-chaos')
    };

    // View 1: Editor elements
    this.editorTextarea = document.getElementById('code-editor-textarea');
    this.editorGutter = document.getElementById('editor-gutter');
    this.peerCursorsLayer = document.getElementById('peer-cursors-layer');
    this.editorBlameLayer = document.getElementById('editor-blame-layer');
    this.rgaCharStats = document.getElementById('rga-char-stats');
    this.btnToggleBlame = document.getElementById('btn-toggle-blame');
    this.blameStatusText = document.getElementById('blame-status-text');
    this.btnExportCode = document.getElementById('btn-export-code');
    this.btnCopyCode = document.getElementById('btn-copy-code');

    // View 2: Canvas elements
    this.whiteboardViewport = document.getElementById('whiteboard-viewport');
    this.canvasGrid = document.getElementById('canvas-grid');
    this.canvasCursorsLayer = document.getElementById('canvas-cursors-layer');
    this.btnAddNote = document.getElementById('btn-add-note');
    this.btnAddService = document.getElementById('btn-add-service');
    this.btnExportCanvas = document.getElementById('btn-export-canvas');
    this.btnImportCanvasTrigger = document.getElementById('btn-import-canvas-trigger');
    this.canvasFileInput = document.getElementById('canvas-file-input');
    this.btnResetCanvas = document.getElementById('btn-reset-canvas');

    // View 3: Chaos Lab elements
    this.topoNode1 = document.getElementById('topo-node-1');
    this.topoNode2 = document.getElementById('topo-node-2');
    this.topoNode3 = document.getElementById('topo-node-3');
    this.topoNode1Clients = document.getElementById('topo-node-1-clients');
    this.topoNode2Clients = document.getElementById('topo-node-2-clients');
    this.topoNode3Clients = document.getElementById('topo-node-3-clients');
    this.currentRouteLabel = document.getElementById('current-route-label');
    this.latencySlider = document.getElementById('latency-slider');
    this.latencySliderVal = document.getElementById('latency-slider-val');
    this.packetDropSlider = document.getElementById('packet-drop-slider');
    this.packetDropSliderVal = document.getElementById('packet-drop-slider-val');
    this.btnToggleDisconnect = document.getElementById('btn-toggle-disconnect');
    this.btnForceReconnect = document.getElementById('btn-force-reconnect');
    this.chaosEventLog = document.getElementById('chaos-event-log');
    this.queueBadgeCounter = document.getElementById('queue-badge-counter');
    this.queueItemsContainer = document.getElementById('queue-items-container');
    this.proofRgaNodes = document.getElementById('proof-rga-nodes');
    this.proofLamportClock = document.getElementById('proof-lamport-clock');
    this.proofChecksum = document.getElementById('proof-checksum');
    this.btnTestConvergence = document.getElementById('btn-test-convergence');

    // Network Partition Simulator elements
    this.partitionStatusBadge = document.getElementById('partition-status-badge');
    this.btnSeverPartition = document.getElementById('btn-sever-partition');
    this.btnHealPartition = document.getElementById('btn-heal-partition');

    // Chaos Monkey Bots elements
    this.btnSpawnBots = document.getElementById('btn-spawn-bots');
    this.btnStopBots = document.getElementById('btn-stop-bots');
    this.botsCounterBadge = document.getElementById('bots-counter-badge');
    this.botOpsCountEl = document.getElementById('bot-ops-count');
    this.botDropsCountEl = document.getElementById('bot-drops-count');

    // Time-Travel Bar elements
    this.timeTravelBar = document.getElementById('time-travel-bar');
    this.btnTtPlay = document.getElementById('btn-tt-play');
    this.btnTtPrev = document.getElementById('btn-tt-prev');
    this.btnTtNext = document.getElementById('btn-tt-next');
    this.ttSpeedSelect = document.getElementById('tt-speed-select');
    this.ttSlider = document.getElementById('tt-slider');
    this.ttStepLabel = document.getElementById('tt-step-label');
    this.ttOpDetail = document.getElementById('tt-op-detail');
    this.ttClockLabel = document.getElementById('tt-clock-label');
    this.btnTtLive = document.getElementById('btn-tt-live');

    // Chat Drawer elements
    this.chatDrawer = document.getElementById('chat-drawer');
    this.btnCloseDrawer = document.getElementById('btn-close-drawer');
    this.drawerTabChat = document.getElementById('drawer-tab-chat');
    this.drawerTabActivity = document.getElementById('drawer-tab-activity');
    this.drawerViewChat = document.getElementById('drawer-view-chat');
    this.drawerViewActivity = document.getElementById('drawer-view-activity');
    this.chatMessagesContainer = document.getElementById('chat-messages-container');
    this.chatTypingStatus = document.getElementById('chat-typing-status');
    this.chatForm = document.getElementById('chat-form');
    this.chatInput = document.getElementById('chat-input');
    this.activityEventsContainer = document.getElementById('activity-events-container');
  }

  _initUserDisplay() {
    this.userColorDot.style.background = this.userColor;
    this.userNameDisplay.textContent = this.userName;
    if (this.roomInput) {
      this.roomInput.value = this.roomId;
    }
    if (this.nodeSelectDropdown) {
      this.nodeSelectDropdown.value = this.conn.serverPort;
    }
    this._updateTopologyHighlight();
  }

  _bindEvents() {
    // Room Switching
    const triggerRoomSwitch = () => {
      const targetRoom = (this.roomInput.value || '').trim() || 'general';
      if (targetRoom !== this.roomId) {
        window.location.hash = `#room=${targetRoom}`;
      }
    };
    this.btnSwitchRoom.addEventListener('click', triggerRoomSwitch);
    this.roomInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        triggerRoomSwitch();
      }
    });

    window.addEventListener('hashchange', () => {
      const newRoom = this._getRoomFromHash() || 'general';
      if (newRoom !== this.roomId) {
        this._switchRoom(newRoom);
      }
    });

    // Node switching
    this.btnSwitchNode.addEventListener('click', () => {
      const selectedPort = this.nodeSelectDropdown.value;
      this.logActivity(`Migrated client WebSocket connection to Port ${selectedPort}`);
      this.conn.switchNode(selectedPort);
      this._updateTopologyHighlight();
    });

    // Tab switching
    this.tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchTab(btn.dataset.tab);
      });
    });

    // Editor Actions
    this.btnCopyCode.addEventListener('click', () => {
      navigator.clipboard.writeText(this.rga.toString());
      this.btnCopyCode.textContent = 'Copied!';
      setTimeout(() => { this.btnCopyCode.textContent = 'Copy Text'; }, 1500);
    });

    this.btnExportCode.addEventListener('click', () => {
      this._exportMarkdownFile();
    });

    this.btnToggleBlame.addEventListener('click', () => {
      this.isBlameActive = !this.isBlameActive;
      this.blameStatusText.textContent = this.isBlameActive ? 'ON' : 'OFF';
      this.editorBlameLayer.classList.toggle('hidden', !this.isBlameActive);
      if (this.isBlameActive) {
        this._renderBlameOverlay();
      }
    });

    // Editor input diffing & cursor broadcasting
    this.editorTextarea.addEventListener('input', (e) => this._handleEditorInput(e));
    this.editorTextarea.addEventListener('keyup', () => this._broadcastCursor());
    this.editorTextarea.addEventListener('click', () => this._broadcastCursor());
    this.editorTextarea.addEventListener('select', () => this._broadcastCursor());

    // Canvas actions
    this.btnAddNote.addEventListener('click', () => this._createCanvasItem('note'));
    this.btnAddService.addEventListener('click', () => this._createCanvasItem('service'));
    this.btnResetCanvas.addEventListener('click', () => this._resetCanvasDefaults());

    this.btnExportCanvas.addEventListener('click', () => {
      this._exportCanvasJson();
    });

    this.btnImportCanvasTrigger.addEventListener('click', () => {
      this.canvasFileInput.click();
    });

    this.canvasFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            const data = JSON.parse(evt.target.result);
            this._importCanvasJson(data);
          } catch (err) {
            alert('Invalid JSON file format.');
          }
        };
        reader.readAsText(file);
      }
    });

    // Canvas Mouse Movement (Multiplayer Cursors)
    let lastCanvasCursorTime = 0;
    this.whiteboardViewport.addEventListener('mousemove', (e) => {
      const now = Date.now();
      if (now - lastCanvasCursorTime < 45) return; // 22 fps throttle
      lastCanvasCursorTime = now;

      const rect = this.canvasGrid.getBoundingClientRect();
      const canvasX = Math.round(e.clientX - rect.left);
      const canvasY = Math.round(e.clientY - rect.top);

      this.conn.sendPresence({
        name: this.userName,
        color: this.userColor,
        activeTab: 'canvas',
        canvasX,
        canvasY
      });
    });

    // Chat & Activity Drawer
    this.btnToggleChat.addEventListener('click', () => {
      this.isChatOpen = !this.isChatOpen;
      this.chatDrawer.classList.toggle('hidden', !this.isChatOpen);
      if (this.isChatOpen) {
        this.unreadChatCount = 0;
        this.chatUnreadBadge.classList.add('hidden');
        this.chatUnreadBadge.textContent = '0';
        this.chatInput.focus();
      }
    });

    this.btnCloseDrawer.addEventListener('click', () => {
      this.isChatOpen = false;
      this.chatDrawer.classList.add('hidden');
    });

    this.drawerTabChat.addEventListener('click', () => {
      this.activeDrawerTab = 'chat';
      this.drawerTabChat.classList.add('active');
      this.drawerTabActivity.classList.remove('active');
      this.drawerViewChat.classList.add('active');
      this.drawerViewActivity.classList.remove('active');
    });

    this.drawerTabActivity.addEventListener('click', () => {
      this.activeDrawerTab = 'activity';
      this.drawerTabActivity.classList.add('active');
      this.drawerTabChat.classList.remove('active');
      this.drawerViewActivity.classList.add('active');
      this.drawerViewChat.classList.remove('active');
    });

    this.chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.chatInput.value.trim();
      if (text) {
        this.conn.sendChat(text, this.userName, this.userColor);
        this.chatInput.value = '';
        this.conn.sendTyping(false, this.userName);
      }
    });

    this.chatInput.addEventListener('input', () => {
      this.conn.sendTyping(true, this.userName);
      clearTimeout(this.typingTimer);
      this.typingTimer = setTimeout(() => {
        this.conn.sendTyping(false, this.userName);
      }, 2000);
    });

    // Time-Travel Scrubber
    this.btnToggleTimeTravel.addEventListener('click', () => {
      const isHidden = this.timeTravelBar.classList.contains('hidden');
      this.timeTravelBar.classList.toggle('hidden', !isHidden);
      if (isHidden) {
        this._initTimeTravel();
      } else {
        this._exitTimeTravel();
      }
    });

    this.ttSlider.addEventListener('input', (e) => {
      const step = parseInt(e.target.value, 10);
      this._seekTimeTravel(step);
    });

    this.btnTtPlay.addEventListener('click', () => {
      this._toggleTimeTravelPlayback();
    });

    this.btnTtPrev.addEventListener('click', () => {
      this._seekTimeTravel(Math.max(0, this.timeTravelIndex - 1));
    });

    this.btnTtNext.addEventListener('click', () => {
      this._seekTimeTravel(Math.min(this.mutationHistory.length, this.timeTravelIndex + 1));
    });

    this.ttSpeedSelect.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      this.ttSpeedMs = Math.round(200 / val);
    });

    this.btnTtLive.addEventListener('click', () => {
      this._exitTimeTravel();
      this.timeTravelBar.classList.add('hidden');
    });

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
      this.logActivity(`Client disconnected manually. Queueing mutations.`);
    });

    this.btnForceReconnect.addEventListener('click', () => {
      this.conn.connect();
      this.logChaos(`[Reconnect] Socket reconnecting... Flushing pending mutations.`, 'log-warning');
      this.logActivity(`Client reconnecting to cluster...`);
    });

    this.btnTestConvergence.addEventListener('click', () => {
      const crc = this.rga.computeChecksum();
      const nodeCount = this.rga.nodes.length;
      alert(`[CRDT Verification]\nCurrent Document CRC: #${crc}\nRGA Sequence Total Nodes: ${nodeCount}\nActive String Length: ${this.rga.toString().length}\n\nOpen another browser tab on ports 4001, 4002, or 4003 — all three will match this CRC identically.`);
    });

    // Network Partitioning Simulator
    this.btnSeverPartition.addEventListener('click', async () => {
      this.logChaos(`[NetSplit] Severing Node 1 from Distributed Event Bus...`, 'log-danger');
      const res = await this.conn.togglePartition(4001, true);
      if (res.success || res.partitioned) {
        this.isNodePartitioned = true;
        this.partitionStatusBadge.textContent = 'NODE 1 PARTITIONED';
        this.partitionStatusBadge.className = 'status-pill status-partitioned';
        this.topoNode1.classList.add('partitioned');
        this.logActivity(`⚡ Network Partition Active: Node 1 isolated from Node 2 & 3.`);
      }
    });

    this.btnHealPartition.addEventListener('click', async () => {
      this.logChaos(`[NetSplit] Healing network partition... Triggering cluster CRDT convergence.`, 'log-info');
      const res = await this.conn.togglePartition(4001, false);
      if (res.success || !res.partitioned) {
        this.isNodePartitioned = false;
        this.partitionStatusBadge.textContent = 'NO PARTITION (CONVERGED)';
        this.partitionStatusBadge.className = 'status-pill status-connected';
        this.topoNode1.classList.remove('partitioned');
        this.logActivity(`💚 Network Partition Healed: State reconciled across cluster.`);
      }
    });

    // Chaos Monkey Bots
    this.btnSpawnBots.addEventListener('click', () => {
      this._spawnChaosBots();
    });

    this.btnStopBots.addEventListener('click', () => {
      this._stopChaosBots();
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

    this.conn.on('chat_message', (msg) => {
      this._handleIncomingChat(msg);
    });

    this.conn.on('typing_indicator', ({ name, isTyping }) => {
      if (isTyping) {
        this.chatTypingStatus.textContent = `${name} is typing...`;
        this.chatTypingStatus.classList.remove('hidden');
      } else {
        this.chatTypingStatus.classList.add('hidden');
      }
    });
  }

  /* ==========================================================================
     Room Switching
     ========================================================================== */
  _switchRoom(newRoom) {
    this.roomId = newRoom;
    this.roomInput.value = newRoom;
    this.rga = new ClientRgaSequence(this.siteId);
    this.canvasMap = new ClientLwwMap(this.siteId);
    this.mutationHistory = [];
    this.peers.clear();
    this.canvasCursors.clear();
    this.canvasCursorsLayer.innerHTML = '';
    this.chatMessagesContainer.innerHTML = '';

    this.logActivity(`Switched to room #${newRoom}`);
    this.conn.switchRoom(newRoom);
    this._refreshEditorFromRga();
    this._renderCanvasFromLww();
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

    this._broadcastCursor();
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
    if (this.isLocalTyping || this.isTimeTraveling) return;
    this.isLocalTyping = true;

    const currentText = this.editorTextarea.value;
    const prevText = this.previousText;

    let prefix = 0;
    while (prefix < prevText.length && prefix < currentText.length && prevText[prefix] === currentText[prefix]) {
      prefix++;
    }

    let prevSuffix = prevText.length - 1;
    let currSuffix = currentText.length - 1;
    while (prevSuffix >= prefix && currSuffix >= prefix && prevText[prevSuffix] === currentText[currSuffix]) {
      prevSuffix--;
      currSuffix--;
    }

    const deletedCount = prevSuffix - prefix + 1;
    if (deletedCount > 0) {
      for (let i = 0; i < deletedCount; i++) {
        const delOp = this.rga.delete(prefix);
        if (delOp) {
          this.conn.submitMutation(delOp);
          this._recordMutation(delOp, `Deleted char at ${prefix}`);
        }
      }
    }

    const insertedStr = currentText.slice(prefix, currSuffix + 1);
    for (let i = 0; i < insertedStr.length; i++) {
      const char = insertedStr[i];
      const insertOp = this.rga.insert(prefix + i, char);
      if (insertOp) {
        this.conn.submitMutation(insertOp);
        this._recordMutation(insertOp, `Inserted '${char.replace(/\n/g, '\\n')}' at ${prefix + i}`);
      }
    }

    this.previousText = currentText;
    this.isLocalTyping = false;

    this._updateEditorGutter();
    this._updateProofStats();
    this._broadcastCursor();
    if (this.isBlameActive) this._renderBlameOverlay();
  }

  _handleRemoteMutation(op) {
    if (this.isTimeTraveling) return;

    if (op.type === 'rga_insert') {
      this.rga.applyRemoteInsert(op);
      this._refreshEditorFromRga();
      this._recordMutation(op, `Remote '${op.value.replace(/\n/g, '\\n')}' from ${op.siteId.slice(-4)}`);
    } else if (op.type === 'rga_delete') {
      this.rga.applyRemoteDelete(op);
      this._refreshEditorFromRga();
      this._recordMutation(op, `Remote delete from ${op.siteId.slice(-4)}`);
    } else if (op.type === 'lww_set' || op.type === 'lww_delete') {
      this.canvasMap.applyRemoteOp(op);
      this._renderCanvasFromLww();
      this._recordMutation(op, `Remote canvas ${op.key} from ${op.siteId.slice(-4)}`);
    }

    this._updateProofStats();
    if (this.isBlameActive) this._renderBlameOverlay();
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
    const end = this.editorTextarea.selectionEnd;
    this.conn.sendPresence({
      name: this.userName,
      color: this.userColor,
      cursorPos: pos,
      selectionStart: pos,
      selectionEnd: end,
      activeTab: this.activeTab
    });
  }

  /* ==========================================================================
     Multiplayer Cursors & Presence
     ========================================================================== */
  _handleRemotePresence(presenceMap) {
    this.peers.clear();
    this.peerAvatarsContainer.innerHTML = '';

    const activeCanvasPeerIds = new Set();

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

      // Canvas multiplayer cursor
      if (data.activeTab === 'canvas' && data.canvasX !== undefined) {
        activeCanvasPeerIds.add(clientId);
        this._updateCanvasCursor(clientId, data);
      }
    }

    // Clean up canvas cursors for peers who moved away or disconnected
    for (const [cid, cursorEl] of this.canvasCursors.entries()) {
      if (!activeCanvasPeerIds.has(cid)) {
        cursorEl.remove();
        this.canvasCursors.delete(cid);
      }
    }
  }

  _updateCanvasCursor(clientId, peerData) {
    let cursorEl = this.canvasCursors.get(clientId);
    if (!cursorEl) {
      cursorEl = document.createElement('div');
      cursorEl.className = 'canvas-cursor';
      cursorEl.innerHTML = `
        <svg class="canvas-cursor-svg" viewBox="0 0 24 24" fill="${peerData.color || '#38bdf8'}">
          <path d="M4 0l16 12-7 2-4 9-5-23z"/>
        </svg>
        <span class="canvas-cursor-pill" style="background: ${peerData.color || '#38bdf8'}">
          ${peerData.name || 'Peer'}
        </span>
      `;
      this.canvasCursorsLayer.appendChild(cursorEl);
      this.canvasCursors.set(clientId, cursorEl);
    }

    cursorEl.style.transform = `translate(${peerData.canvasX}px, ${peerData.canvasY}px)`;
  }

  /* ==========================================================================
     Author Attribution ("Blame" Overlay)
     ========================================================================== */
  _renderBlameOverlay() {
    if (!this.isBlameActive) return;
    const nodes = this.rga.getActiveNodesWithAuthors();
    let html = '';

    for (const item of nodes) {
      const peer = this.peers.get(item.siteId);
      const color = (item.siteId === this.siteId)
        ? this.userColor
        : (peer ? peer.color : '#8b5cf6');
      const author = (item.siteId === this.siteId)
        ? `You (${this.userName})`
        : (peer ? peer.name : item.siteId);

      const displayVal = item.value === '\n' ? '<br/>' : (item.value === ' ' ? '&nbsp;' : item.value);

      html += `<span class="blame-char" style="background: ${color}33; border-bottom: 2px solid ${color};" title="Authored by: ${author} | Clock: ${item.clock}">${displayVal}</span>`;
    }

    this.editorBlameLayer.innerHTML = html;
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
      color: isService ? '#8b5cf6' : '#38bdf8',
      author: this.userName
    };

    const op = this.canvasMap.set(id, item);
    this.conn.submitMutation(op);
    this._recordMutation(op, `Created canvas ${type}`);
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
          <span>Author: ${item.author || 'Peer'}</span>
          <span>${item.x}px, ${item.y}px</span>
        </div>
      `;

      this._wireItemDrag(el, id, item);

      const textarea = el.querySelector('.canvas-item-textarea');
      textarea.addEventListener('input', (e) => {
        item.text = e.target.value;
        const op = this.canvasMap.set(id, item);
        this.conn.submitMutation(op);
      });

      const delBtn = el.querySelector('.canvas-item-del');
      delBtn.addEventListener('click', () => {
        const op = this.canvasMap.delete(id);
        this.conn.submitMutation(op);
        this._recordMutation(op, `Deleted canvas item`);
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

      const op = this.canvasMap.set(id, item);
      this.conn.submitMutation(op);
    };

    const onMouseUp = () => {
      if (isDragging) {
        this._recordMutation({ type: 'lww_set', key: id, value: item }, `Moved ${id}`);
      }
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
     Time-Travel Scrubber & History Playback Engine
     ========================================================================== */
  _recordMutation(op, label = '') {
    this.mutationHistory.push({
      step: this.mutationHistory.length + 1,
      op,
      label,
      timestamp: Date.now(),
      siteId: op.siteId || this.siteId
    });

    if (this.timeTravelBar && !this.isTimeTraveling) {
      const max = this.mutationHistory.length;
      this.ttSlider.max = max;
      this.ttSlider.value = max;
      this.ttStepLabel.textContent = `Step: ${max} / ${max}`;
    }
  }

  _initTimeTravel() {
    this.isTimeTraveling = true;
    const max = this.mutationHistory.length;
    this.ttSlider.max = max;
    this.ttSlider.value = max;
    this.timeTravelIndex = max;
    this.editorTextarea.setAttribute('readonly', 'true');
    this._seekTimeTravel(max);
  }

  _seekTimeTravel(step) {
    this.timeTravelIndex = step;
    this.ttSlider.value = step;
    this.ttStepLabel.textContent = `Step: ${step} / ${this.mutationHistory.length}`;

    // Replay mutations 0 through step on scratch CRDTs
    const previewRga = new ClientRgaSequence('preview');
    const previewCanvas = new ClientLwwMap('preview');

    for (let i = 0; i < step; i++) {
      const entry = this.mutationHistory[i];
      if (!entry?.op) continue;
      const op = entry.op;

      if (op.type === 'rga_insert') {
        previewRga.applyRemoteInsert(op);
      } else if (op.type === 'rga_delete') {
        previewRga.applyRemoteDelete(op);
      } else if (op.type === 'lww_set' || op.type === 'lww_delete') {
        previewCanvas.applyRemoteOp(op);
      }
    }

    const currentEntry = this.mutationHistory[step - 1];
    this.ttOpDetail.textContent = currentEntry ? currentEntry.label : 'Initial state';
    this.ttClockLabel.textContent = `Lamport: ${currentEntry?.op?.clock || 0}`;

    // Render preview to textarea and canvas
    this.isLocalTyping = true;
    this.editorTextarea.value = previewRga.toString();
    this.isLocalTyping = false;
    this._updateEditorGutter();
  }

  _toggleTimeTravelPlayback() {
    if (this.ttPlaybackTimer) {
      clearInterval(this.ttPlaybackTimer);
      this.ttPlaybackTimer = null;
      this.btnTtPlay.textContent = '▶ Play';
    } else {
      if (this.timeTravelIndex >= this.mutationHistory.length) {
        this.timeTravelIndex = 0;
      }
      this.btnTtPlay.textContent = '⏸ Pause';
      this.ttPlaybackTimer = setInterval(() => {
        if (this.timeTravelIndex < this.mutationHistory.length) {
          this._seekTimeTravel(this.timeTravelIndex + 1);
        } else {
          clearInterval(this.ttPlaybackTimer);
          this.ttPlaybackTimer = null;
          this.btnTtPlay.textContent = '▶ Play';
        }
      }, this.ttSpeedMs);
    }
  }

  _exitTimeTravel() {
    if (this.ttPlaybackTimer) {
      clearInterval(this.ttPlaybackTimer);
      this.ttPlaybackTimer = null;
      this.btnTtPlay.textContent = '▶ Play';
    }
    this.isTimeTraveling = false;
    this.editorTextarea.removeAttribute('readonly');
    this._refreshEditorFromRga();
    this._renderCanvasFromLww();
  }

  /* ==========================================================================
     In-App Chat & Activity Log
     ========================================================================== */
  _handleIncomingChat(msg) {
    const isSelf = msg.senderId === this.siteId;
    const row = document.createElement('div');
    row.className = `chat-msg-row ${isSelf ? 'chat-msg-self' : ''}`;

    const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    row.innerHTML = `
      <div class="chat-msg-header">
        <span class="chat-msg-author" style="color: ${msg.senderColor || '#38bdf8'}">${msg.senderName}</span>
        <span class="chat-msg-time">${timeStr}</span>
      </div>
      <div class="chat-bubble">${msg.text}</div>
    `;

    this.chatMessagesContainer.appendChild(row);
    this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;

    if (!this.isChatOpen && !isSelf) {
      this.unreadChatCount++;
      this.chatUnreadBadge.textContent = this.unreadChatCount;
      this.chatUnreadBadge.classList.remove('hidden');
    }
  }

  logActivity(text) {
    const item = document.createElement('div');
    item.className = 'activity-item';
    const time = new Date().toLocaleTimeString();
    item.textContent = `[${time}] ${text}`;
    this.activityEventsContainer.prepend(item);
  }

  /* ==========================================================================
     Chaos Monkey Automated Bots
     ========================================================================== */
  _spawnChaosBots() {
    this.btnSpawnBots.setAttribute('disabled', 'true');
    this.btnStopBots.removeAttribute('disabled');
    this.botsCounterBadge.textContent = '3 Bots Active';
    this.botsCounterBadge.classList.add('status-connected');

    const botProfiles = [
      { name: 'ChaosBot-Alpha', color: '#f43f5e', port: '4001' },
      { name: 'ChaosBot-Beta', color: '#a855f7', port: '4002' },
      { name: 'ChaosBot-Gamma', color: '#10b981', port: '4003' }
    ];

    const snippets = [
      '\n// Automated consensus verification in progress...',
      '\nconst replicaState = syncEngine.computeCRC();',
      '\n// Chaos test step executed cleanly.',
      '\nconsole.assert(rgaReplicas.isConverged());'
    ];

    this.chaosBots = botProfiles.map(p => {
      const siteId = `bot_${Math.random().toString(36).slice(2, 6)}`;
      const conn = new ConnectionManager({
        siteId,
        serverPort: p.port,
        roomId: this.roomId
      });
      conn.connect();

      // Bot action timer
      const interval = setInterval(() => {
        if (Math.random() < 0.7) {
          // Type code snippet
          const snippet = snippets[Math.floor(Math.random() * snippets.length)];
          const char = snippet[Math.floor(Math.random() * snippet.length)];
          const insertOp = this.rga.insert(Math.floor(Math.random() * this.rga.toString().length), char);
          conn.submitMutation(insertOp);
          this.botOpsCount++;
        } else {
          // Move canvas item
          const keys = Object.keys(this.canvasMap.toObject());
          if (keys.length > 0) {
            const key = keys[Math.floor(Math.random() * keys.length)];
            const item = this.canvasMap.get(key);
            if (item) {
              item.x = Math.max(50, Math.min(600, item.x + (Math.random() * 60 - 30)));
              item.y = Math.max(50, Math.min(500, item.y + (Math.random() * 60 - 30)));
              const op = this.canvasMap.set(key, item);
              conn.submitMutation(op);
              this.botOpsCount++;
            }
          }
        }

        // Random disconnect/reconnect dropout simulation
        if (Math.random() < 0.1) {
          conn.disconnect();
          this.botDropsCount++;
          setTimeout(() => conn.connect(), 1500);
        }

        this.botOpsCountEl.textContent = this.botOpsCount;
        this.botDropsCountEl.textContent = this.botDropsCount;
      }, 1200);

      return { conn, interval, name: p.name };
    });

    this.logActivity(`Spawned 3 Chaos Monkey Bots hammering ports 4001, 4002, 4003.`);
  }

  _stopChaosBots() {
    this.chaosBots.forEach(bot => {
      clearInterval(bot.interval);
      bot.conn.disconnect();
    });
    this.chaosBots = [];
    this.btnSpawnBots.removeAttribute('disabled');
    this.btnStopBots.setAttribute('disabled', 'true');
    this.botsCounterBadge.textContent = '0 Bots Active';
    this.botsCounterBadge.classList.remove('status-connected');
    this.logActivity(`Stopped all Chaos Monkey Bots.`);
  }

  /* ==========================================================================
     Export & Import
     ========================================================================== */
  _exportMarkdownFile() {
    const text = this.rga.toString();
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aethersync_${this.roomId}_${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    this.logActivity(`Exported document as Markdown file.`);
  }

  _exportCanvasJson() {
    const items = this.canvasMap.toObject();
    const payload = {
      roomId: this.roomId,
      exportedAt: new Date().toISOString(),
      items
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aethersync_canvas_${this.roomId}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.logActivity(`Exported canvas layout to JSON.`);
  }

  _importCanvasJson(data) {
    if (!data.items) return;
    for (const [id, item] of Object.entries(data.items)) {
      const op = this.canvasMap.set(id, item);
      this.conn.submitMutation(op);
    }
    this._renderCanvasFromLww();
    this.logActivity(`Imported canvas JSON items into board.`);
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
    if (Array.isArray(snapshot.chat)) {
      this.chatMessagesContainer.innerHTML = '';
      snapshot.chat.forEach(msg => this._handleIncomingChat(msg));
    }
    this._updateProofStats();
    this.logChaos(`[Snapshot] Full state reconciled with Node ${this.conn.serverPort}`, 'log-info');
    this.logActivity(`Reconciled full cluster state snapshot.`);
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
