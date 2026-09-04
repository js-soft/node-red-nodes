class DatabaseAdapter {
  async connect(config) {
    throw new Error('connect() must be implemented');
  }

  async disconnect() {
    throw new Error('disconnect() must be implemented');
  }

  async createExecution(executionData) {
    throw new Error('createExecution() must be implemented');
  }

  async updateExecution(executionId, updates) {
    throw new Error('updateExecution() must be implemented');
  }

  async recordMessage(executionId, nodeId, message, direction = 'input', options = {}) {
    throw new Error('recordMessage() must be implemented');
  }

  async recordError(executionId, nodeId, error) {
    throw new Error('recordError() must be implemented');
  }

  async getExecution(executionId) {
    throw new Error('getExecution() must be implemented');
  }

  async listExecutions(filter = {}, options = {}) {
    throw new Error('listExecutions() must be implemented');
  }

  // Same filter/options shape as listExecutions, but one row per replay/
  // retry CHAIN (grouped by rootExecutionId) instead of one row per
  // execution - see mongodb-adapter.js for the aggregation and what each
  // group's fields mean.
  async listExecutionsGrouped(filter = {}, options = {}) {
    throw new Error('listExecutionsGrouped() must be implemented');
  }

  // Every raw execution belonging to one replay/retry chain, oldest first -
  // backs the dashboard's per-row expand control (see listExecutionsGrouped).
  async getExecutionChain(rootExecutionId) {
    throw new Error('getExecutionChain() must be implemented');
  }

  async getExecutionMessages(executionId) {
    throw new Error('getExecutionMessages() must be implemented');
  }

  // edges: array of { sourcePort, destinationNodeId }
  async recordEdges(executionId, sourceNodeId, edges) {
    throw new Error('recordEdges() must be implemented');
  }

  async getExecutionEdges(executionId) {
    throw new Error('getExecutionEdges() must be implemented');
  }

  async deleteExecution(executionId) {
    throw new Error('deleteExecution() must be implemented');
  }

  // Every message recorded at a 'replay-point' node for this execution,
  // chronologically ordered. Powers both the replay UI's checkpoint picker
  // and the /replay endpoint's default choice (the last one recorded, i.e.
  // the one closest to wherever the execution later failed).
  async getReplayPoints(executionId) {
    throw new Error('getReplayPoints() must be implemented');
  }

  // Cross-references a completed replay back onto the execution it was
  // replayed FROM, so the dashboard can show "replayed as {newExecutionId}"
  // alongside it. options.autoTriggered marks the entry as produced by an
  // automatic (not human-clicked) retry; options.exhausted additionally
  // marks it as the one-time link to a beginAutoExhausted execution (the
  // retry mechanism giving up), not an actual retry attempt - both are
  // autoTriggered, but only actual retries should ever be called that in
  // the UI.
  async recordReplayLink(originalExecutionId, newExecutionId, options = {}) {
    throw new Error('recordReplayLink() must be implemented');
  }

  // Sets the additive scheduledRetry annotation on a FAILED execution -
  // see mongodb-adapter.js for why this is a field, not a new status value.
  async markAwaitingRetry(executionId, dueAt, attempt, nodeId, messageIds) {
    throw new Error('markAwaitingRetry() must be implemented');
  }

  // Atomically clears scheduledRetry ONLY if still present, returning what
  // was cleared (or null) - this is the operation that makes a live
  // setTimeout and the startup reconciliation scan safe to race against
  // each other without double-firing the same retry.
  async claimScheduledRetry(executionId) {
    throw new Error('claimScheduledRetry() must be implemented');
  }

  // Unconditional clear - used when something else (e.g. a manual replay)
  // supersedes a pending automatic retry.
  async clearScheduledRetry(executionId) {
    throw new Error('clearScheduledRetry() must be implemented');
  }

  async markRetriesExhausted(executionId) {
    throw new Error('markRetriesExhausted() must be implemented');
  }

  // Every execution with a pending scheduledRetry (due or not) - backs
  // startup reconciliation, since an in-memory retry timer never survives
  // a Node-RED process restart on its own.
  async getPendingAutoRetries() {
    throw new Error('getPendingAutoRetries() must be implemented');
  }

  // cutoffDate === null deletes everything
  async clearExecutions(cutoffDate) {
    throw new Error('clearExecutions() must be implemented');
  }

  async getStatistics() {
    throw new Error('getStatistics() must be implemented');
  }

  // Returns every distinct flow NAME that has at least one recorded
  // execution, as [{ flowName }], for populating a "filter by flow"
  // dropdown. Grouped by name (not flowId, the origin node's tab id) since
  // two differently named origins can share one tab.
  async getDistinctFlows() {
    throw new Error('getDistinctFlows() must be implemented');
  }

  // Deep Search: literal substring match against every recorded message's
  // content (not just execution metadata). filter accepts the same
  // status/flowName/createdAfter/createdBefore shape as listExecutions.
  // options.matchPosition selects which of an execution's (possibly
  // several) matching messages is reported: 'first' (default - the
  // earliest one, chronologically) or 'last' (the most recent one).
  // Returns { executions, total } where each execution is additionally
  // annotated with `matchCount` and `match` (the selected message's
  // nodeId/nodeName/messageId/snippet), for the dashboard's Deep Search tab.
  async searchMessages(searchTerm, filter = {}, options = {}) {
    throw new Error('searchMessages() must be implemented');
  }
}

module.exports = DatabaseAdapter;
