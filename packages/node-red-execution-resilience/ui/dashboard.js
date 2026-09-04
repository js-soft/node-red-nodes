if (typeof renderjson !== 'undefined') {
  renderjson.set_show_to_level(1);
  renderjson.set_max_string_length(300);
}

// A small palette distinct from every status-badge color already in use
// (green/orange/red/yellow/purple/pink are all taken - see .status-* in
// dashboard.css), used purely to visually tie together messages that are
// repetitions of the same node - a Split node's parts, or several
// checkpoint messages recorded at the same Mark Replay Point - wherever
// they're listed together, so it's obvious at a glance which entries
// belong to the same repeated occurrence.
const REPEAT_COLORS = [
  { border: '#00897b', bg: '#e0f2f1' }, // teal
  { border: '#3949ab', bg: '#e8eaf6' }, // indigo
  { border: '#00acc1', bg: '#e0f7fa' }, // cyan
  { border: '#6d4c41', bg: '#efebe9' }, // brown
  { border: '#827717', bg: '#f9fbe7' }, // olive
  { border: '#455a64', bg: '#eceff1' }  // slate
];

class ExecutionHistoryDashboard {
  constructor() {
    this.database = this.getQueryParam('database') || 'default';
    this.page = 1;
    this.limit = 50;
    // Deep link from the editor sidebar's health overview (see
    // execution-resilience.html) - opens straight to one execution's detail
    // view and pre-fills the search box with it, rather than landing on
    // the plain unfiltered list.
    this.initialExecutionId = this.getQueryParam('executionId') || '';
    this.currentSearch = this.initialExecutionId;
    this.currentStatusFilter = '';
    this.currentFlowFilter = '';
    this.currentReplayFilter = false;
    this.currentExecution = null;
    // { executionId, mode, messageIds } stashed between the checkpoint
    // picker and the "reset automatic retry count?" follow-up popup - see
    // renderAutoResetChoice/confirmAutoResetChoice.
    this.pendingReplay = null;
    // On by default - a chain of automatic retries otherwise floods the
    // list with rows that are really just one logical run (see
    // listExecutionsGrouped in mongodb-adapter.js).
    this.groupReplays = true;
    // Root executionIds whose row is currently expanded into its individual
    // chain members (oldest-to-newest) instead of the one grouped summary
    // row - an alternative to turning grouping off entirely for the whole
    // list, see toggleChainExpansion.
    this.expandedChains = new Set();
    this.currentPageExecutions = [];

    this.deepSearchPage = 1;
    this.deepSearchTerm = '';
    this.deepSearchStatusFilter = '';
    this.deepSearchFlowFilter = '';
    this.deepSearchMatchPosition = 'first';
    this.pendingHighlightNodeId = null;
    this.pendingHighlightMessageId = null;

    this.initializeElements();
    this.attachEventListeners();
    this.updateActiveStatCard();

    if (this.initialExecutionId) {
      this.searchInput.value = this.initialExecutionId;
      this.showDetail(this.initialExecutionId);
    }

    this.loadExecutions();
    this.loadStatistics();
    this.loadFlows();
    this.loadConfig();

    setInterval(() => this.loadStatistics(), 5000);
    setInterval(() => this.loadExecutions(), 10000);
    setInterval(() => this.loadFlows(), 10000);
  }

  initializeElements() {
    this.tabButtons = document.querySelectorAll('.tab-btn');
    this.tabPanelExecutions = document.getElementById('tabPanelExecutions');
    this.tabPanelDocs = document.getElementById('tabPanelDocs');
    this.errorBanner = document.getElementById('errorBanner');
    this.authWarningBanner = document.getElementById('authWarningBanner');
    this.searchInput = document.getElementById('searchInput');
    this.flowFilter = document.getElementById('flowFilter');
    this.flowFilterOptions = document.getElementById('flowFilterOptions');
    this.statusFilter = document.getElementById('statusFilter');
    this.refreshBtn = document.getElementById('refreshBtn');
    this.clearScope = document.getElementById('clearScope');
    this.clearBtn = document.getElementById('clearBtn');
    this.executionsTableBody = document.getElementById('executionsTableBody');
    this.detailPane = document.getElementById('detailPane');
    this.detailBody = document.getElementById('detailBody');
    this.detailTitle = document.getElementById('detailTitle');
    this.closeDetailBtn = document.getElementById('closeDetailBtn');
    this.prevBtn = document.getElementById('prevBtn');
    this.nextBtn = document.getElementById('nextBtn');
    this.pageInfo = document.getElementById('pageInfo');
    this.totalCount = document.getElementById('totalCount');
    this.runningCount = document.getElementById('runningCount');
    this.completedCount = document.getElementById('completedCount');
    this.failedCount = document.getElementById('failedCount');
    this.replaysCount = document.getElementById('replaysCount');
    this.statCards = document.querySelectorAll('.stat-card[data-status]');
    this.statCardReplays = document.getElementById('statCardReplays');
    this.groupReplaysToggle = document.getElementById('groupReplaysToggle');

    this.tabBtnDeepSearch = document.getElementById('tabBtnDeepSearch');
    this.tabPanelDeepSearch = document.getElementById('tabPanelDeepSearch');
    this.deepSearchInput = document.getElementById('deepSearchInput');
    this.deepSearchFlowFilterEl = document.getElementById('deepSearchFlowFilter');
    this.deepSearchStatusFilterEl = document.getElementById('deepSearchStatusFilter');
    this.deepSearchMatchPositionEl = document.getElementById('deepSearchMatchPosition');
    this.deepSearchBtn = document.getElementById('deepSearchBtn');
    this.deepSearchNotice = document.getElementById('deepSearchNotice');
    this.deepSearchResults = document.getElementById('deepSearchResults');
    this.deepSearchPrevBtn = document.getElementById('deepSearchPrevBtn');
    this.deepSearchNextBtn = document.getElementById('deepSearchNextBtn');
    this.deepSearchPageInfo = document.getElementById('deepSearchPageInfo');

    this.replayModalBackdrop = document.getElementById('replayModalBackdrop');
    this.replayModal = document.getElementById('replayModal');
  }

