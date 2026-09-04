const DatabaseAdapter = require('../database-adapter');
const { MongoClient, ObjectId } = require('mongodb');
const { safeClone } = require('../safe-json');
const { flattenForSearch, buildSnippet } = require('../search-text');

// Deep Search scans messagesCollection with an unanchored regex, which
// can't use an index - this caps the worst case (a term with huge numbers
// of hits) at a bounded amount of work rather than a full unbounded scan.
// Sorted by timestamp desc first, so if the cap IS hit, what gets dropped is
// the oldest/least-recent matches, not an arbitrary subset.
const MAX_SCANNED_MESSAGES = 5000;

class MongoDBAdapter extends DatabaseAdapter {
  constructor() {
    super();
    this.client = null;
    this.db = null;
    this.executionsCollection = null;
    this.messagesCollection = null;
    this.edgesCollection = null;
  }

  async connect(config) {
    const {
      uri, database,
      executionsCollection = 'executions',
      messagesCollection = 'execution_messages',
      edgesCollection = 'execution_edges'
    } = config;

    if (!uri || !database) {
      throw new Error('MongoDB URI and database name are required');
    }

    this.client = new MongoClient(uri);
    await this.client.connect();
    this.db = this.client.db(database);
    this.executionsCollection = this.db.collection(executionsCollection);
    this.messagesCollection = this.db.collection(messagesCollection);
    this.edgesCollection = this.db.collection(edgesCollection);

    await this._ensureIndexes();
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
    }
  }

  async _ensureIndexes() {
    await this.executionsCollection.createIndex({ executionId: 1 }, { unique: true });
    await this.executionsCollection.createIndex({ status: 1 });
    await this.executionsCollection.createIndex({ createdAt: 1 });
    await this.executionsCollection.createIndex({ flowId: 1 });

    await this.messagesCollection.createIndex({ executionId: 1 });
    await this.messagesCollection.createIndex({ nodeId: 1 });
    await this.messagesCollection.createIndex({ timestamp: 1 });

    await this.edgesCollection.createIndex({ executionId: 1 });
    await this.edgesCollection.createIndex({ executionId: 1, sourceNodeId: 1 });

    // Sparse: only executions with a pending automatic retry ever have
    // scheduledRetry.dueAt at all, so this stays small regardless of how
    // much history accumulates. Backs the startup reconciliation scan (see
    // getPendingAutoRetries) that re-arms any retry a Node-RED restart
    // would otherwise have silently dropped.
    await this.executionsCollection.createIndex({ 'scheduledRetry.dueAt': 1 }, { sparse: true });

    // Backs listExecutionsGrouped's two-pass lookup (find matching roots,
    // then pull every member of those roots).
    await this.executionsCollection.createIndex({ rootExecutionId: 1 });
  }

  async createExecution(executionData) {
    const execution = {
      executionId: executionData.executionId,
      flowId: executionData.flowId,
      status: 'RUNNING',
      startTime: new Date(),
      endTime: null,
      duration: null,
      nodeCount: 0,
      messageCount: 0,
      error: null,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...executionData,
      // Stamped once at creation, never recomputed - a real inject/http-in
      // origin is its own root; a restart/checkpoint/auto/auto-exhausted
      // resume inherits whatever root its parent already carries (or the
      // parent's own id, if the parent predates this field or is itself the
      // root). Lets listExecutionsGrouped group a whole replay/retry chain
      // with one indexed match instead of walking replayOf on every read.
      rootExecutionId: executionData.rootExecutionId || executionData.executionId
    };

    await this.executionsCollection.insertOne(execution);
    return execution;
  }

  async updateExecution(executionId, updates) {
    const updateData = {
      ...updates,
      updatedAt: new Date()
    };

    if (updates.status === 'COMPLETED' || updates.status === 'FAILED') {
      updateData.endTime = new Date();
    }

    // mongodb driver v6+ returns the document directly (no more { value } wrapper)
    return await this.executionsCollection.findOneAndUpdate(
      { executionId },
      { $set: updateData },
      { returnDocument: 'after' }
    );
  }

  async recordMessage(executionId, nodeId, message, direction = 'input', options = {}) {
    const payload = safeClone(message);

    const messageRecord = {
      _id: new ObjectId(),
      executionId,
      nodeId,
      nodeName: options.nodeName || null,
      direction,
      isFirst: options.isFirst === true,
      isResult: options.isResult === true,
      isError: options.isError === true,
      isReplayPoint: options.isReplayPoint === true,
      isReplayed: options.isReplayed === true,
      isRestarted: options.isRestarted === true,
      isDebugResume: options.isDebugResume === true,
      isAutoReplayPoint: options.isAutoReplayPoint === true,
      isAutoReplayed: options.isAutoReplayed === true,
      payload,
      // Flattened text of `payload`'s values only (no keys/structure) -
      // Deep Search matches against this, not the raw JSON, so it isn't
      // tripped up by unrelated punctuation/structure in the payload shape.
      payloadText: flattenForSearch(payload),
      timestamp: new Date(),
      createdAt: new Date()
    };

    await this.messagesCollection.insertOne(messageRecord);

    await this.executionsCollection.updateOne(
      { executionId },
      {
        $inc: { messageCount: 1 },
        $set: { updatedAt: new Date() }
      }
    );

    return messageRecord;
  }

  async recordError(executionId, nodeId, error) {
    const errorRecord = {
      executionId,
      nodeId,
      message: error.message,
      stack: error.stack,
      timestamp: new Date(),
      createdAt: new Date()
    };

    await this.executionsCollection.updateOne(
      { executionId },
      {
        $set: {
          error: errorRecord,
          status: 'FAILED',
          updatedAt: new Date()
        }
      }
    );

    return errorRecord;
  }

  async getExecution(executionId) {
    return await this.executionsCollection.findOne({ executionId });
  }

  // Persisted counts, not in-memory bookkeeping - executions accumulate in
  // the database indefinitely (until retention cleanup), so this reflects
  // real history rather than only whatever's still tracked in this
  // process's memory.
  async getStatistics() {
    const [total, running, completed, failed, replays, exhausted] = await Promise.all([
      this.executionsCollection.countDocuments({}),
      this.executionsCollection.countDocuments({ status: 'RUNNING' }),
      this.executionsCollection.countDocuments({ status: 'COMPLETED' }),
      this.executionsCollection.countDocuments({ status: 'FAILED' }),
      this.executionsCollection.countDocuments({ replayOf: { $exists: true, $ne: null } }),
      // A stronger "needs a human" signal than `failed` alone - a FAILED
      // execution may already have been auto-retried into eventual success
      // downstream, but retriesExhausted specifically means the automatic
      // retry mechanism gave up and nothing further will happen on its own
      // (see the auto-replay-point node's "When exhausted" setting).
      this.executionsCollection.countDocuments({ retriesExhausted: true })
    ]);

    return { total, running, completed, failed, replays, exhausted };
  }

  // One entry per distinct flowName, sorted alphabetically, for a dashboard
  // "filter by flow" dropdown. Grouped by NAME rather than flowId
  // deliberately: flowId is the origin node's TAB id, so two differently
  // named origins (e.g. two inject nodes) on the same tab would otherwise
  // collide into one dropdown entry and filtering by one name would also
  // pull in the other's executions.
  async getDistinctFlows() {
    const names = await this.executionsCollection.distinct('flowName');
    return names.filter(Boolean).sort().map(flowName => ({ flowName }));
  }

  async listExecutions(filter = {}, options = {}) {
    const { limit = 100, skip = 0, sort = { createdAt: -1 } } = options;

    const query = this._buildQuery(filter);

    const executions = await this.executionsCollection
      .find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .toArray();

    const total = await this.executionsCollection.countDocuments(query);

    return { executions, total };
  }

  // edges: array of { sourcePort, destinationNodeId } - one per wire this
  // node's send() call actually dispatched to. Lets the dashboard
  // reconstruct which node's output fed which downstream node, i.e. the
  // real branch structure a message took, not just a flat "these nodes ran".
  async recordEdges(executionId, sourceNodeId, edges) {
    if (!edges || edges.length === 0) return;

    const docs = edges.map(edge => ({
      _id: new ObjectId(),
      executionId,
      sourceNodeId,
      sourcePort: edge.sourcePort,
      destinationNodeId: edge.destinationNodeId,
      createdAt: new Date()
    }));

    await this.edgesCollection.insertMany(docs);
  }

  async getExecutionEdges(executionId) {
    return await this.edgesCollection
      .find({ executionId })
      .sort({ _id: 1 })
      .toArray();
  }

  async getExecutionMessages(executionId) {
    // _id (an ObjectId, monotonically increasing per-process) is a
    // secondary sort key/tiebreaker: several messages routinely land in the
    // same millisecond, and timestamp alone doesn't have enough resolution
    // to preserve actual recording order for those - _id does.
    return await this.messagesCollection
      .find({ executionId })
      .sort({ timestamp: 1, _id: 1 })
      .toArray();
  }

  async deleteExecution(executionId) {
    await this.executionsCollection.deleteOne({ executionId });
    await this.messagesCollection.deleteMany({ executionId });
    await this.edgesCollection.deleteMany({ executionId });
  }

  // A Mark Auto Replay Point node is exactly as safe a manual reset
  // location as a Mark Replay Point one - if it's safe enough to retry
  // itself automatically and repeatedly, it's safe enough for a human to
  // manually resume from too. isAutoReplayPoint messages are therefore
  // valid checkpoint candidates alongside isReplayPoint ones.
  async getReplayPoints(executionId) {
    return await this.messagesCollection
      .find({ executionId, $or: [{ isReplayPoint: true }, { isAutoReplayPoint: true }] })
      .sort({ timestamp: 1, _id: 1 })
      .toArray();
  }

  async recordReplayLink(originalExecutionId, newExecutionId, options = {}) {
    const entry = { executionId: newExecutionId, timestamp: new Date() };
    if (options.autoTriggered) entry.autoTriggered = true;
    // Set only for the one-time link to a beginAutoExhausted execution -
    // distinguishes "the automatic retry mechanism gave up here" from an
    // actual retry attempt, both of which are autoTriggered:true. Without
    // this, the dashboard has no way to tell the two apart and mislabels
    // the exhausted-output link as just another "auto-retried" entry.
    if (options.exhausted) entry.exhausted = true;

    await this.executionsCollection.updateOne(
      { executionId: originalExecutionId },
      {
        $push: { replays: entry },
        $set: { updatedAt: new Date() }
      }
    );
  }

  // Additive annotation on a FAILED execution rather than a new status
  // value - keeps every existing status-aware code path (getStatistics,
  // _buildQuery, dashboard row coloring) unaware and unaffected. Cleared
  // (see clearScheduledRetry) the moment the retry actually fires, whether
  // via its own live setTimeout or the startup reconciliation scan - see
  // getPendingAutoRetries.
  async markAwaitingRetry(executionId, dueAt, attempt, nodeId, messageIds) {
    await this.executionsCollection.updateOne(
      { executionId },
      {
        $set: {
          scheduledRetry: { dueAt, attempt, nodeId, messageIds },
          updatedAt: new Date()
        }
      }
    );
  }

  // Atomic claim: only actually clears (and the caller only proceeds with
  // dispatching the retry) if scheduledRetry was still present at the
  // moment this runs. This is what makes a live setTimeout and the startup
  // reconciliation scan safe to race against each other - whichever gets
  // here first wins, the other finds nothing left to claim.
  async claimScheduledRetry(executionId) {
    const result = await this.executionsCollection.findOneAndUpdate(
      { executionId, scheduledRetry: { $exists: true } },
      { $unset: { scheduledRetry: '' }, $set: { updatedAt: new Date() } },
      { returnDocument: 'before' }
    );
    return result ? result.scheduledRetry : null;
  }

  async clearScheduledRetry(executionId) {
    await this.executionsCollection.updateOne(
      { executionId },
      { $unset: { scheduledRetry: '' }, $set: { updatedAt: new Date() } }
    );
  }

  async markRetriesExhausted(executionId) {
    await this.executionsCollection.updateOne(
      { executionId },
      { $set: { retriesExhausted: true, updatedAt: new Date() } }
    );
  }

  // Backs startup reconciliation - anything with a scheduledRetry at all
  // (due or not) needs either firing immediately (if overdue) or a fresh
  // setTimeout re-armed for its remaining time, since an in-memory timer
  // never survives a process restart on its own.
  async getPendingAutoRetries() {
    return await this.executionsCollection
      .find({ 'scheduledRetry.dueAt': { $exists: true } })
      .toArray();
  }

  // cutoffDate === null deletes everything. Finds matching executionIds
  // first and deletes their messages by that id, rather than filtering
  // messages by their own createdAt independently - a long-running
  // execution's messages can easily have a later createdAt than its own
  // (older) execution document, which would otherwise leave orphaned
  // message documents behind with no parent execution.
  async clearExecutions(cutoffDate) {
    const filter = cutoffDate ? { createdAt: { $lt: cutoffDate } } : {};

    const matching = await this.executionsCollection
      .find(filter, { projection: { executionId: 1, _id: 0 } })
      .toArray();
    const executionIds = matching.map(e => e.executionId);

    if (executionIds.length > 0) {
      await this.messagesCollection.deleteMany({ executionId: { $in: executionIds } });
      await this.edgesCollection.deleteMany({ executionId: { $in: executionIds } });
    }

    const result = await this.executionsCollection.deleteMany(filter);
    return result.deletedCount;
  }

  // Groups a chain of replay/retry executions - an execution and everything
  // eventually created FROM it via replayOf, however many generations deep -
  // into one row keyed by the chain's ROOT executionId (see rootExecutionId
  // in createExecution above). Executions from before that field existed
  // have no rootExecutionId at all; effectiveRoot's $ifNull falls back to
  // their own executionId, so they simply show as their own one-member
  // group rather than joining anything - a one-time gap, same tradeoff as
  // every other additive field in this schema.
  //
  // Two passes, both needed because a filter can match a NON-root member
  // (e.g. searching for a retried execution's own id) while the group's
  // displayed status/duration must still reflect its LATEST member
  // regardless of whether that member itself matched:
  //   1. find which root ids have ANY member matching the filter
  //      (status excluded here - it's evaluated post-group, against the
  //      group's effective/last status, not any individual member's)
  //   2. pull in EVERY member of just those roots, then group.
  async listExecutionsGrouped(filter = {}, options = {}) {
    const { limit = 100, skip = 0 } = options;
    const { status, ...preFilter } = filter;
    const preQuery = this._buildQuery(preFilter);

    const rootIdDocs = await this.executionsCollection.aggregate([
      { $match: preQuery },
      { $project: { effectiveRoot: { $ifNull: ['$rootExecutionId', '$executionId'] } } },
      { $group: { _id: '$effectiveRoot' } }
    ]).toArray();

    const rootIds = rootIdDocs.map(d => d._id);
    if (rootIds.length === 0) {
      return { executions: [], total: 0 };
    }

    const basePipeline = [
      { $addFields: { effectiveRoot: { $ifNull: ['$rootExecutionId', '$executionId'] } } },
      { $match: { effectiveRoot: { $in: rootIds } } },
      // Ascending, so $first below lands on the earliest (root) member and
      // $last lands on the most recent one - the chain's current state.
      { $sort: { createdAt: 1 } },
      {
        $group: {
          _id: '$effectiveRoot',
          executionId: { $first: '$executionId' },
          flowId: { $first: '$flowId' },
          flowName: { $first: '$flowName' },
          startTime: { $first: '$startTime' },
          status: { $last: '$status' },
          lastExecutionId: { $last: '$executionId' },
          lastEndTime: { $last: '$endTime' },
          lastCreatedAt: { $last: '$createdAt' },
          lastReplayMode: { $last: '$replayMode' },
          retriesExhausted: { $max: { $cond: ['$retriesExhausted', 1, 0] } },
          executionCount: { $sum: 1 }
        }
      },
      ...(status ? [{ $match: { status } }] : [])
    ];

    const [groups, totalResult] = await Promise.all([
      this.executionsCollection.aggregate([
        ...basePipeline,
        { $sort: { lastCreatedAt: -1 } },
        { $skip: skip },
        { $limit: limit }
      ]).toArray(),
      this.executionsCollection.aggregate([...basePipeline, { $count: 'total' }]).toArray()
    ]);

    // Flow-Duration: the whole chain's wall-clock span, first message of the
    // first execution to the last recorded activity of the latest one - not
    // any single execution's own `duration` field. Absent (renders as '-',
    // same as an in-flight execution's duration today) while the latest
    // member is still RUNNING and hasn't set endTime yet.
    const executions = groups.map(g => ({
      executionId: g.executionId,
      lastExecutionId: g.lastExecutionId,
      flowId: g.flowId,
      flowName: g.flowName,
      status: g.status,
      startTime: g.startTime,
      duration: g.lastEndTime ? (new Date(g.lastEndTime).getTime() - new Date(g.startTime).getTime()) : null,
      retriesExhausted: g.retriesExhausted > 0,
      executionCount: g.executionCount,
      // The LAST member's replayMode, exposed under the same field name a
      // raw execution document uses - lets the dashboard's tag rendering
      // treat a grouped summary row and an individual execution identically
      // (e.g. flagging "automatic replay failed" when the chain's most
      // recent event was a beginAutoExhausted execution).
      replayMode: g.lastReplayMode
    }));

    return { executions, total: totalResult[0] ? totalResult[0].total : 0 };
  }

  // Every raw execution document belonging to one chain (its own effective
  // root, plus every generation replayed/retried from it), oldest first -
  // backs the dashboard's per-row "inspect individual executions" expand
  // control, an alternative to the global grouping toggle for drilling into
  // just ONE chain without ungrouping everything else in the list. Same
  // effectiveRoot fallback as listExecutionsGrouped, for the same reason.
  async getExecutionChain(rootExecutionId) {
    return await this.executionsCollection.aggregate([
      { $addFields: { effectiveRoot: { $ifNull: ['$rootExecutionId', '$executionId'] } } },
      { $match: { effectiveRoot: rootExecutionId } },
      { $sort: { createdAt: 1 } }
    ]).toArray();
  }

  _buildQuery(filter) {
    const query = {};

    if (filter.status) query.status = filter.status;
    if (filter.flowId) query.flowId = filter.flowId;
    if (filter.executionId) {
      const escaped = filter.executionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.executionId = { $regex: escaped, $options: 'i' };
    }
    // Case-insensitive substring match, not exact - the dashboard's flow
    // filter is a free-text input (with a datalist of known names as
    // type-ahead suggestions, not an enforced enum), so a partial typed
    // name should still narrow results down.
    if (filter.flowName) {
      const escaped = filter.flowName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.flowName = { $regex: escaped, $options: 'i' };
    }
    if (filter.createdAfter || filter.createdBefore) {
      query.createdAt = {};
      if (filter.createdAfter) query.createdAt.$gte = new Date(filter.createdAfter);
      if (filter.createdBefore) query.createdAt.$lte = new Date(filter.createdBefore);
    }
    // "Replays only" - executions produced by a restart/checkpoint/debug
    // resume (see execution-manager.js's beginRestart/beginResume), not a
    // real inject/http-in origin firing. Independent of `status`, so it
    // combines with it rather than replacing it (e.g. "FAILED replays").
    if (filter.onlyReplays) {
      query.replayOf = { $exists: true, $ne: null };
    }

    return query;
  }

  // See DatabaseAdapter#searchMessages for the contract. Two-step lookup:
  // 1) find messages whose payloadText contains the term (bounded by
  //    MAX_SCANNED_MESSAGES), reduced to one match per execution - either
  //    its EARLIEST matching message ('first', the default - the point
  //    where the searched-for content first entered the flow) or its
  //    LATEST ('last') per options.matchPosition;
  // 2) apply the normal status/flowName/date filter to just THOSE
  //    executions, and paginate at the execution level - a term appearing
  //    in several messages of the same execution should still surface it
  //    only once in the results list.
  async searchMessages(searchTerm, filter = {}, options = {}) {
    const { limit = 50, skip = 0, matchPosition = 'first' } = options;
    if (!searchTerm) return { executions: [], total: 0 };

    const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const messageQuery = { payloadText: { $regex: escaped, $options: 'i' } };

    // Narrowing by the message's own timestamp (indexed) before the regex
    // runs, whenever a date range filter is present, so Mongo isn't forced
    // to regex-scan messages outside the requested window at all.
    if (filter.createdAfter || filter.createdBefore) {
      messageQuery.timestamp = {};
      if (filter.createdAfter) messageQuery.timestamp.$gte = new Date(filter.createdAfter);
      if (filter.createdBefore) messageQuery.timestamp.$lte = new Date(filter.createdBefore);
    }

    // Sorted newest-first so that IF the MAX_SCANNED_MESSAGES cap is hit,
    // what gets dropped is the oldest overflow, not an arbitrary subset -
    // see MAX_SCANNED_MESSAGES above. This means, within one execution's
    // matches, the first one encountered while iterating is its LATEST
    // ('last') match, and the last one encountered is its EARLIEST
    // ('first') match.
    const matches = await this.messagesCollection
      .find(messageQuery)
      .project({ executionId: 1, nodeId: 1, nodeName: 1, payloadText: 1, timestamp: 1 })
      .sort({ timestamp: -1 })
      .limit(MAX_SCANNED_MESSAGES)
      .toArray();

    const latestMatchByExecution = new Map();
    const earliestMatchByExecution = new Map();
    const matchCountByExecution = new Map();
    for (const m of matches) {
      matchCountByExecution.set(m.executionId, (matchCountByExecution.get(m.executionId) || 0) + 1);
      if (!latestMatchByExecution.has(m.executionId)) {
        latestMatchByExecution.set(m.executionId, m);
      }
      // Repeatedly overwritten as we iterate newest-to-oldest - the final
      // write for each executionId is therefore its oldest/earliest match.
      earliestMatchByExecution.set(m.executionId, m);
    }

    const matchByExecution = matchPosition === 'last' ? latestMatchByExecution : earliestMatchByExecution;

    const executionIds = [...matchByExecution.keys()];
    if (executionIds.length === 0) {
      return { executions: [], total: 0, truncated: matches.length >= MAX_SCANNED_MESSAGES };
    }

    const query = this._buildQuery(filter);
    query.executionId = { $in: executionIds };

    const [total, executions] = await Promise.all([
      this.executionsCollection.countDocuments(query),
      this.executionsCollection
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray()
    ]);

    const annotated = executions.map(exec => {
      const match = matchByExecution.get(exec.executionId);
      return {
        ...exec,
        matchCount: matchCountByExecution.get(exec.executionId) || 0,
        match: match ? {
          nodeId: match.nodeId,
          nodeName: match.nodeName,
          messageId: match._id,
          snippet: buildSnippet(match.payloadText, searchTerm)
        } : null
      };
    });

    return { executions: annotated, total, truncated: matches.length >= MAX_SCANNED_MESSAGES };
  }
}

module.exports = MongoDBAdapter;