  attachEventListeners() {
    this.tabButtons.forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    this.searchInput.addEventListener('change', () => this.onSearchChange());
    this.flowFilter.addEventListener('change', () => this.onFlowFilterChange());
    this.statusFilter.addEventListener('change', () => this.onFilterChange());
    this.refreshBtn.addEventListener('click', () => this.loadExecutions());
    this.clearBtn.addEventListener('click', () => this.clearExecutions());
    this.prevBtn.addEventListener('click', () => this.previousPage());
    this.nextBtn.addEventListener('click', () => this.nextPage());
    this.closeDetailBtn.addEventListener('click', () => this.closeDetail());

    this.statCards.forEach(card => {
      card.addEventListener('click', () => {
        this.currentStatusFilter = card.dataset.status;
        this.statusFilter.value = this.currentStatusFilter;
        this.page = 1;
        this.updateActiveStatCard();
        this.loadExecutions();
      });
    });

    // Independent of the status cards above (a boolean toggle, not a
    // mutually-exclusive value) - combines with whatever status/flow/search
    // filter is also active, e.g. "FAILED replays".
    this.statCardReplays.addEventListener('click', () => {
      this.currentReplayFilter = !this.currentReplayFilter;
      this.page = 1;
      this.updateActiveStatCard();
      this.loadExecutions();
    });

    this.groupReplaysToggle.addEventListener('change', () => {
      this.groupReplays = this.groupReplaysToggle.checked;
      this.page = 1;
      this.loadExecutions();
    });

    this.deepSearchBtn.addEventListener('click', () => this.onDeepSearchSubmit());
    this.deepSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.onDeepSearchSubmit();
    });
    this.deepSearchFlowFilterEl.addEventListener('change', () => this.onDeepSearchSubmit());
    this.deepSearchStatusFilterEl.addEventListener('change', () => this.onDeepSearchSubmit());
    this.deepSearchMatchPositionEl.addEventListener('change', () => this.onDeepSearchSubmit());
    this.deepSearchPrevBtn.addEventListener('click', () => this.deepSearchPreviousPage());
    this.deepSearchNextBtn.addEventListener('click', () => this.deepSearchNextPage());

    this.replayModalBackdrop.addEventListener('click', (e) => {
      if (e.target === this.replayModalBackdrop) this.closeReplayModal();
    });
  }

  async loadConfig() {
    try {
      const response = await fetch('/api/executions/config');
      const config = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(config.error || 'Failed to load config');

      this.deepSearchEnabled = config.deepSearchEnabled === true;
      this.tabBtnDeepSearch.style.display = this.deepSearchEnabled ? '' : 'none';
      this.unsafeReplayEnabled = config.unsafeReplayEnabled === true;
      // Reaching this response at all already proves auth passed (or
      // wasn't required) - config.authConfigured says which, so an
      // instance running with no protection at all gets an impossible-to-
      // miss warning rather than silently exposing execution/message data
      // to anyone who can reach this page.
      this.authWarningBanner.style.display = config.authConfigured === false ? 'block' : 'none';
    } catch (err) {
      // Deep Search tab just stays hidden - not surfaced as a banner, since
      // every other tab still works fine without this succeeding.
      console.error('Error loading config:', err);
    }
  }

  switchTab(tab) {
    this.tabButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    this.tabPanelExecutions.style.display = tab === 'executions' ? 'block' : 'none';
    this.tabPanelDeepSearch.style.display = tab === 'deepsearch' ? 'block' : 'none';
    this.tabPanelDocs.style.display = tab === 'docs' ? 'block' : 'none';
  }

  updateActiveStatCard() {
    this.statCards.forEach(card => {
      card.classList.toggle('active', card.dataset.status === this.currentStatusFilter);
    });
    this.statCardReplays.classList.toggle('active', this.currentReplayFilter);
  }

  getQueryParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  }

  async loadExecutions() {
    try {
      const params = new URLSearchParams({
        database: this.database,
        page: this.page,
        limit: this.limit
      });

      if (this.currentStatusFilter) {
        params.append('status', this.currentStatusFilter);
      }

      if (this.currentSearch) {
        params.append('executionId', this.currentSearch);
      }

      if (this.currentFlowFilter) {
        params.append('flowName', this.currentFlowFilter);
      }

      if (this.currentReplayFilter) {
        params.append('onlyReplays', 'true');
      }

      if (this.groupReplays) {
        params.append('grouped', 'true');
      }

      const response = await fetch(`/api/executions?${params}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to load executions');

      // Kept around so toggleChainExpansion can re-render the current page
      // in place (expand/collapse one row) without a full reload.
      this.currentPageExecutions = data.executions;
      await this.renderExecutionsTable(data.executions);
      this.updatePagination(data.total);
      this.clearError();
    } catch (err) {
      this.currentPageExecutions = [];
      await this.renderExecutionsTable([]);
      this.showError(`Could not load executions: ${err.message}`);
    }
  }

  async loadStatistics() {
    try {
      const response = await fetch(`/api/executions/stats/${this.database}`);
      const stats = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(stats.error || 'Failed to load statistics');

      this.totalCount.textContent = stats.total;
      this.runningCount.textContent = stats.running;
      this.completedCount.textContent = stats.completed;
      this.failedCount.textContent = stats.failed;
      this.replaysCount.textContent = stats.replays;
    } catch (err) {
      // Not surfaced as a banner - loadExecutions() runs alongside this on
      // the same schedule and will already show one for the same
      // underlying cause (e.g. an unconfigured database).
      console.error('Error loading statistics:', err);
    }
  }

  async loadFlows() {
    try {
      const response = await fetch(`/api/executions/flows/${this.database}`);
      const flows = await response.json().catch(() => []);
      if (!response.ok) throw new Error(flows.error || 'Failed to load flows');

      // flowFilter is a free-text <input> with this <datalist> as its
      // type-ahead suggestions - rebuilding the datalist's options never
      // touches the input's own typed value (unlike a <select>), so there's
      // no selection to preserve/restore here.
      this.flowFilterOptions.innerHTML = flows.map(f => `<option value="${f.flowName}"></option>`).join('');
    } catch (err) {
      // Not surfaced as a banner, same reasoning as loadStatistics() above.
      console.error('Error loading flows:', err);
    }
  }

  onDeepSearchSubmit() {
    this.deepSearchTerm = this.deepSearchInput.value.trim();
    this.deepSearchStatusFilter = this.deepSearchStatusFilterEl.value;
    this.deepSearchFlowFilter = this.deepSearchFlowFilterEl.value;
    this.deepSearchMatchPosition = this.deepSearchMatchPositionEl.value;
    this.deepSearchPage = 1;
    this.loadDeepSearchResults();
  }

  async loadDeepSearchResults() {
    if (!this.deepSearchTerm) {
      this.deepSearchResults.innerHTML = '<div class="deep-search-empty">Enter a search term above to search message content across every recorded execution.</div>';
      this.updateDeepSearchPagination(0);
      return;
    }

    try {
      const params = new URLSearchParams({
        database: this.database,
        q: this.deepSearchTerm,
        page: this.deepSearchPage,
        limit: this.limit,
        matchPosition: this.deepSearchMatchPosition
      });
      if (this.deepSearchStatusFilter) params.append('status', this.deepSearchStatusFilter);
      if (this.deepSearchFlowFilter) params.append('flowName', this.deepSearchFlowFilter);

      const response = await fetch(`/api/executions/search?${params}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to search');

      this.renderDeepSearchResults(data.executions || []);
      this.updateDeepSearchPagination(data.total || 0);

      if (data.truncated) {
        this.deepSearchNotice.textContent = 'This search hit its 5000-message scan limit - results shown are from the most recent matches, some older matches may be missing. Try a more specific term.';
        this.deepSearchNotice.style.display = 'block';
      } else {
        this.deepSearchNotice.style.display = 'none';
      }
      this.clearError();
    } catch (err) {
      this.renderDeepSearchResults([]);
      this.showError(`Deep search failed: ${err.message}`);
    }
  }

  renderDeepSearchResults(executions) {
    if (executions.length === 0) {
      this.deepSearchResults.innerHTML = '<div class="deep-search-empty">No executions found containing that text.</div>';
      return;
    }

    this.deepSearchResults.innerHTML = executions.map(exec => {
      const match = exec.match || {};
      const snippet = this.highlightTerm(match.snippet || '', this.deepSearchTerm);

      return `
        <div class="deep-search-result" onclick="dashboard.openDeepSearchResult('${exec.executionId}', '${match.nodeId || ''}', '${match.messageId || ''}')">
          <div class="deep-search-result-header">
            <span class="deep-search-result-flow">${exec.flowName || exec.flowId || '-'}</span>
            <span class="deep-search-result-id">${exec.executionId.substring(0, 20)}...</span>
            <span class="status-badge status-${exec.status.toLowerCase()}">${exec.status}</span>
            <span class="deep-search-result-meta">${exec.matchCount || 1} match${(exec.matchCount || 1) === 1 ? '' : 'es'} &middot; ${this.formatTime(exec.startTime)}</span>
          </div>
          <div class="deep-search-result-snippet">${snippet}</div>
          <div class="deep-search-result-node">${this.deepSearchMatchPosition === 'last' ? 'Last' : 'First'} match, in ${match.nodeName || match.nodeId || 'unknown node'}</div>
        </div>
      `;
    }).join('');
  }

  // Escapes the snippet, then wraps the search term back in <mark> - in
  // that order, so the highlight can never be broken by (or inject) markup
  // from the message content itself.
  highlightTerm(snippet, term) {
    const escaped = this.escapeHtml(snippet);
    if (!term) return escaped;

    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped.replace(new RegExp(escapedTerm, 'ig'), (m) => `<mark>${m}</mark>`);
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Deterministic - the same nodeId always maps to the same color, so a
  // repeated node's color stays consistent across the Replay picker and
  // the message tree without needing to coordinate on one globally-unique
  // assignment.
  colorForNodeId(nodeId) {
    let hash = 0;
    for (let i = 0; i < nodeId.length; i++) {
      hash = (hash * 31 + nodeId.charCodeAt(i)) >>> 0;
    }
    return REPEAT_COLORS[hash % REPEAT_COLORS.length];
  }

  // Groups messages by nodeId, preserving each group's internal (already
  // chronological) order - used to tell "this node ran once" apart from
  // "this node ran N times" (a Split node's parts, or several checkpoint
  // occurrences at the same Mark Replay Point) wherever a flat message
  // list needs to offer "replay/pick just one" vs "replay/consider all of
  // them together".
  groupMessagesByNode(messages) {
    const map = new Map();
    messages.forEach(m => {
      if (!map.has(m.nodeId)) map.set(m.nodeId, []);
      map.get(m.nodeId).push(m);
    });
    return [...map.values()];
  }

  openDeepSearchResult(executionId, nodeId, messageId) {
    this.showDetail(executionId, nodeId || null, messageId || null);
  }

  deepSearchPreviousPage() {
    if (this.deepSearchPage > 1) {
      this.deepSearchPage--;
      this.loadDeepSearchResults();
    }
  }

  deepSearchNextPage() {
    this.deepSearchPage++;
    this.loadDeepSearchResults();
  }

  updateDeepSearchPagination(total) {
    const hasNext = (this.deepSearchPage * this.limit) < total;
    const hasPrev = this.deepSearchPage > 1;

    this.deepSearchPrevBtn.disabled = !hasPrev;
    this.deepSearchNextBtn.disabled = !hasNext;
    this.deepSearchPageInfo.textContent = `Page ${this.deepSearchPage}`;
  }

  // Fetches the execution's full message history (same endpoint the detail
  // pane uses) purely to find its recorded checkpoints client-side - there's
  // no dedicated endpoint for this, since the detail data already has
  // everything needed. Restarting from the flow's true origin is always
  // offered regardless of what this finds - Mark Replay Point checkpoints
  // (and, if enabled, any node at all in debug mode) are additional,
  // optional choices, not a gate on whether replay is possible at all.
  async openReplayModal(executionId) {
    this.renderReplayModal(`<div class="replay-modal-body">Loading execution...</div>`);

    try {
      const response = await fetch(`/api/executions/${executionId}?database=${this.database}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to load execution');

      this.renderReplayChoice(data, data.messages || []);
    } catch (err) {
      this.renderReplayModal(`
        <h3>Replay</h3>
        <div class="replay-error">Could not load execution: ${this.escapeHtml(err.message)}</div>
        <div class="replay-modal-actions">
          <button type="button" class="btn btn-secondary" onclick="dashboard.closeReplayModal()">Close</button>
        </div>
      `);
    }
  }

  renderReplayChoice(execution, allMessages) {
    const flowLabel = execution.flowName || execution.flowId || '-';
    // A Mark Auto Replay Point node is exactly as safe a manual reset
    // location as a Mark Replay Point one - if it's safe enough to retry
    // itself automatically and repeatedly, it's safe enough for a human to
    // manually resume from too. No need for a separate, redundant Mark
    // Replay Point node just to unlock manual replay at the same spot.
    const checkpoints = allMessages.filter(m => m.isReplayPoint || m.isAutoReplayPoint);

    const radioRow = (value, checked, label, sublabel, style, extraAttrs) => `
      <label class="replay-option" ${style ? `style="${style}"` : ''}>
        <input type="radio" name="replayChoice" value="${value}" ${checked ? 'checked' : ''} ${extraAttrs || ''}>
        <span>
          <span class="replay-option-label">${label}</span>
          <span class="replay-option-sublabel">${sublabel}</span>
        </span>
      </label>
    `;

    // Renders one node's occurrences within `messages` as either a single
    // radio row (ran once - the message id travels on the radio itself via
    // data-message-ids) or a colored group of checkboxes, one per part, all
    // checked by default - any 1..N of them can be selected, not just "all
    // or exactly one". `isDefault` marks which single group across the
    // whole modal should start selected - the most recently recorded one,
    // unless the caller says otherwise.
    const renderGroup = (mode, group, isDefault) => {
      const nodeId = group[0].nodeId;
      const label = this.escapeHtml(group[0].nodeName || nodeId);
      const unsafeTag = mode === 'debug' ? ' <span class="replay-unsafe-tag">unsafe</span>' : '';
      // Distinguishes a checkpoint recorded at a Mark Auto Replay Point
      // node from a regular Mark Replay Point one - both are equally valid
      // manual reset locations (see the checkpoints filter above), but it's
      // worth knowing which kind of node is actually there.
      const autoTag = mode === 'checkpoint' && group[0].isAutoReplayPoint ? ' <span class="replay-auto-tag">auto</span>' : '';
      const groupKey = `${mode}:${nodeId}`;
      // Read by confirmReplay to decide whether to ask the "reset the
      // automatic retry count?" follow-up question - applies whenever the
      // resumed-into node genuinely is a Mark Auto Replay Point, regardless
      // of mode (checkpoint or debug).
      const autoAttr = `data-auto="${group[0].isAutoReplayPoint ? 'true' : 'false'}"`;

      if (group.length === 1) {
        const m = group[0];
        return radioRow(
          groupKey,
          isDefault,
          `${label}${unsafeTag}${autoTag}`,
          mode === 'debug'
            ? `${m.direction} @ ${this.formatTime(m.timestamp)}`
            : `Resume at this checkpoint @ ${this.formatTime(m.timestamp)} - skips everything before it.`,
          null,
          `data-message-ids="${m._id}" ${autoAttr}`
        );
      }

      const color = this.colorForNodeId(nodeId);
      const groupStyle = `border-left: 4px solid ${color.border}; background: ${color.bg};`;
      const checkboxRows = group.map((m, i) => `
        <label class="replay-part-checkbox" style="${groupStyle}">
          <input type="checkbox" data-group="${groupKey}" value="${m._id}" checked>
          <span>
            <span class="replay-option-label">Part ${i + 1} of ${group.length}${unsafeTag}</span>
            <span class="replay-option-sublabel">${m.direction} @ ${this.formatTime(m.timestamp)}</span>
          </span>
        </label>
      `).join('');

      return `
        <div class="replay-group" data-group-key="${groupKey}">
          ${radioRow(
            groupKey,
            isDefault,
            `${label} - ${group.length} parts recorded${unsafeTag}${autoTag}`,
            'Pick which parts to replay below - any number from 1 to all of them. Fewer than all may leave a downstream Join waiting forever for the rest.',
            groupStyle,
            autoAttr
          )}
          <div class="replay-parts-picker">
            <div class="replay-parts-header">
              <span>Parts to replay:</span>
              <button type="button" class="replay-parts-link" onclick="dashboard.setReplayParts('${groupKey}', true)">All</button>
              <button type="button" class="replay-parts-link" onclick="dashboard.setReplayParts('${groupKey}', false)">None</button>
            </div>
            ${checkboxRows}
          </div>
        </div>
      `;
    };

    let optionsHtml = radioRow(
      'restart:',
      checkpoints.length === 0,
      'Restart from Origin',
      'Re-runs the whole flow from the very beginning, using its original input. Always available.'
    );

    if (checkpoints.length > 0) {
      const groups = this.groupMessagesByNode(checkpoints);
      optionsHtml += groups.map((group, i) => renderGroup('checkpoint', group, i === groups.length - 1)).join('');
    }

    let debugSectionHtml = '';
    if (this.unsafeReplayEnabled) {
      const debugGroups = this.groupMessagesByNode(allMessages);
      const debugOptionsHtml = debugGroups.map(group => renderGroup('debug', group, false)).join('');

      debugSectionHtml = `
        <details class="replay-debug-details">
          <summary>Debugging: resume from any node (unsafe)</summary>
          <p class="replay-unsafe-warning">
            Bypasses the whole point of Mark Replay Point - picking any node here skips your own
            reasoning about whether it's actually safe to repeat what comes before it. Use only
            for debugging, never as a routine retry.
          </p>
          ${debugOptionsHtml}
        </details>
      `;
    }

    this.renderReplayModal(`
      <h3>Replay execution</h3>
      <p class="replay-modal-subtitle">${this.escapeHtml(flowLabel)} &middot; ${execution.executionId}</p>
      ${checkpoints.length === 0 ? `
        <p>No <code>Mark Replay Point</code> or <code>Mark Auto Replay Point</code> checkpoint
        was recorded for this execution, so it will restart from the flow's true origin. To skip
        re-running steps before some later point instead (e.g. a database write that already
        happened), add one of those node types to the flow and re-run it.</p>
      ` : `
        <p>Choose where to resume from. Restarting always re-runs the whole flow; a checkpoint
        skips everything recorded before it - a <span class="replay-auto-tag">auto</span> tag
        marks one recorded at a Mark Auto Replay Point node, equally valid to resume from
        manually. A colored group ran more than once (e.g. downstream of a Split) - pick any
        number of its parts to replay, all selected by default.</p>
      `}
      <div class="replay-options">
        ${optionsHtml}
        ${debugSectionHtml}
      </div>
      <div id="replayValidationError" class="replay-error" style="display: none;"></div>
      <div class="replay-modal-actions">
        <button type="button" class="btn btn-secondary" onclick="dashboard.closeReplayModal()">Cancel</button>
        <button type="button" class="btn btn-primary" id="replayConfirmBtn" onclick="dashboard.confirmReplay('${execution.executionId}')">Start Replay</button>
      </div>
    `);
  }

  // "All"/"None" convenience links next to a multi-part group's checkbox
  // list - also selects that group's own radio, since fiddling with which
  // parts to replay only makes sense once you've chosen to resume from
  // that group in the first place.
  setReplayParts(groupKey, checked) {
    document.querySelectorAll(`input[type="checkbox"][data-group="${groupKey}"]`).forEach(cb => {
      cb.checked = checked;
    });
    const radio = document.querySelector(`input[name="replayChoice"][value="${groupKey}"]`);
    if (radio) radio.checked = true;
  }

  async confirmReplay(executionId) {
    const selected = document.querySelector('input[name="replayChoice"]:checked');
    if (!selected) return;
    const [mode] = selected.value.split(':');

    let messageIds = null;
    if (mode !== 'restart') {
      const checkboxes = document.querySelectorAll(`input[type="checkbox"][data-group="${selected.value}"]`);
      if (checkboxes.length > 0) {
        messageIds = [...checkboxes].filter(cb => cb.checked).map(cb => cb.value);
        if (messageIds.length === 0) {
          const errEl = document.getElementById('replayValidationError');
          if (errEl) {
            errEl.textContent = 'Select at least one part to replay.';
            errEl.style.display = 'block';
          }
          return;
        }
      } else {
        messageIds = (selected.dataset.messageIds || '').split(',').filter(Boolean);
      }
    }

    // Resuming into an actual Mark Auto Replay Point node raises a question
    // a regular checkpoint never has to: should this manual resume get a
    // fresh automatic-retry budget, or continue the count the checkpoint
    // already had when it was exhausted? Ask, rather than silently always
    // resetting it - see renderAutoResetChoice.
    if (selected.dataset.auto === 'true') {
      this.renderAutoResetChoice(executionId, mode, messageIds);
      return;
    }

    await this.dispatchReplay(executionId, mode, messageIds, true);
  }

  // The second popup triggered above - only for a checkpoint recorded at a
  // Mark Auto Replay Point node. "Reset" (the pre-existing, and still
  // default, behavior for every OTHER kind of replay) gives it a full fresh
  // budget of Max attempts again. "Keep" continues the existing count
  // instead - if this resumed execution fails again right away, it can go
  // straight back to exhausted with no further automatic retries, useful
  // when a person is just manually continuing the same incident (e.g. "I
  // brought the flaky service back up, try this exact spot again") rather
  // than treating it as a brand-new failure chain.
  renderAutoResetChoice(executionId, mode, messageIds) {
    // Stashed on the instance rather than embedded into the button's
    // onclick attribute - messageIds is an array, and serializing it into
    // an HTML attribute string is exactly the kind of quoting hazard this
    // dashboard otherwise avoids by only ever putting single ids/strings
    // there.
    this.pendingReplay = { executionId, mode, messageIds };

    this.renderReplayModal(`
      <h3>Reset automatic retry count?</h3>
      <p class="replay-modal-subtitle">This checkpoint belongs to a <strong>Mark Auto Replay
      Point</strong> node - resuming it manually raises one more question than a regular
      checkpoint does.</p>
      <div class="replay-options">
        <label class="replay-option">
          <input type="radio" name="autoResetChoice" value="reset" checked>
          <span>
            <span class="replay-option-label">Reset to 0 (recommended)</span>
            <span class="replay-option-sublabel">Gives it a full fresh budget of "Max attempts" again - if it fails, it retries
            automatically as if this were a brand-new failure chain.</span>
          </span>
        </label>
        <label class="replay-option">
          <input type="radio" name="autoResetChoice" value="keep">
          <span>
            <span class="replay-option-label">Keep the current count</span>
            <span class="replay-option-sublabel">Continues the existing attempt count instead - if it fails again right away, it
            may go straight back to "retries exhausted" with no further automatic retries. Useful
            when you're manually continuing the same incident rather than starting fresh.</span>
          </span>
        </label>
      </div>
      <div class="replay-modal-actions">
        <button type="button" class="btn btn-secondary" onclick="dashboard.closeReplayModal()">Cancel</button>
        <button type="button" class="btn btn-primary" id="replayConfirmBtn" onclick="dashboard.confirmAutoResetChoice()">Continue</button>
      </div>
    `);
  }

  confirmAutoResetChoice() {
    const { executionId, mode, messageIds } = this.pendingReplay;
    const choice = document.querySelector('input[name="autoResetChoice"]:checked');
    const resetCount = !choice || choice.value === 'reset';
    this.dispatchReplay(executionId, mode, messageIds, resetCount);
  }

  async dispatchReplay(executionId, mode, messageIds, resetCount) {
    const errEl = document.getElementById('replayValidationError');
    if (errEl) errEl.style.display = 'none';

    const confirmBtn = document.getElementById('replayConfirmBtn');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Replaying...';
    }

    try {
      const params = new URLSearchParams({ database: this.database, mode });
      if (messageIds && messageIds.length > 0) params.append('messageIds', messageIds.join(','));
      // Omitted entirely (rather than sent as 'true') when resetting - only
      // the 'false' case needs to say anything, keeping every OTHER caller
      // of this endpoint (and its pre-existing default behavior) unchanged.
      if (!resetCount) params.append('resetAutoReplayCount', 'false');
      const response = await fetch(`/api/executions/${executionId}/replay?${params}`, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || 'Replay failed');

      const from = data.replayedFrom || {};
      const nodeLabel = this.escapeHtml(from.nodeName || from.nodeId || 'the chosen node');
      const fromLabel = from.mode === 'restart'
        ? 'the flow\'s origin'
        : (from.partCount > 1 ? `${nodeLabel} (${from.partCount} parts)` : nodeLabel);

      this.renderReplayModal(`
        <h3>Replay started</h3>
        <div class="replay-success">
          A new execution is now running, resumed from <strong>${fromLabel}</strong>.
        </div>
        <div class="replay-field">
          <label>New execution ID</label>
          <div class="detail-value" style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <span>${data.executionId}</span>
            <button type="button" class="btn btn-secondary btn-sm" onclick="dashboard.copyExecutionId('${data.executionId}', this)">Copy</button>
          </div>
        </div>
        <div class="replay-modal-actions">
          <button type="button" class="btn btn-secondary" onclick="dashboard.closeReplayModal()">Close</button>
          <button type="button" class="btn btn-primary" onclick="dashboard.closeReplayModal(); dashboard.showDetail('${data.executionId}')">View New Execution</button>
        </div>
      `);

      this.loadExecutions();
      this.loadStatistics();
    } catch (err) {
      this.renderReplayModal(`
        <h3>Replay failed</h3>
        <div class="replay-error">${this.escapeHtml(err.message)}</div>
        <div class="replay-modal-actions">
          <button type="button" class="btn btn-secondary" onclick="dashboard.closeReplayModal()">Close</button>
        </div>
      `);
    }
  }

  renderReplayModal(html) {
    this.replayModal.innerHTML = html;
    this.replayModalBackdrop.style.display = 'flex';
  }

  closeReplayModal() {
    this.replayModalBackdrop.style.display = 'none';
    this.replayModal.innerHTML = '';
  }

  // A beginAutoExhausted execution has `replayOf` set (same as any real
  // replay, for the "Replayed From"/"Replayed As" links) but is NOT itself
  // another retry attempt - it's the automatic retry mechanism giving up.
  // Tagging it with the same generic "replay" badge as an actual retry
  // reads as "yet another attempt happened", which is exactly backwards -
  // it's the point where nothing more will happen automatically. Grouped
  // summary rows report the chain's LAST member's replayMode under this
  // same field name (see listExecutionsGrouped), so this works identically
  // for both a summary row and a raw individual execution.
  replayTagHtml(exec) {
    if (exec.replayMode === 'auto-exhausted') {
      return '<span class="status-badge status-failed">automatic replay failed</span>';
    }
    return exec.replayOf ? '<span class="status-badge status-replayed">replay</span>' : '';
  }

  // Rows for an execution produced by a replay (restart/checkpoint/debug -
  // see execution-manager.js's beginRestart/beginResume) get a subtle tint
  // plus an explicit "replay" badge - color alone isn't reliable signal on
  // its own, especially for anyone who can't distinguish it. A grouped
  // summary row (see renderExecutionsTable/groupReplays) never has
  // `replayOf` set on it - it represents the whole chain under its root's
  // own id, not a replay of something else - so this only ever applies to
  // an ungrouped row or an expanded chain member, with no extra branching
  // needed here.
  //
  // opts.expandControl renders the expand/collapse caret in the id cell -
  // only ever passed for a grouped summary row with more than one member
  // (see renderExecutionsTable). Every other row (an already-singular
  // execution, or a non-oldest member inside an expanded chain) gets a
  // plain leaf dot instead of the arrow, purely so the id column stays
  // visually aligned regardless of which rows can expand. opts.chainMember
  // styles this as a member row nested under an expanded chain's summary
  // rather than a normal top-level row.
  renderExecutionRowHtml(exec, opts = {}) {
    const targetId = exec.lastExecutionId || exec.executionId;
    const rowClasses = [exec.replayOf ? 'row-replay' : '', opts.chainMember ? 'row-chain-member' : ''].filter(Boolean).join(' ');

    const rowMarker = opts.expandControl
      ? `<button
          type="button"
          class="btn-expand-chain"
          title="${opts.expandControl === 'expanded' ? 'Collapse back to one summary row' : 'Inspect each execution in this chain individually'}"
          aria-label="${opts.expandControl === 'expanded' ? 'Collapse chain' : 'Expand chain'}"
          onclick="event.stopPropagation(); dashboard.toggleChainExpansion('${exec.executionId}')"
        >${opts.expandControl === 'expanded' ? '&#9662;' : '&#9656;'}</button>`
      : '<span class="row-leaf-dot" aria-hidden="true">&#8226;</span>';

    return `
      <tr onclick="dashboard.showDetail('${targetId}')" class="${rowClasses}">
        <td class="col-id">
          <div class="id-cell">
            ${rowMarker}
            <code>${exec.executionId.substring(0, 20)}...</code>
            <button
              type="button"
              class="btn-copy-icon"
              title="Copy execution ID"
              aria-label="Copy execution ID"
              onclick="event.stopPropagation(); dashboard.copyExecutionId('${exec.executionId}', this)"
            >&#10697;</button>
          </div>
        </td>
        <td class="col-flow">${exec.flowName || exec.flowId || '-'}</td>
        <td class="col-tags">
          <div class="tag-cell">
            ${this.replayTagHtml(exec)}
            ${exec.retriesExhausted ? '<span class="status-badge status-failed">retries exhausted</span>' : ''}
          </div>
        </td>
        <td class="col-status">
          <span class="status-badge status-${exec.status.toLowerCase()}">
            ${exec.status}
          </span>
        </td>
        <td class="col-duration">${this.formatDuration(exec.duration)}</td>
        <td class="col-time">${this.formatTime(exec.startTime)}</td>
        <td class="col-actions">
          <button class="btn-icon btn-icon-view" title="View execution" aria-label="View execution" onclick="event.stopPropagation(); dashboard.showDetail('${targetId}')">&#128065;</button>
          <button class="btn-icon btn-icon-replay" title="Replay execution" aria-label="Replay execution" onclick="event.stopPropagation(); dashboard.openReplayModal('${targetId}')">&#8635;</button>
        </td>
      </tr>
    `;
  }

  // A grouped row with more than one member gets an expand caret (see
  // renderExecutionRowHtml) - clicking it swaps that ONE row for its actual
  // member executions, oldest at top to newest at bottom, fetched via
  // toggleChainExpansion. This is deliberately per-row, not the global
  // "Group replay chains" toggle - flipping that ungroups the entire list,
  // which is more disruptive than just wanting to inspect one chain.
  async renderExecutionsTable(executions) {
    if (executions.length === 0) {
      this.executionsTableBody.innerHTML = '<tr class="loading"><td colspan="7">No executions found</td></tr>';
      return;
    }

    const rowsHtml = [];
    for (const exec of executions) {
      const isExpandable = exec.executionCount > 1;
      const isExpanded = isExpandable && this.expandedChains.has(exec.executionId);

      if (!isExpanded) {
        rowsHtml.push(this.renderExecutionRowHtml(exec, { expandControl: isExpandable ? 'collapsed' : null }));
        continue;
      }

      const members = await this.loadChainMembers(exec.executionId);
      if (members.length === 0) {
        // Fetch failed or returned nothing (e.g. the chain vanished under a
        // concurrent Delete) - fall back to the summary row rather than
        // silently rendering an empty gap.
        rowsHtml.push(this.renderExecutionRowHtml(exec, { expandControl: 'collapsed' }));
        continue;
      }

      members.forEach((member, index) => {
        rowsHtml.push(this.renderExecutionRowHtml(member, {
          chainMember: true,
          expandControl: index === 0 ? 'expanded' : null
        }));
      });
    }

    this.executionsTableBody.innerHTML = rowsHtml.join('');
  }

  async loadChainMembers(rootExecutionId) {
    try {
      const response = await fetch(`/api/executions/chain/${rootExecutionId}?database=${this.database}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to load chain');
      return data.executions || [];
    } catch (err) {
      this.showError(`Could not load chain: ${err.message}`);
      return [];
    }
  }

  // The expand control always lives on the topmost row of a chain's block -
  // the grouped summary row while collapsed, the oldest member once
  // expanded - so it's a stable click target for toggling back and forth.
  async toggleChainExpansion(rootExecutionId) {
    if (this.expandedChains.has(rootExecutionId)) {
      this.expandedChains.delete(rootExecutionId);
    } else {
      this.expandedChains.add(rootExecutionId);
    }
    await this.renderExecutionsTable(this.currentPageExecutions);
  }

  // highlightNodeId/highlightMessageId are set by a Deep Search result -
  // they make the detail view auto-expand down to, scroll to, and briefly
  // flash the specific message that matched the search, instead of leaving
  // the user to find it manually inside a possibly large/collapsed tree.
  async showDetail(executionId, highlightNodeId = null, highlightMessageId = null) {
    try {
      const response = await fetch(`/api/executions/${executionId}?database=${this.database}`);
      if (!response.ok) throw new Error('Failed to load execution details');

      const execution = await response.json();
      this.currentExecution = execution;
      this.pendingHighlightNodeId = highlightNodeId;
      this.pendingHighlightMessageId = highlightMessageId;
      this.renderDetail(execution);
      this.detailPane.classList.add('show');
      this.detailPane.style.display = 'flex';
    } catch (err) {
      this.showError(`Error loading execution: ${err.message}`);
    }
  }

  // Renders into two independently-scrollable columns: metadata + error on
  // the left, the message tree on the right - kept as separate accumulators
  // (metaHtml/messagesHtml) rather than one flat string, so each can be
  // dropped into its own scrollable <div> below instead of sharing one long
  // scroll region.
  renderDetail(execution) {
    this.detailTitle.textContent = `Execution ${execution.executionId.substring(0, 16)}...`;

    const highlightNodeId = this.pendingHighlightNodeId;
    const highlightMessageId = this.pendingHighlightMessageId;
    this.pendingHighlightNodeId = null;
    this.pendingHighlightMessageId = null;
    this.highlightMessageId = highlightMessageId;

    let metaHtml = `
      <div class="detail-section">
        <h3>Metadata</h3>
        <div class="detail-field">
          <div class="detail-label">Execution ID</div>
          <div class="detail-value" style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <span>${execution.executionId}</span>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              style="flex-shrink: 0;"
              onclick="dashboard.copyExecutionId('${execution.executionId}', this)"
            >Copy</button>
          </div>
        </div>
        <div class="detail-field">
          <div class="detail-label">Flow</div>
          <div class="detail-value">${execution.flowName || '-'}</div>
        </div>
        <div class="detail-field">
          <div class="detail-label">Flow ID</div>
          <div class="detail-value">${execution.flowId || '-'}</div>
        </div>
        <div class="detail-field">
          <div class="detail-label">Status</div>
          <div class="detail-value">
            <span class="status-badge status-${execution.status.toLowerCase()}">
              ${execution.status}
            </span>
          </div>
        </div>
        <div class="detail-field">
          <div class="detail-label">Start Time</div>
          <div class="detail-value">${new Date(execution.startTime).toLocaleString()}</div>
        </div>
        <div class="detail-field">
          <div class="detail-label">Duration</div>
          <div class="detail-value">${this.formatDuration(execution.duration)}</div>
        </div>
      </div>
    `;

    if (execution.replayOf || (execution.replays && execution.replays.length > 0)) {
      metaHtml += `<div class="detail-section"><h3>Replay</h3>`;

      if (execution.replayOf) {
        const modeLabel = {
          restart: 'restarted from origin',
          checkpoint: 'resumed from checkpoint',
          debug: 'unsafe debug resume',
          auto: 'auto-retried',
          'auto-exhausted': 'retries exhausted'
        }[execution.replayMode] || 'replayed';
        metaHtml += `
          <div class="detail-field">
            <div class="detail-label">Replayed From (${modeLabel})</div>
            <div class="detail-value" style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
              <span>${execution.replayOf}</span>
              <button type="button" class="btn-icon btn-icon-view" style="flex-shrink: 0;" title="View execution" aria-label="View execution" onclick="dashboard.showDetail('${execution.replayOf}')">&#128065;</button>
            </div>
          </div>
        `;
      }

      if (execution.retriesExhausted) {
        metaHtml += `
          <div class="detail-field">
            <div class="detail-label">Automatic Retries</div>
            <div class="detail-value"><span class="status-badge status-failed">exhausted</span></div>
          </div>
        `;
      }

      (execution.replays || []).forEach(r => {
        metaHtml += `
          <div class="detail-field">
            <div class="detail-label">Replayed As (${this.formatTime(r.timestamp)}${r.exhausted ? ', automatic replay failed' : (r.autoTriggered ? ', auto-retried' : '')})</div>
            <div class="detail-value" style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
              <span>${r.executionId}</span>
              <button type="button" class="btn-icon btn-icon-view" style="flex-shrink: 0;" title="View execution" aria-label="View execution" onclick="dashboard.showDetail('${r.executionId}')">&#128065;</button>
            </div>
          </div>
        `;
      });

      metaHtml += `</div>`;
    }

    if (execution.error) {
      metaHtml += `
        <div class="detail-section">
          <h3>Error</h3>
          <div class="detail-field">
            <div class="detail-label">Node ID</div>
            <div class="detail-value">${execution.error.nodeId || execution.failureNodeId || 'Unknown'}</div>
          </div>
          <div class="detail-field">
            <div class="detail-label">Message</div>
            <div class="detail-value">${execution.error.message || 'Unknown error'}</div>
          </div>
          <div class="detail-field">
            <div class="detail-label">Stack Trace</div>
            <div class="detail-value" style="white-space: pre-wrap; font-size: 11px;">
              ${execution.error.stack ? execution.error.stack.substring(0, 500) : 'N/A'}
            </div>
          </div>
        </div>
      `;
    }

    const payloadPlaceholders = [];
    this.carouselMessages = new Map();
    this.carouselIndex = new Map();

    let messagesHtml = '';

    if (execution.messages && execution.messages.length > 0) {
      const tree = this.buildMessageTree(execution.messages, execution.edges || []);

      if (tree) {
        const { expandedKeys, foundResult } = this.computeExpandedPortKeys(tree, highlightNodeId);
        const treeHtml = this.renderMessageNode(tree, payloadPlaceholders, expandedKeys, foundResult);

        messagesHtml = `
          <div class="detail-section">
            <h3>Messages (${execution.messages.length})</h3>
            <div class="messages-list">
              ${treeHtml}
            </div>
          </div>
        `;
      } else {
        // No 'input' entry found (shouldn't normally happen) - fall back to
        // a flat list (grouped by node, so split/multi-message nodes still
        // get the carousel treatment) rather than showing nothing.
        const byNodeId = new Map();
        execution.messages.forEach(m => {
          if (!byNodeId.has(m.nodeId)) byNodeId.set(m.nodeId, []);
          byNodeId.get(m.nodeId).push(m);
        });

        messagesHtml = `
          <div class="detail-section">
            <h3>Messages (${execution.messages.length})</h3>
            <div class="messages-list">
              ${[...byNodeId.entries()].map(([nodeId, msgs]) => this.renderMessageBox(nodeId, msgs, payloadPlaceholders)).join('')}
            </div>
          </div>
        `;
      }
    }

    this.detailBody.innerHTML = `
      <div class="detail-columns">
        <div class="detail-col detail-col-meta">${metaHtml}</div>
        <div class="detail-col detail-col-messages">${messagesHtml}</div>
      </div>
    `;

    // renderjson() returns a real DOM node (a collapsible, expandable JSON
    // tree), which can't be embedded via the innerHTML string above -
    // attach each one into its placeholder now that the markup exists.
    if (typeof renderjson !== 'undefined') {
      payloadPlaceholders.forEach((payload, i) => {
        const container = this.detailBody.querySelector(`[data-payload-index="${i}"]`);
        if (container) {
          container.appendChild(renderjson(payload));
        }
      });
    }

    if (highlightNodeId) {
      const boxEl = document.getElementById(`msg-box-${highlightNodeId}`);
      if (boxEl) {
        boxEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        boxEl.classList.add('highlight-flash');
        setTimeout(() => boxEl.classList.remove('highlight-flash'), 2500);
      }
    }
  }

  // Reconstructs the actual branch structure a message took through the
  // flow from the flat messages + edges arrays the API returns. Returns
  // { nodeId, messages: [...], ports: [{ port, children: [<same shape>, ...] }] }
  // rooted at the execution's one 'input' message, or null if that entry is
  // missing.
  buildMessageTree(messages, edges) {
    // Grouped by nodeId, not one-per-node: a Split node - and everything
    // downstream of it until the matching Join - runs once per split part,
    // producing multiple recorded messages for the same node.
    const messagesByNodeId = new Map();
    messages.forEach(m => {
      if (!messagesByNodeId.has(m.nodeId)) messagesByNodeId.set(m.nodeId, []);
      messagesByNodeId.get(m.nodeId).push(m);
    });

    // A Split node's send() fires once per part, recording the same
    // structural edge repeatedly - dedupe to one, since the tree only needs
    // to know THAT the wire exists, not how many times it fired (the
    // message count on each box already conveys that).
    const seenEdgeKeys = new Set();
    const edgesBySource = new Map();
    edges.forEach(e => {
      const key = `${e.sourceNodeId}:${e.sourcePort}:${e.destinationNodeId}`;
      if (seenEdgeKeys.has(key)) return;
      seenEdgeKeys.add(key);

      if (!edgesBySource.has(e.sourceNodeId)) edgesBySource.set(e.sourceNodeId, []);
      edgesBySource.get(e.sourceNodeId).push(e);
    });

    const rootMessage = messages.find(m => m.direction === 'input');
    if (!rootMessage) return null;

    const visiting = new Set(); // guards against a flow looping back on itself

    // Every node reachable downstream of nodeId, itself included - used only
    // to tell whether two destinations sharing one output port are genuinely
    // independent branches or a "diamond" that reconverges somewhere further
    // down (see the `disjoint` check below). Memoized per build() call since
    // sibling destinations' reachable sets get recomputed for every
    // multi-destination port; a flow's message/edge count is small enough
    // (dozens, not millions) that this is not worth over-engineering further.
    const reachableFrom = (nodeId, seen = new Set()) => {
      if (seen.has(nodeId)) return seen;
      seen.add(nodeId);
      (edgesBySource.get(nodeId) || []).forEach(e => reachableFrom(e.destinationNodeId, seen));
      return seen;
    };

    const build = (nodeId) => {
      const nodeMessages = messagesByNodeId.get(nodeId);
      if (!nodeMessages || visiting.has(nodeId)) return null;
      visiting.add(nodeId);

      const outEdges = (edgesBySource.get(nodeId) || [])
        .slice()
        .sort((a, b) => a.sourcePort - b.sourcePort);

      const destinationsByPort = new Map();
      outEdges.forEach(e => {
        if (!destinationsByPort.has(e.sourcePort)) destinationsByPort.set(e.sourcePort, []);
        destinationsByPort.get(e.sourcePort).push(e.destinationNodeId);
      });

      const ports = [...destinationsByPort.entries()]
        .map(([port, destIds]) => {
          // One output wired to several destinations is only a genuine
          // fork - each destination its own independent branch - if none of
          // them ever leads back into another's downstream. If any node is
          // reachable from more than one destination, they reconverge (e.g.
          // two branches both feeding into a later shared node), so it's
          // rendered flat instead, exactly as before this distinction
          // existed - splitting it into separate branches would misrepresent
          // a shared continuation as two unrelated stories.
          let disjoint = true;
          if (destIds.length > 1) {
            const seenAcrossSiblings = new Set();
            for (const id of destIds) {
              const reach = reachableFrom(id);
              if ([...reach].some(n => seenAcrossSiblings.has(n))) {
                disjoint = false;
                break;
              }
              reach.forEach(n => seenAcrossSiblings.add(n));
            }
          }

          return {
            port,
            children: destIds.map(id => build(id)).filter(Boolean),
            disjoint
          };
        })
        .filter(p => p.children.length > 0);

      visiting.delete(nodeId);
      return { nodeId, messages: nodeMessages, ports };
    };

    return build(rootMessage.nodeId);
  }

  // Finds the path down to the first isResult message (depth-first) and
  // returns the set of "nodeId:port" keys along that path, so those - and
  // only those - branches start expanded. If no isResult message exists
  // anywhere (most non-HTTP flows), foundResult is false and every branch
  // should default to expanded instead, so nothing is hidden by default
  // when there's no principled way to pick one branch over another.
  // targetNodeId, when given (a Deep Search deep-link), additionally forces
  // open every branch leading down to that specific node - unioned with the
  // normal isResult path, so both stay expanded even when they diverge into
  // different branches.
  computeExpandedPortKeys(root, targetNodeId = null) {
    const resultKeys = this.findPathKeys(root, n => n.messages.some(m => m.isResult));
    const targetKeys = targetNodeId ? this.findPathKeys(root, n => n.nodeId === targetNodeId) : null;

    const expandedKeys = new Set([...(resultKeys || []), ...(targetKeys || [])]);
    const foundResult = !!resultKeys || !!targetKeys;
    return { expandedKeys, foundResult };
  }

  // Depth-first search for the first node matching `predicate`, returning
  // the set of "nodeId:port" (and, for independent sibling branches,
  // "nodeId:port:childNodeId") keys along the path to it, or null if
  // `predicate` matches nothing in this subtree.
  findPathKeys(node, predicate) {
    if (!node) return null;
    if (predicate(node)) return new Set();

    for (const portGroup of node.ports) {
      for (const child of portGroup.children) {
        const found = this.findPathKeys(child, predicate);
        if (found) {
          found.add(`${node.nodeId}:${portGroup.port}`);
          // Independent per-destination branches (see the `disjoint`
          // check in buildMessageTree) get their own nested toggle keyed
          // by child node id too - without this, finding the match deep
          // in ONE sibling branch would expand ALL of that port's sibling
          // branches instead of just the one that actually leads there.
          if (portGroup.disjoint && portGroup.children.length > 1) {
            found.add(`${node.nodeId}:${portGroup.port}:${child.nodeId}`);
          }
          return found;
        }
      }
    }
    return null;
  }

  countSubtreeMessages(portGroup) {
    let count = 0;
    const visit = (node) => {
      if (!node) return;
      count += node.messages.length;
      node.ports.forEach(p => p.children.forEach(visit));
    };
    portGroup.children.forEach(visit);
    return count;
  }

  // A "box" represents one node - one message normally, or several if the
  // node ran multiple times (a Split node, or anything downstream of one
  // until the matching Join). Multi-message boxes get a carousel instead of
  // only ever showing one of them.
  renderMessageBox(nodeId, messages, payloadPlaceholders) {
    this.carouselMessages.set(nodeId, messages);
    if (!this.carouselIndex.has(nodeId)) {
      // A Deep Search deep-link into a Split/Join carousel should open
      // already showing the specific part that matched, not always part 1.
      const highlightIndex = this.highlightMessageId
        ? messages.findIndex(m => m._id === this.highlightMessageId)
        : -1;
      this.carouselIndex.set(nodeId, highlightIndex !== -1 ? highlightIndex : 0);
    }

    // Colored left border ties a repeated node's boxes together visually
    // wherever they're shown - same color-hash the Replay picker's grouped
    // checkpoints use, so a node's identity is recognizable across both.
    const style = messages.length > 1 ? `border-left: 4px solid ${this.colorForNodeId(nodeId).border};` : '';
    return `<div class="message-item" id="msg-box-${nodeId}" style="${style}">${this.renderMessageBoxInner(nodeId, payloadPlaceholders)}</div>`;
  }

  renderMessageBoxInner(nodeId, payloadPlaceholders) {
    const messages = this.carouselMessages.get(nodeId);
    const index = this.carouselIndex.get(nodeId) || 0;
    const msg = messages[index];
    const isSplit = messages.length > 1;

    const payloadIndex = payloadPlaceholders.length;
    payloadPlaceholders.push(msg.payload);

    return `
      <h4 style="margin: 0 0 4px; font-size: 13px;">
        ${msg.nodeName || msg.nodeId}
        ${msg.isFirst ? '<span class="status-badge status-completed" style="margin-left: 6px;">FIRST</span>' : ''}
        ${msg.isReplayed ? '<span class="status-badge status-replayed" style="margin-left: 6px;">replayed from here</span>' : ''}
        ${msg.isRestarted ? '<span class="status-badge status-replayed" style="margin-left: 6px;">restarted from here</span>' : ''}
        ${msg.isAutoReplayed ? '<span class="status-badge status-replayed" style="margin-left: 6px;">auto-retried from here</span>' : ''}
        ${msg.isDebugResume ? '<span class="status-badge status-debug" style="margin-left: 6px;">unsafe debug resume</span>' : ''}
        ${msg.isResult ? '<span class="status-badge status-completed" style="margin-left: 6px;">result</span>' : ''}
        ${msg.isError ? '<span class="status-badge status-failed" style="margin-left: 6px;">error</span>' : ''}
        ${isSplit ? '<span class="status-badge status-split" style="margin-left: 6px;">split</span>' : ''}
      </h4>
      <div class="message-direction direction-${msg.direction.toLowerCase()}">
        ${msg.direction}
      </div>
      ${isSplit ? `
        <div class="carousel-nav">
          <button type="button" class="carousel-btn" onclick="dashboard.cycleCarousel('${nodeId}', -1)" ${index === 0 ? 'disabled' : ''} aria-label="Previous message">&larr;</button>
          <span class="carousel-counter">${index + 1} / ${messages.length}</span>
          <button type="button" class="carousel-btn" onclick="dashboard.cycleCarousel('${nodeId}', 1)" ${index === messages.length - 1 ? 'disabled' : ''} aria-label="Next message">&rarr;</button>
        </div>
      ` : ''}
      <div style="margin-bottom: 4px; font-size: 11px; color: #999;">
        ${msg.nodeId} @ ${this.formatTime(msg.timestamp)}
      </div>
      <div class="payload-tree" data-payload-index="${payloadIndex}"></div>
    `;
  }

  cycleCarousel(nodeId, delta) {
    const messages = this.carouselMessages.get(nodeId);
    if (!messages) return;

    const current = this.carouselIndex.get(nodeId) || 0;
    const next = Math.max(0, Math.min(messages.length - 1, current + delta));
    if (next === current) return;
    this.carouselIndex.set(nodeId, next);

    const boxEl = document.getElementById(`msg-box-${nodeId}`);
    if (!boxEl) return;

    const localPlaceholders = [];
    boxEl.innerHTML = this.renderMessageBoxInner(nodeId, localPlaceholders);

    if (typeof renderjson !== 'undefined' && localPlaceholders.length > 0) {
      const container = boxEl.querySelector('.payload-tree');
      if (container) container.appendChild(renderjson(localPlaceholders[0]));
    }
  }

  renderMessageNode(node, payloadPlaceholders, expandedKeys, foundResult) {
    let html = this.renderMessageBox(node.nodeId, node.messages, payloadPlaceholders);

    if (node.ports.length === 1 && node.ports[0].children.length === 1) {
      // A single linear continuation - no branch chrome, just keep going.
      html += this.renderMessageNode(node.ports[0].children[0], payloadPlaceholders, expandedKeys, foundResult);
    } else if (node.ports.length > 0) {
      node.ports.forEach(portGroup => {
        const key = `${node.nodeId}:${portGroup.port}`;
        const isExpanded = foundResult ? expandedKeys.has(key) : true;
        const branchId = `branch-${node.nodeId}-${portGroup.port}`;
        const total = this.countSubtreeMessages(portGroup);
        const nextNodeNames = portGroup.children
          .map(c => c.messages[0].nodeName || c.nodeId)
          .join(', ');

        html += `
          <div class="branch" data-branch-id="${branchId}">
            <button type="button" class="branch-toggle-btn" onclick="dashboard.toggleBranch('${branchId}')">
              <span class="branch-icon">${isExpanded ? '▼' : '▶'}</span>
              Output ${portGroup.port + 1} (${total} message${total === 1 ? '' : 's'}) - ${nextNodeNames}
            </button>
            <div class="branch-content" id="${branchId}" style="display: ${isExpanded ? 'block' : 'none'};">
              ${this.renderPortDestinations(node, portGroup, payloadPlaceholders, expandedKeys, foundResult)}
            </div>
          </div>
        `;
      });
    }

    return html;
  }

  // Renders the destination(s) of one output port. A single destination (or
  // several that reconverge somewhere downstream - see the `disjoint` check
  // in buildMessageTree) is rendered flat, one after another, exactly as
  // before this method existed. Several genuinely INDEPENDENT destinations
  // (one output wired to multiple nodes that never share a later node) each
  // get their own nested collapsible branch instead - otherwise their whole,
  // unrelated subtrees would be dumped into this one port's box back-to-back
  // with nothing telling the reader where one ends and the next begins.
  renderPortDestinations(node, portGroup, payloadPlaceholders, expandedKeys, foundResult) {
    if (portGroup.children.length <= 1 || !portGroup.disjoint) {
      return portGroup.children
        .map(child => this.renderMessageNode(child, payloadPlaceholders, expandedKeys, foundResult))
        .join('');
    }

    return portGroup.children.map(child => {
      const key = `${node.nodeId}:${portGroup.port}:${child.nodeId}`;
      const isExpanded = foundResult ? expandedKeys.has(key) : true;
      const branchId = `branch-${node.nodeId}-${portGroup.port}-${child.nodeId}`;
      const total = this.countSubtreeMessages({ children: [child] });
      const label = child.messages[0].nodeName || child.nodeId;

      return `
        <div class="branch sub-branch" data-branch-id="${branchId}">
          <button type="button" class="branch-toggle-btn" onclick="dashboard.toggleBranch('${branchId}')">
            <span class="branch-icon">${isExpanded ? '▼' : '▶'}</span>
            ${label} (${total} message${total === 1 ? '' : 's'})
          </button>
          <div class="branch-content" id="${branchId}" style="display: ${isExpanded ? 'block' : 'none'};">
            ${this.renderMessageNode(child, payloadPlaceholders, expandedKeys, foundResult)}
          </div>
        </div>
      `;
    }).join('');
  }

  toggleBranch(branchId) {
    const content = document.getElementById(branchId);
    if (!content) return;

    const isVisible = content.style.display !== 'none';
    content.style.display = isVisible ? 'none' : 'block';

    const icon = this.detailBody.querySelector(`[data-branch-id="${branchId}"] .branch-icon`);
    if (icon) icon.textContent = isVisible ? '▶' : '▼';
  }

  closeDetail() {
    this.detailPane.classList.remove('show');
    this.detailPane.style.display = 'none';
    this.currentExecution = null;
  }

  async copyExecutionId(executionId, buttonEl) {
    try {
      await navigator.clipboard.writeText(executionId);
      const originalText = buttonEl.textContent;
      buttonEl.textContent = 'Copied!';
      setTimeout(() => { buttonEl.textContent = originalText; }, 1500);
    } catch (err) {
      this.showError(`Could not copy to clipboard: ${err.message}`);
    }
  }

  onSearchChange() {
    this.currentSearch = this.searchInput.value.trim();
    this.page = 1;
    this.loadExecutions();
  }

  onFilterChange() {
    this.currentStatusFilter = this.statusFilter.value;
    this.page = 1;
    this.updateActiveStatCard();
    this.loadExecutions();
  }

  onFlowFilterChange() {
    this.currentFlowFilter = this.flowFilter.value;
    this.page = 1;
    this.loadExecutions();
  }

  previousPage() {
    if (this.page > 1) {
      this.page--;
      this.loadExecutions();
    }
  }

  nextPage() {
    this.page++;
    this.loadExecutions();
  }

  updatePagination(total) {
    const hasNext = (this.page * this.limit) < total;
    const hasPrev = this.page > 1;

    this.prevBtn.disabled = !hasPrev;
    this.nextBtn.disabled = !hasNext;
    this.pageInfo.textContent = `Page ${this.page}`;
  }

  async clearExecutions() {
    const scope = this.clearScope.value;
    const labels = {
      '30d': 'older than 30 days',
      '7d': 'older than 7 days',
      'today': 'older than today',
      'all': 'ALL executions'
    };

    if (!confirm(`Delete ${labels[scope] || scope}? This cannot be undone.`)) {
      return;
    }

    try {
      const params = new URLSearchParams({ database: this.database, scope });
      const response = await fetch(`/api/executions?${params}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to delete executions');

      this.clearError();
      this.page = 1;
      this.loadExecutions();
      this.loadStatistics();
    } catch (err) {
      this.showError(`Could not delete executions: ${err.message}`);
    }
  }

  formatDuration(ms) {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  formatTime(date) {
    if (!date) return '-';
    const d = new Date(date);
    return d.toLocaleTimeString();
  }

  showError(message) {
    this.errorBanner.innerHTML = '';

    const text = document.createElement('span');
    text.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', 'Dismiss');
    closeBtn.onclick = () => this.clearError();

    this.errorBanner.appendChild(text);
    this.errorBanner.appendChild(closeBtn);
    this.errorBanner.style.display = 'flex';
  }

  clearError() {
    this.errorBanner.style.display = 'none';
    this.errorBanner.innerHTML = '';
  }
}

let dashboard;
document.addEventListener('DOMContentLoaded', () => {
  dashboard = new ExecutionHistoryDashboard();
});
