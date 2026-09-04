const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const ExecutionManager = require('./lib/execution-manager');
const MongoDBAdapter = require('./lib/storage/mongodb-adapter');
const { generateExecutionId } = require('./lib/id-generator');
const { safeClone } = require('./lib/safe-json');

// Shared ExecutionManager connections, keyed by database config name. Kept
// as plain in-process module-level Promises (NOT RED.settings/context,
// which are backed by stores that clone/serialize their values - a live
// MongoClient holds an open TCP socket, and attempting to clone that throws
// "Cannot assign to read only property 'writeQueueSize' of object '#<TCP>'").
// Caching the in-flight Promise (not just the resolved manager) means
// concurrent callers - e.g. several inject/http-in nodes firing at once -
// await the same connection attempt instead of racing to open several.
const managerPromises = new Map();

function getManager(RED, database) {
  if (managerPromises.has(database)) {
    return managerPromises.get(database);
  }

  const promise = (async () => {
    const dbConfig = RED.settings.get(`execHistoryDB_${database}`);
    if (!dbConfig) {
      throw new Error(`Database configuration 'execHistoryDB_${database}' not found. Configure it in Node-RED settings.`);
    }

    const adapter = new MongoDBAdapter();
    await adapter.connect(dbConfig);
    return new ExecutionManager(adapter);
  })();

  // Don't cache a failed connection attempt forever - let the next
  // message/node instance retry.
  promise.catch(() => managerPromises.delete(database));

  managerPromises.set(database, promise);
  return promise;
}

// A node's display name for an unnamed node - what the Node-RED editor
// itself would show, not an invented placeholder. Most node types that
// don't define their own editor label() fall back to just the node type
// (Node-RED's own built-in default), which is what we use here too.
// http in/http response are deliberate special cases, since they define
// their own label() (see @node-red/nodes/core/network/21-httpin.html):
// http in shows "[METHOD] /url"; http response shows "http" (or
// "http (statusCode)" if one is set) - NOT "http response". Both nodes'
// relevant config (.url/.method/.statusCode) and .httpNodeRoot (a runtime
// setting) are available server-side too, so both can be replicated exactly.
function getDisplayName(RED, node) {
  if (node.name) return node.name;

  if (node.type === 'http in' && node.url) {
    let root = RED.settings.httpNodeRoot || '/';
    if (root.slice(-1) !== '/') root += '/';
    root += node.url.charAt(0) === '/' ? node.url.slice(1) : node.url;
    return `[${node.method}] ${root}`;
  }

  if (node.type === 'http response') {
    return `http${node.statusCode ? ` (${node.statusCode})` : ''}`;
  }

  return node.type;
}

// Deliberately separate from Node-RED's own adminAuth: this dashboard
// exposes recorded message PAYLOADS (potentially PII, secrets, business
// data), not just flow structure - a much more sensitive surface than the
// editor itself, and one many installs don't otherwise password-protect at
// all. Read fresh on every request (settings.js is only ever loaded at
// startup anyway, so this is cheap and avoids stale-value surprises after a
// hot-reload of settings in unusual setups).
function getDashboardAuthConfig(RED) {
  const config = RED.settings.get('execHistoryAuth');
  if (!config || !config.username || !config.password) return null;
  return config;
}

// HTTP Basic Auth, checked against a bcrypt hash - the same mechanism (and
// the same bcryptjs library) Node-RED's own adminAuth already uses, so an
// existing `node-red admin hash-pw` hash is directly reusable. Chosen over
// a custom login page/session/cookie flow: the browser handles the prompt
// and credential caching natively, there's no session store or CSRF
// surface to get wrong, and it protects API clients (curl, scripts) with
// the exact same header as browsers, not a separate mechanism.
//
// A no-op (calls next() immediately) when execHistoryAuth isn't configured
// at all - that's an intentional, visible choice for whoever set up this
// Node-RED instance, not something this middleware silently enforces a
// default for. The dashboard itself displays a prominent warning banner
// in that case (see the /api/executions/config authConfigured field) so
// running unsecured is never silent.
function requireDashboardAuth(RED) {
  return (req, res, next) => {
    const config = getDashboardAuthConfig(RED);
    if (!config) return next();

    const header = req.headers.authorization || '';
    const match = /^Basic\s+([A-Za-z0-9+/=]+)$/.exec(header);
    if (match) {
      const decoded = Buffer.from(match[1], 'base64').toString('utf8');
      const sepIndex = decoded.indexOf(':');
      const user = sepIndex === -1 ? decoded : decoded.slice(0, sepIndex);
      const pass = sepIndex === -1 ? '' : decoded.slice(sepIndex + 1);

      // Constant-time-ish: bcrypt.compareSync always runs the same hashing
      // work regardless of where the input first differs, so this doesn't
      // leak timing information about a correct username the way a plain
      // `user === config.username` short-circuit followed by an early
      // return could in principle contribute to.
      if (user === config.username && bcrypt.compareSync(pass, config.password)) {
        return next();
      }
    }

    res.set('WWW-Authenticate', 'Basic realm="Execution Resilience Dashboard"');
    return res.status(401).send('Authentication required');
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Translates a dashboard-facing scope value into a cutoff Date for
// clearExecutions() - executions with createdAt before the cutoff get
// deleted. null means "delete everything". undefined means the scope
// itself was invalid.
function scopeToCutoffDate(scope) {
  switch (scope) {
    case '30d': return new Date(Date.now() - 30 * DAY_MS);
    case '7d': return new Date(Date.now() - 7 * DAY_MS);
    case 'today': {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      return startOfToday;
    }
    case 'all': return null;
    default: return undefined;
  }
}

module.exports = function(RED) {
  let warnedMissingDefaultDb = false;

  // executionId -> Promise, resolved once beginExecution's DB write has
  // landed. Registered SYNCHRONOUSLY (see onSend below) so onComplete can
  // await it. This matters because Node.prototype.send() is fire-and-forget
  // from the calling node's perspective: core nodes like inject call
  // `send(msg); done();` back-to-back in the same synchronous tick, with no
  // await on send() in between. If onSend only stamped msg._executionId
  // after its own first `await`, that stamp would land in a later
  // microtask - possibly after the origin node's own done() (and thus our
  // onComplete handler) already ran and saw no execution id at all.
  const pendingBegins = new Map();

  // nodeId -> stack of executionIds, one entry pushed per message this node
  // is currently receiving - scoped to exactly the SYNCHRONOUS dispatch
  // window of Node-RED's _emitInput (push on 'onReceive', pop on
  // 'postReceive', which fires right after the node's input handler
  // *returns* - not after done()/onComplete). This is what lets onSend's
  // fallback below safely inherit an execution id for messages sent via a
  // node's own hand-rolled fan-out (e.g. a forEach + node.send() loop) that
  // don't otherwise carry one. Scoping it to the synchronous window - rather
  // than the node's whole async lifetime up to done() - means a second,
  // unrelated message concurrently in flight to the same node can never
  // clobber this while an earlier one is still mid-flight asynchronously:
  // that second message's own 'onReceive' can only run after the first
  // one's synchronous handler call has already returned and popped its
  // entry. A stack (not a single slot) additionally covers a node that
  // synchronously triggers another node which synchronously sends back into
  // it - true reentrancy, which always unwinds in strict LIFO order.
  const activeReceivesByNode = new Map();

  // nodeId -> queue of messages this node has actually send() 'ed, not yet
  // claimed by a matching onComplete. Exists because done() and send() are
  // NOT 1:1 for every node - a buffering/aggregating node (the built-in Join
  // being the standard example) can call done() once for every message it
  // RECEIVES while only calling send() once for the combined group it
  // eventually PRODUCES. Node-RED's own Join implementation
  // (@node-red/nodes/core/sequence/17-split.js) demonstrates this exactly:
  // it queues each received message's own `done` callback
  // (`inflight[partId].dones.push(done)`) without invoking it, then once the
  // group completes, calls the ONE `send()` followed immediately by ALL of
  // the queued `done()`s in a batch (`group.send(...); group.dones.forEach(f
  // => f())`). Each of those done() calls still carries its own ORIGINAL
  // (pre-join) message as far as onComplete is concerned - none of them is
  // "the" joined message - so recording completeEvent.msg naively would
  // record the join node as having output 4 un-joined messages instead of
  // the 1 it actually sent. This queue lets onComplete instead record what
  // the node actually dispatched.
  const sentQueueByNode = new Map();

  // executionId -> { nodeId, nodeName } - tracks whether THIS execution has
  // passed through an 'auto-replay-point' node, and which one (the most
  // recent, if more than one) - so recordFailure below knows whether to
  // schedule an automatic retry at all, and from where. Populated
  // SYNCHRONOUSLY in the onSend hook (like pendingBegins above), not in the
  // async recordOneCompletion path - deliberately, to close a real race: a
  // downstream node that fails synchronously (e.g. a Function node calling
  // done(err) with no async work) can have its whole failure chain run
  // inside the auto-replay-point node's OWN send() call, before that node's
  // own done()/onComplete/queueMicrotask chain would otherwise have gotten
  // around to recording anything.
  const autoReplayTracking = new Map();

  // nodeId -> live node instance, so an automatic retry's exhausted-output
  // can be fired from an async timer callback with no live 'input' event to
  // send() from. Mirrors node-red-contrib-human-decision's own nodeRegistry
  // pattern (the only other place in this repo needing the same thing).
  const autoReplayNodeRegistry = new Map();

  // executionId -> { timer, nodeId } - lets an auto-replay-point node's
  // close() cancel every retry timer IT owns before Node-RED tears the
  // instance down (a redeploy recreates every node instance, not just
  // changed ones), so a fired timer can never run against a dead instance.
  const pendingRetryTimers = new Map();

  // -------------------------------------------------------------------
  // Global instrumentation, two jobs in one hook (both keyed off the same
  // onSend event, which fires for every node's send() - not just origins):
  //
  // 1. Every inject / http-in node is a flow origin, so this is where an
  //    execution genuinely begins - tracking works for every flow
  //    automatically, with no node placement required, and the flow name is
  //    exactly that origin node's configured name - the thing the user
  //    actually recognizes it by.
  //
  // 2. Record a graph edge (sourceNodeId/port -> destinationNodeId) for
  //    every tagged event, from every node, not just origins. This is what
  //    lets the dashboard reconstruct the actual branch structure a message
  //    took - which output port fed which downstream node - rather than
  //    just a flat "these nodes ran, in roughly this order" list.
  //
  // Deliberately NOT an async function: everything up to and including the
  // msg._executionId/_flowName stamping and the pendingBegins registration
  // must run synchronously, in the same tick as send() - see the comment
  // on pendingBegins above.
  // -------------------------------------------------------------------
  RED.hooks.add('onSend.execution-resilience', (sendEvents) => {
    if (!Array.isArray(sendEvents) || sendEvents.length === 0) return;

    const sourceNode = sendEvents[0].source && sendEvents[0].source.node;
    if (!sourceNode) return;

    if (sourceNode.type === 'inject' || sourceNode.type === 'http in') {
      // All events in one onSend call are the multiple destination wires of
      // a single send() - i.e. one firing of this origin node - so they
      // share one execution id. Only tag ones that don't already have one
      // (a message looping back into an inject/http-in shouldn't be
      // re-tagged).
      const untagged = sendEvents.filter(evt => evt.msg && !evt.msg._executionId);

      if (untagged.length > 0) {
        const executionId = generateExecutionId();
        const flowName = getDisplayName(RED, sourceNode);
        const flowId = sourceNode.z;

        for (const evt of untagged) {
          evt.msg._executionId = executionId;
          evt.msg._flowName = flowName;
        }

        const beginPromise = (async () => {
          let manager;
          try {
            manager = await getManager(RED, 'default');
          } catch (err) {
            if (!warnedMissingDefaultDb) {
              warnedMissingDefaultDb = true;
              RED.log.warn(`[execution-resilience] Not tracking inject/http-in origins: ${err.message}`);
            }
            return;
          }

          try {
            await manager.beginExecution(executionId, flowId, flowName, untagged[0].msg, sourceNode.id);
          } catch (err) {
            RED.log.error(`[execution-resilience] Failed to start tracked execution: ${err.message}`);
          }
        })();

        pendingBegins.set(executionId, beginPromise);
        beginPromise.finally(() => pendingBegins.delete(executionId));
      }
    }

    // Mark this execution as eligible for an automatic retry if it later
    // fails - see autoReplayTracking above for why this must happen HERE,
    // synchronously, rather than later in the async recordOneCompletion
    // path. Runs for every send() from an 'auto-replay-point' node,
    // regardless of how many destinations - a Split downstream of this
    // node re-fires it once per part, and each firing is for the same
    // execution, so last-write-wins on nodeId/nodeName is fine (there's
    // only ever one node here for a single part anyway).
    if (sourceNode.type === 'auto-replay-point') {
      for (const evt of sendEvents) {
        if (evt.msg && evt.msg._executionId) {
          autoReplayTracking.set(evt.msg._executionId, {
            nodeId: sourceNode.id,
            nodeName: getDisplayName(RED, sourceNode)
          });
        }
      }
    }

    // Fallback: this send() may be a node manually fanning out extra
    // messages (e.g. a forEach + node.send() loop) built as brand-new
    // objects rather than clones/mutations of the message it received -
    // Node-RED doesn't propagate custom msg properties like _executionId
    // onto objects you construct yourself. If this node is still
    // synchronously inside processing a tracked message (see
    // activeReceivesByNode above), inherit that message's execution id for
    // anything left untagged.
    const activeStack = activeReceivesByNode.get(sourceNode.id);
    if (activeStack && activeStack.length > 0) {
      const inheritedId = activeStack[activeStack.length - 1];
      for (const evt of sendEvents) {
        if (evt.msg && !evt.msg._executionId) {
          evt.msg._executionId = inheritedId;
        }
      }
    }

    // Record what this node actually just sent, for onComplete's queue-claim
    // logic (see sentQueueByNode above) to pick up. One entry per send()
    // call, not per destination wire - a single send() to several wires is
    // still just one dispatched message as far as "what did this node
    // output" is concerned.
    let sendQueue = sentQueueByNode.get(sourceNode.id);
    if (!sendQueue) {
      sendQueue = [];
      sentQueueByNode.set(sourceNode.id, sendQueue);
    }
    sendQueue.push(sendEvents[0].msg);

    // Edge recording: every event that now carries an execution id (just
    // stamped above, or already tagged from further upstream) describes one
    // wire this send() actually dispatched across.
    const taggedEvents = sendEvents.filter(evt => evt.msg && evt.msg._executionId && evt.destination);
    if (taggedEvents.length === 0) return;

    const executionId = taggedEvents[0].msg._executionId;
    const edges = taggedEvents.map(evt => ({
      sourcePort: evt.source.port,
      destinationNodeId: evt.destination.id
    }));

    (async () => {
      let manager;
      try {
        manager = await getManager(RED, 'default');
      } catch (err) {
        return; // already warned once above
      }

      try {
        await manager.recordEdges(executionId, sourceNode.id, edges);
      } catch (err) {
        RED.log.error(`[execution-resilience] Failed to record graph edges: ${err.message}`);
      }
    })();
  });

  // -------------------------------------------------------------------
  // Pair of hooks bounding a node's SYNCHRONOUS input-handler dispatch -
  // see activeReceivesByNode above for why this window (and not the node's
  // whole async lifetime up to done()) is what onSend's fallback relies on.
  // receiveEvent is the same object instance for both hooks (Node-RED's
  // _emitInput creates it once and passes it to both), so a marker stashed
  // on it in onReceive can be read back in postReceive to know whether THIS
  // particular call pushed an entry - without that, a node receiving an
  // untracked message (no _executionId - onReceive skips pushing) could pop
  // an entry that actually belongs to a different, genuinely reentrant call.
  // -------------------------------------------------------------------
  RED.hooks.add('onReceive.execution-resilience', (receiveEvent) => {
    const msg = receiveEvent && receiveEvent.msg;
    const node = receiveEvent && receiveEvent.destination && receiveEvent.destination.node;
    if (!msg || !node || !msg._executionId) return;

    let stack = activeReceivesByNode.get(node.id);
    if (!stack) {
      stack = [];
      activeReceivesByNode.set(node.id, stack);
    }
    stack.push(msg._executionId);
    receiveEvent._executionHistoryPushed = true;
  });

  RED.hooks.add('postReceive.execution-resilience', (receiveEvent) => {
    if (!receiveEvent || !receiveEvent._executionHistoryPushed) return;

    const node = receiveEvent.destination && receiveEvent.destination.node;
    if (!node) return;

    const stack = activeReceivesByNode.get(node.id);
    if (stack && stack.length > 0) {
      stack.pop();
      if (stack.length === 0) activeReceivesByNode.delete(node.id);
    }
  });

  // Records exactly one output entry: msg's own execution, at nodeId/node.
  // Shared by every path below (the common single-completion case, the
  // Join-batch case, and the no-sends-at-all multi-completion case).
  async function recordOneCompletion(nodeId, node, msg, executionId) {
    if (pendingBegins.has(executionId)) {
      await pendingBegins.get(executionId);
    }

    let manager;
    try {
      manager = await getManager(RED, 'default');
    } catch (err) {
      return; // already warned once via the onSend hook above
    }

    // Two node types are a genuine terminal point of a flow, so their
    // completion message IS the execution's actual result - flag it as such
    // and flip the whole execution to COMPLETED: an "http response" node
    // (the natural outcome of an HTTP-triggered flow), and the dedicated
    // "execution-complete" node (a plain marker node for flows - most
    // non-HTTP automations - that have no http response node to hook into
    // at all; see the ExecutionCompleteNode class below).
    const marksCompletion = node.type === 'http response' || node.type === 'execution-complete';

    // A 'replay-point' node's completion is flagged so a later replay knows
    // it's a developer-sanctioned place to resume from - see the
    // ReplayPointNode class and the /replay endpoint below. Deliberately
    // separate from marksCompletion: a replay point doesn't end the
    // execution, it just marks a safe checkpoint somewhere inside it.
    const isReplayPoint = node.type === 'replay-point';

    // Same idea, for the automatic-retry node - see AutoReplayPointNode
    // below. This is a durable, dashboard-visible record of the checkpoint;
    // the in-memory autoReplayTracking map (see onSend above) is the fast,
    // synchronous signal recordFailure actually decides from.
    const isAutoReplayPoint = node.type === 'auto-replay-point';

    try {
      await manager.recordNodeExit(executionId, nodeId, getDisplayName(RED, node), msg, { isResult: marksCompletion, isReplayPoint, isAutoReplayPoint });
    } catch (err) {
      RED.log.error(`[execution-resilience] Failed to record node completion: ${err.message}`);
    }

    if (marksCompletion) {
      try {
        await manager.completeExecution(executionId, nodeId);
      } catch (err) {
        RED.log.error(`[execution-resilience] Failed to mark execution completed: ${err.message}`);
      }
      // This execution reached a genuine successful end - nothing left to
      // ever retry, so drop its tracking entry rather than leaking it.
      autoReplayTracking.delete(executionId);
    }
  }

  // A node calling done(err) - the same mechanism behind Node-RED's own
  // "Catch" node - fails the WHOLE execution, not just this one node's
  // completion, so it's handled entirely separately from the buffering/burst
  // logic above (which exists to reconcile a node's own send()s against its
  // done() calls - moot once the execution is dead anyway). Recorded as an
  // 'output' message like any other node completion, flagged isError so the
  // dashboard can point at exactly where it went wrong, then the execution
  // itself flips to FAILED.
  //
  // Known blind spot, not something this hook can close: a node that throws
  // SYNCHRONOUSLY inside its input handler - or simply never calls done() at
  // all - never reaches this hook. Node-RED's runtime catches synchronous
  // throws before _complete()/onComplete ever fires, routing them straight
  // to the node's own error log instead; a node that hangs never calls
  // _complete() either. Those executions stay RUNNING forever, same as
  // before this was added.
  async function recordFailure(nodeId, node, msg, executionId, error) {
    if (pendingBegins.has(executionId)) {
      await pendingBegins.get(executionId);
    }

    let manager;
    try {
      manager = await getManager(RED, 'default');
    } catch (err) {
      return; // already warned once via the onSend hook above
    }

    try {
      await manager.recordNodeExit(executionId, nodeId, getDisplayName(RED, node), msg, { isError: true });
    } catch (err) {
      RED.log.error(`[execution-resilience] Failed to record node failure: ${err.message}`);
    }

    // Must read BEFORE failExecution - that call deletes this execution's
    // entry from the manager's in-memory executionMap once it's done.
    const priorAttempt = manager.getAutoReplayAttempt(executionId);

    try {
      await manager.failExecution(executionId, nodeId, error);
    } catch (err) {
      RED.log.error(`[execution-resilience] Failed to mark execution failed: ${err.message}`);
    }

    // Automatic retry: only if this execution actually passed through an
    // 'auto-replay-point' node (see autoReplayTracking above) - the failure
    // itself is still recorded exactly as before regardless.
    const tracked = autoReplayTracking.get(executionId);
    autoReplayTracking.delete(executionId);
    if (tracked) {
      try {
        await maybeScheduleRetry(manager, executionId, tracked, priorAttempt);
      } catch (err) {
        RED.log.error(`[execution-resilience] Failed to schedule automatic retry for execution ${executionId}: ${err.message}`);
      }
    }
  }

  // nodeId -> completeEvents buffered during the CURRENT synchronous burst
  // (see the queueMicrotask below), so a buffering node's batched done()
  // calls can be told apart from the normal one-completion-at-a-time case
  // before deciding what to record for either.
  const pendingCompletionsByNode = new Map();

  async function flushNodeCompletions(nodeId, node) {
    const buffer = pendingCompletionsByNode.get(nodeId);
    pendingCompletionsByNode.delete(nodeId);
    if (!buffer || buffer.length === 0) return;

    // Group by execution - a burst could in theory interleave completions
    // from more than one concurrently in-flight execution on the same node.
    const byExecution = new Map();
    for (const entry of buffer) {
      if (!byExecution.has(entry.executionId)) byExecution.set(entry.executionId, []);
      byExecution.get(entry.executionId).push(entry.msg);
    }

    for (const [executionId, rawMsgs] of byExecution) {
      // Drain whatever this node actually sent for this execution during
      // the same window, regardless of which branch below ends up using it -
      // leftover entries would otherwise sit in sentQueueByNode forever for
      // any node shaped like "one done(), several send()s" (e.g. a manual
      // split with no matching Join), since such a node's own completion
      // never revisits this execution again to claim them.
      const sendQueue = sentQueueByNode.get(nodeId);
      const claimed = [];
      if (sendQueue) {
        for (let i = sendQueue.length - 1; i >= 0; i--) {
          if (sendQueue[i]._executionId === executionId) {
            claimed.push(sendQueue.splice(i, 1)[0]);
          }
        }
        if (sendQueue.length === 0) sentQueueByNode.delete(nodeId);
      }

      if (rawMsgs.length === 1) {
        // The overwhelmingly common case (exactly one done() call for this
        // node+execution in this window) - always record the message this
        // completion actually carries, exactly as before this fix. This
        // covers plain pass-through nodes AND a manual/hand-rolled split (one
        // received message, several send()s, one done()): the drained
        // `claimed` sends above are deliberately NOT used here - none of
        // them is individually more "this node's output" than the others,
        // and each is already correctly recorded via whatever downstream
        // node(s) actually receive them.
        await recordOneCompletion(nodeId, node, rawMsgs[0], executionId);
      } else if (claimed.length > 0) {
        // Several done() calls fired together for DIFFERENT original
        // messages, but this node only genuinely sent `claimed.length` of
        // them onward as combined result(s) - the built-in Join node is the
        // standard example: N received parts each queue their own `done`
        // without calling it, then the group completes with ONE send()
        // followed by ALL of those queued done()s firing in a batch
        // (@node-red/nodes/core/sequence/17-split.js's
        // `group.send(...); group.dones.forEach(f => f())`). Record what was
        // actually sent (the joined result), not any individual pre-join
        // part - and only that many times, discarding the rest of this
        // burst's raw messages as redundant.
        for (const sentMsg of claimed) {
          await recordOneCompletion(nodeId, node, sentMsg, executionId);
        }
      } else {
        // Multiple completions, but nothing sent at all for any of them -
        // no aggregation to reflect, so record each standalone completion.
        for (const rawMsg of rawMsgs) {
          await recordOneCompletion(nodeId, node, rawMsg, executionId);
        }
      }
    }
  }

  // -------------------------------------------------------------------
  // Global instrumentation: record an 'output' message for every node in a
  // tracked flow after the origin (whose one entry - 'input' - was already
  // recorded by beginExecution above), with no node placement required.
  // onComplete fires whenever a node finishes processing a message (calls
  // its done() callback) - this is the same
  // runtime mechanism behind Node-RED's own built-in "Complete" node, so it
  // shares its one real caveat: nodes using the legacy single-argument
  // on('input', function(msg) {...}) style never call done(), so their
  // completion won't be recorded here. Modern core nodes (function, switch,
  // change, http request, ...) do call it.
  //
  // Deliberately NOT async, and deliberately doesn't record anything
  // itself for the success path - it only buffers (see
  // pendingCompletionsByNode above) so flushNodeCompletions can tell a
  // buffering node's batched done() calls (fired synchronously back-to-back,
  // no other node's activity between them) apart from independent, unrelated
  // completions, before deciding what to record for either. queueMicrotask
  // runs once the current synchronous call stack fully unwinds - i.e. after
  // every onComplete call belonging to the same burst has already been
  // pushed into the buffer. A done(err) completion is a different beast
  // entirely - see recordFailure above - so it's diverted there immediately
  // instead of ever entering this buffer.
  // -------------------------------------------------------------------
  RED.hooks.add('onComplete.execution-resilience', (completeEvent) => {
    const msg = completeEvent && completeEvent.msg;
    if (!msg || !msg._executionId) return;

    const node = completeEvent.node && completeEvent.node.node;
    const nodeId = completeEvent.node && completeEvent.node.id;
    if (!nodeId || !node) return;

    if (completeEvent.error) {
      recordFailure(nodeId, node, msg, msg._executionId, completeEvent.error);
      return;
    }

    let buffer = pendingCompletionsByNode.get(nodeId);
    if (!buffer) {
      buffer = [];
      pendingCompletionsByNode.set(nodeId, buffer);
      queueMicrotask(() => flushNodeCompletions(nodeId, node));
    }
    buffer.push({ msg, executionId: msg._executionId });
  });

  // Dispatches a checkpoint/debug/auto resume: creates the new tracked
  // execution via manager.beginResume, then feeds a fresh clone of each
  // chosen message into the target node itself via node.receive() - see
  // beginResume's own comment for why that (not the node's recorded
  // downstream destinations) is what makes a checkpoint chainable and
  // resilient to the flow having changed since.
  //
  // Shared by the POST /replay endpoint's checkpoint/debug branches AND the
  // automatic-retry path below (fireScheduledRetry) - returns a plain
  // result object rather than throwing, since the two callers need to
  // react very differently to e.g. a target node that's disappeared since:
  // an HTTP 422 for a human, versus giving up and logging for an unattended
  // retry with nobody to show an error to.
  async function dispatchResume(manager, mode, execution, chosenMessages, attempt) {
    const targetNodeId = chosenMessages[0].nodeId;
    const targetNodeName = chosenMessages[0].nodeName;
    const targetNode = RED.nodes.getNode(targetNodeId);
    if (!targetNode) {
      return {
        ok: false,
        error: 'FLOW_CHANGED',
        message: 'The node this execution was recorded against no longer exists in the current flow (deleted or redeployed since).'
      };
    }

    const hasOutgoingWires = Array.isArray(targetNode.wires) && targetNode.wires.some(w => Array.isArray(w) && w.length > 0);
    if (!hasOutgoingWires) {
      return {
        ok: false,
        error: 'NO_DOWNSTREAM',
        message: 'That node has no outgoing connection in the current flow, so there is nothing downstream to resume into.'
      };
    }

    const newExecutionId = generateExecutionId();
    await manager.beginResume(
      mode,
      newExecutionId,
      execution.flowId,
      execution.flowName,
      chosenMessages.map(m => m.payload),
      targetNodeId,
      targetNodeName,
      chosenMessages.map(m => String(m._id)),
      execution.executionId,
      attempt,
      execution.rootExecutionId || execution.executionId,
      chosenMessages[0].isAutoReplayPoint === true
    );

    // Dispatched in the same order they were originally recorded, so a
    // downstream Join sees parts in the same relative order they occurred
    // in originally - each part is its own clone, exactly like Node-RED's
    // own send() gives each wire its own copy.
    chosenMessages.forEach(m => {
      const seed = safeClone(m.payload);
      seed._executionId = newExecutionId;
      seed._flowName = execution.flowName;
      targetNode.receive(seed);
    });

    return {
      ok: true,
      executionId: newExecutionId,
      replayedFrom: {
        mode,
        nodeId: targetNodeId,
        nodeName: targetNodeName,
        messageIds: chosenMessages.map(m => String(m._id)),
        partCount: chosenMessages.length
      }
    };
  }

  // Strategy options for an 'auto-replay-point' node: 'immediate' (no
  // wait), 'fixed' (always node.delayMs), or 'exponential' (node.delayMs *
  // 2^(attempt-1), capped at node.maxDelayMs). Jitter (full jitter - a
  // random value in [0, delay]) is applied whenever the node has it
  // enabled, which the editor forces on for 'exponential' - see
  // execution-resilience.html - since that's the strategy most likely to be
  // used by many concurrently-failing executions at once, where
  // synchronized retries would otherwise hammer whatever's already down.
  function computeRetryDelay(node, attempt) {
    let delay;
    if (node.strategy === 'immediate') {
      delay = 0;
    } else if (node.strategy === 'fixed') {
      delay = node.delayMs;
    } else {
      delay = Math.min(node.delayMs * Math.pow(2, attempt - 1), node.maxDelayMs);
    }

    if (node.jitter && delay > 0) {
      delay = Math.random() * delay;
    }

    return Math.round(delay);
  }

  // Arms the actual setTimeout for a scheduled retry, tracked in
  // pendingRetryTimers so the owning node's close() can cancel it if the
  // flow is redeployed before it fires.
  function armRetryTimer(executionId, nodeId, delayMs) {
    const timer = setTimeout(() => {
      pendingRetryTimers.delete(executionId);
      fireScheduledRetry(executionId).catch(err => {
        RED.log.error(`[execution-resilience] Automatic retry for execution ${executionId} failed: ${err.message}`);
      });
    }, delayMs);

    // A bare setTimeout would otherwise keep the Node.js process alive on
    // its own - harmless in a long-running Node-RED server, but `unref()`
    // avoids ever being the reason a graceful shutdown hangs.
    if (typeof timer.unref === 'function') timer.unref();

    pendingRetryTimers.set(executionId, { timer, nodeId });
  }

  // Either path that can trigger a retry - the live in-memory timer above,
  // or the startup reconciliation scan below - funnels through here.
  // claimScheduledRetry is atomic (only one caller can successfully clear
  // scheduledRetry), which is what makes racing the two safe: whichever
  // gets here first wins, the other finds nothing left to claim and quietly
  // returns.
  async function fireScheduledRetry(executionId) {
    let manager;
    try {
      manager = await getManager(RED, 'default');
    } catch (err) {
      return;
    }

    const claimed = await manager.claimScheduledRetry(executionId);
    if (!claimed) return;

    const execution = await manager.getExecutionWithMessages(executionId);
    if (!execution) return;

    const idSet = new Set((claimed.messageIds || []).map(String));
    const chosenMessages = execution.messages.filter(m => idSet.has(String(m._id)));
    if (chosenMessages.length === 0) {
      RED.log.warn(`[execution-resilience] Scheduled retry for execution ${executionId} could not find its recorded seed message(s) - skipping.`);
      return;
    }

    const result = await dispatchResume(manager, 'auto', execution, chosenMessages, claimed.attempt);
    if (!result.ok) {
      // Nobody to show an HTTP error to here - log it, and don't leave this
      // silently "awaiting retry" forever with no timer left to fire it.
      RED.log.warn(`[execution-resilience] Automatic retry for execution ${executionId} could not be dispatched (${result.error}): ${result.message}`);
      try {
        await manager.markRetriesExhausted(executionId);
      } catch (err) {
        RED.log.error(`[execution-resilience] Failed to mark execution ${executionId} retries exhausted: ${err.message}`);
      }
    }
  }

  // Called once, right after an execution fails, for any execution that
  // passed through an 'auto-replay-point' node (see autoReplayTracking).
  // Decides whether to schedule another attempt or give up.
  async function maybeScheduleRetry(manager, executionId, tracked, priorAttempt) {
    const node = autoReplayNodeRegistry.get(tracked.nodeId);
    if (!node) {
      RED.log.warn(`[execution-resilience] Auto Replay Point node ${tracked.nodeId} no longer exists - cannot schedule a retry for execution ${executionId}.`);
      return;
    }

    const attempt = priorAttempt + 1;
    if (attempt > node.maxAttempts) {
      await handleExhausted(manager, executionId, tracked, node);
      return;
    }

    // The actual seed message(s) are fetched from Mongo (not kept in the
    // lightweight autoReplayTracking entry) - they were already durably
    // recorded when this execution originally passed the checkpoint, and
    // reading them back here is what lets a startup reconciliation rebuild
    // the exact same retry later, without this package having to also keep
    // full message payloads resident in memory for the entire lifetime of
    // every in-flight execution.
    const execution = await manager.getExecutionWithMessages(executionId);
    if (!execution) return;

    const seedMessages = execution.messages.filter(m => m.isAutoReplayPoint && m.nodeId === tracked.nodeId);
    if (seedMessages.length === 0) {
      RED.log.warn(`[execution-resilience] No recorded Auto Replay Point messages found for execution ${executionId} - cannot schedule a retry.`);
      return;
    }

    const delayMs = computeRetryDelay(node, attempt);
    const dueAt = new Date(Date.now() + delayMs);
    const messageIds = seedMessages.map(m => String(m._id));

    await manager.markAwaitingRetry(executionId, dueAt, attempt, tracked.nodeId, messageIds);
    armRetryTimer(executionId, tracked.nodeId, delayMs);
  }

  // Runs once the retry budget is exhausted - out-of-band, via the node
  // registry, since there's no live 'input' event to send()/error() from at
  // this point (the trigger is a downstream failure, possibly discovered
  // via a timer with no call stack connecting back to this node at all).
  // The failed execution itself is already recorded FAILED regardless of
  // node.onExhausted - this only controls what happens IN ADDITION to that.
  async function handleExhausted(manager, executionId, tracked, node) {
    try {
      await manager.markRetriesExhausted(executionId);
    } catch (err) {
      RED.log.error(`[execution-resilience] Failed to mark execution ${executionId} retries exhausted: ${err.message}`);
      return;
    }

    const execution = await manager.getExecutionWithMessages(executionId);
    if (!execution) return;

    // The failed message itself (what was actually being processed at the
    // moment of the final failure) is more useful downstream than the
    // checkpoint's own original seed - falls back to the seed only if for
    // some reason no isError message was recorded.
    const errorMessage = execution.messages.find(m => m.isError);
    const basePayload = errorMessage ? errorMessage.payload : execution.initialMessage;

    // Default: raise it through Node-RED's own error/Catch mechanism
    // instead of a second output. Deliberately creates no new execution -
    // a second output nobody wired up would otherwise leave a brand-new
    // tracked execution stuck RUNNING forever (see the "Execution Status"
    // README table: nothing marks an execution COMPLETED or FAILED except
    // reaching an actual downstream node, and an unwired output never
    // reaches one).
    if (node.onExhausted !== 'output') {
      const lastErrorText = execution.error ? execution.error.message : 'unknown error';
      node.error(
        `Auto Replay Point "${tracked.nodeName}" exhausted after ${node.maxAttempts} attempt(s): ${lastErrorText}`,
        safeClone(basePayload)
      );
      return;
    }

    const newExecutionId = generateExecutionId();
    try {
      await manager.beginAutoExhausted(newExecutionId, execution.flowId, execution.flowName, basePayload, tracked.nodeId, tracked.nodeName, executionId, execution.rootExecutionId || execution.executionId);
    } catch (err) {
      RED.log.error(`[execution-resilience] Failed to record exhausted-retries execution for ${executionId}: ${err.message}`);
      return;
    }

    const exhaustedMsg = safeClone(basePayload);
    exhaustedMsg._executionId = newExecutionId;
    exhaustedMsg._flowName = execution.flowName;
    exhaustedMsg._autoReplayExhausted = {
      attempts: execution.autoReplayAttempt || 0,
      error: execution.error || null,
      originalExecutionId: executionId
    };

    // Second output only - nothing sent on the first (that's for the
    // node's own normal pass-through when a message genuinely arrives at
    // its input).
    node.send([null, exhaustedMsg]);
  }

  // A plain pass-through marker node - all it does is exist at a specific
  // point in a flow. The global onComplete hook above (see
  // recordOneCompletion's `marksCompletion` check) recognizes this node's
  // TYPE specifically and flips the whole execution to COMPLETED when it
  // finishes, exactly like it already does for an "http response" node's
  // completion. Needed because most non-HTTP flows have no http response
  // node at all - i.e. no natural "the flow is done" signal to hook into
  // automatically - so this gives them an explicit one to place wherever
  // the flow actually ends.
  class ExecutionCompleteNode {
    constructor(config) {
      RED.nodes.createNode(this, config);

      this.on('input', (msg, send, done) => {
        send(msg);
        done();
      });
    }
  }

  RED.nodes.registerType('execution-complete', ExecutionCompleteNode);

  // A plain pass-through marker node, structurally identical to
  // ExecutionCompleteNode above - all it does is exist at a specific point
  // in a flow. The global onComplete hook (see the isReplayPoint check
  // above) recognizes this node's TYPE and flags its recorded message as a
  // sanctioned replay checkpoint.
  //
  // Deliberately NOT automatic (e.g. "detect whether a database call
  // happened before this point"): whether it's safe to re-run everything
  // between the true origin and some later point in the flow is a judgment
  // call about side effects (a payment charged, a row inserted, an email
  // sent) that only the flow's own author can make. Requiring this node
  // forces that choice to be explicit and visible in the flow itself,
  // rather than an implicit assumption baked into replay logic.
  class ReplayPointNode {
    constructor(config) {
      RED.nodes.createNode(this, config);

      this.on('input', (msg, send, done) => {
        send(msg);
        done();
      });
    }
  }

  RED.nodes.registerType('replay-point', ReplayPointNode);

  // Same checkpoint job as ReplayPointNode above, but the runtime itself
  // triggers a replay automatically when an execution fails downstream of
  // it - no human clicking a button. A deliberately SEPARATE node type
  // (not a mode on replay-point): dragging this one onto the canvas is
  // its own explicit decision, visually distinct in the palette, so
  // automatic re-execution of a flow's side effects is never something a
  // hidden checkbox silently turned on.
  //
  // Two outputs: the first is the ordinary pass-through (identical to
  // ReplayPointNode, and identical on every automatic retry re-entering
  // through this same node); the second fires exactly once per failure
  // chain, out of band (see handleExhausted above), once maxAttempts is
  // exhausted and the final attempt has also failed.
  //
  // Registers itself into autoReplayNodeRegistry (keyed by node id) so
  // recordFailure's async retry/exhaustion handling - which runs from a
  // hook or a later timer callback, never from this node's own 'input'
  // handler - can find this exact live instance to read its current
  // settings from, or to send() the exhausted-output message through.
  // Always re-read via that registry, never captured in a closure: Node-RED
  // destroys and recreates every node instance on a redeploy, and a
  // scheduled retry's delay window is exactly when one is likely to land.
  class AutoReplayPointNode {
    constructor(config) {
      RED.nodes.createNode(this, config);

      this.maxAttempts = parseInt(config.maxAttempts, 10) || 3;
      this.strategy = ['immediate', 'fixed', 'exponential'].includes(config.strategy) ? config.strategy : 'exponential';
      this.delayMs = parseInt(config.delayMs, 10) || 1000;
      this.maxDelayMs = parseInt(config.maxDelayMs, 10) || 60000;
      // Editor forces this true for 'exponential' (see execution-resilience.html) -
      // re-checked here too since config could in principle arrive from
      // somewhere other than the editor (e.g. a hand-edited flows.json).
      this.jitter = config.jitter !== false || this.strategy === 'exponential';
      // 'error' (default) or 'output' - see handleExhausted. Whatever
      // config.onExhausted is, only 'output' means anything special; any
      // other/missing value (older flows predating this setting included)
      // falls back to the safe default.
      this.onExhausted = config.onExhausted === 'output' ? 'output' : 'error';

      autoReplayNodeRegistry.set(this.id, this);

      this.on('input', (msg, send, done) => {
        send(this.onExhausted === 'output' ? [msg, null] : [msg]);
        done();
      });

      this.on('close', (done) => {
        autoReplayNodeRegistry.delete(this.id);

        // Cancel every retry timer THIS instance owns - otherwise a fired
        // timer could call receive()/send() against a node Node-RED has
        // already torn down (a redeploy recreates every instance, not just
        // changed ones).
        for (const [executionId, entry] of pendingRetryTimers) {
          if (entry.nodeId === this.id) {
            clearTimeout(entry.timer);
            pendingRetryTimers.delete(executionId);
          }
        }

        done();
      });
    }
  }

  RED.nodes.registerType('auto-replay-point', AutoReplayPointNode);

  // Deliberately registered BEFORE the auth gate below, so it's the one
  // /api/executions* route reachable with no credentials even when
  // execHistoryAuth is configured - it discloses only boolean feature
  // flags, nothing sensitive, and its `authConfigured` value is already
  // observable for free from any OTHER route's 401 (or lack of one), so
  // exempting it reveals no new information. This is what lets the editor
  // sidebar tab (see the RED.sidebar.addTab block above) safely check
  // whether it's allowed to fetch live stats before ever doing so - without
  // this exemption, that check would itself trigger the browser's native
  // Basic Auth prompt just from opening the editor.
  RED.httpAdmin.get('/api/executions/config', (req, res) => {
    res.json({
      deepSearchEnabled: RED.settings.get('execHistoryDeepSearch') === true,
      unsafeReplayEnabled: RED.settings.get('execHistoryUnsafeReplay') === true,
      authConfigured: getDashboardAuthConfig(RED) !== null
    });
  });

  // Gates the whole dashboard surface - every OTHER /api/executions* route
  // AND the dashboard's own static files (registered further below) -
  // behind one shared check. Registered before any of those routes so it
  // runs first in Express's middleware stack regardless of HTTP method; see
  // requireDashboardAuth for what happens when execHistoryAuth isn't
  // configured at all.
  const dashboardAuth = requireDashboardAuth(RED);
  RED.httpAdmin.use('/api/executions', dashboardAuth);
  RED.httpAdmin.use('/execution-resilience-dashboard', dashboardAuth);

  RED.httpAdmin.get('/api/executions', async (req, res) => {
    try {
      const database = req.query.database || 'default';
      const manager = await getManager(RED, database);

      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;
      const skip = (page - 1) * limit;

      const filter = {};
      if (req.query.status) filter.status = req.query.status;
      if (req.query.flowId) filter.flowId = req.query.flowId;
      if (req.query.flowName) filter.flowName = req.query.flowName;
      if (req.query.executionId) filter.executionId = req.query.executionId;
      if (req.query.onlyReplays === 'true') filter.onlyReplays = true;

      // Grouped view: one row per replay/retry CHAIN (see
      // listExecutionsGrouped) rather than one row per execution - the
      // dashboard's default, since a chain of automatic retries otherwise
      // floods the list with rows that are really just one logical run.
      const result = req.query.grouped === 'true'
        ? await manager.listExecutionsGrouped(filter, { limit, skip })
        : await manager.listExecutions(filter, { limit, skip });
      res.json(result);
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  // Deep Search is opt-in (execHistoryDeepSearch: true in settings.js) since
  // it regex-scans the messages collection on every query, with no index to
  // fall back on - not something every deployment's message volume should
  // be forced to carry the cost of. Lets the dashboard know upfront whether
  // to show the tab at all, rather than exposing it and failing on first use.
  //
  // Registered BEFORE '/api/executions/:executionId' below - Express
  // matches routes in registration order, and '/api/executions/search'
  // would otherwise satisfy that route's single-segment :executionId
  // pattern (with executionId literally "search") and never reach this
  // handler at all. ('/api/executions/config' is registered separately,
  // further up, before the auth gate - see there for why.)
  RED.httpAdmin.get('/api/executions/search', async (req, res) => {
    if (RED.settings.get('execHistoryDeepSearch') !== true) {
      return res.status(403).json({ error: "Deep search is disabled. Set execHistoryDeepSearch: true in settings.js to enable it." });
    }

    const q = (req.query.q || '').trim();
    if (!q) return res.json({ executions: [], total: 0 });

    try {
      const database = req.query.database || 'default';
      const manager = await getManager(RED, database);

      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;
      const skip = (page - 1) * limit;

      const filter = {};
      if (req.query.status) filter.status = req.query.status;
      if (req.query.flowName) filter.flowName = req.query.flowName;
      if (req.query.createdAfter) filter.createdAfter = req.query.createdAfter;
      if (req.query.createdBefore) filter.createdBefore = req.query.createdBefore;

      const matchPosition = req.query.matchPosition === 'last' ? 'last' : 'first';

      const result = await manager.searchExecutions(q, filter, { limit, skip, matchPosition });
      res.json(result);
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  // Backs the dashboard's per-row "inspect individual executions" expand
  // control - an alternative to the grouped-view toggle for drilling into
  // just ONE replay/retry chain's actual member executions, oldest first,
  // without ungrouping the rest of the list. Two path segments after
  // '/api/executions/', so it can't collide with the single-segment
  // '/api/executions/:executionId' route below regardless of registration
  // order - unlike '/config'/'/search' above.
  RED.httpAdmin.get('/api/executions/chain/:rootExecutionId', async (req, res) => {
    try {
      const database = req.query.database || 'default';
      const manager = await getManager(RED, database);

      const executions = await manager.getExecutionChain(req.params.rootExecutionId);
      res.json({ executions });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  RED.httpAdmin.get('/api/executions/:executionId', async (req, res) => {
    try {
      const database = req.query.database || 'default';
      const manager = await getManager(RED, database);

      const execution = await manager.getExecutionWithMessages(req.params.executionId);
      if (!execution) {
        return res.status(404).json({ error: 'Execution not found' });
      }
      res.json(execution);
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  // Resumes a past execution as a brand-new tracked execution, in one of
  // three modes (?mode=):
  //
  // - 'restart' (the default a flow always has, with no node placement
  //   required): re-seeds the flow's TRUE origin's own recorded
  //   initialMessage - found via getRootExecution, which walks back through
  //   any number of prior replay/debug resumes - so a flow is always fully
  //   repeatable from the very beginning. Dispatched into whatever the
  //   origin node is CURRENTLY wired to, not a historical snapshot.
  // - 'checkpoint': resumes from a message recorded at a developer-placed
  //   Mark Replay Point node - an OPTIONAL, better-than-restart alternative
  //   for when a full restart would repeat a side effect (a database write,
  //   a payment charge) that already happened. `messageId` picks a single
  //   recorded checkpoint, when the flow has more than one; defaults to the
  //   last one recorded (closest to wherever the execution went on to fail).
  //   `nodeId` instead replays EVERY message this execution recorded at
  //   that node together; `messageIds` (comma-separated) replays any
  //   specific subset of them. Both matter when the checkpoint sits
  //   downstream of a Split, since it then ran once per part - resuming
  //   from fewer than all of them may leave a downstream Join waiting
  //   forever for the rest, but which parts are actually needed is the
  //   caller's call, not something this endpoint second-guesses.
  // - 'debug': like 'checkpoint' (including `nodeId`/`messageIds`), but
  //   resumes from ANY node the execution passed through, not just ones
  //   flagged as a sanctioned checkpoint. Deliberately gated behind
  //   execHistoryUnsafeReplay in settings.js,
  //   since it bypasses the whole point of the Mark Replay Point node - the
  //   developer's own reasoning about where a retry is actually safe.
  //
  // 'checkpoint' and 'debug' both dispatch into the chosen node ITSELF (not
  // its recorded downstream destinations) via node.receive() - deliberately,
  // for two reasons. First, it means the new execution's fan-out always
  // follows the flow's CURRENT wiring rather than a historical snapshot
  // that may no longer be accurate. Second, and more importantly: since the
  // new execution's originNodeId (set in beginResume) is this same node,
  // the normal onComplete/recordNodeExit origin-skip means its own
  // completion is never re-recorded as a second message - it behaves
  // exactly like a real inject/http-in origin. For 'checkpoint' mode, that
  // in turn means the Mark Replay Point node genuinely "runs" as part of
  // the new execution, so if that execution later fails too, it can be
  // resumed again from the very same checkpoint - see beginResume's
  // isReplayPoint flag on the seed message it records.
  RED.httpAdmin.post('/api/executions/:executionId/replay', async (req, res) => {
    try {
      const database = req.query.database || 'default';
      const manager = await getManager(RED, database);

      const execution = await manager.getExecutionWithMessages(req.params.executionId);
      if (!execution) {
        return res.status(404).json({ error: 'Execution not found' });
      }

      // A human explicitly acting on this execution supersedes any
      // automatic retry still awaiting its turn - cancel it (both the
      // live in-process timer, if this is the same process, and the
      // durable record) rather than risk both firing.
      if (execution.scheduledRetry) {
        const pending = pendingRetryTimers.get(execution.executionId);
        if (pending) {
          clearTimeout(pending.timer);
          pendingRetryTimers.delete(execution.executionId);
        }
        await manager.clearScheduledRetry(execution.executionId);
      }

      const mode = req.query.mode === 'debug' ? 'debug' : (req.query.mode === 'checkpoint' ? 'checkpoint' : 'restart');

      if (mode === 'restart') {
        const root = await manager.getRootExecution(execution.executionId);
        const originNode = RED.nodes.getNode(root.originNodeId);
        if (!originNode) {
          return res.status(422).json({
            error: 'FLOW_CHANGED',
            message: 'The flow\'s origin node no longer exists in the current flow (deleted or redeployed since).'
          });
        }

        const destinationIds = new Set();
        (originNode.wires || []).forEach(port => (port || []).forEach(id => destinationIds.add(id)));
        if (destinationIds.size === 0) {
          return res.status(422).json({
            error: 'NO_DOWNSTREAM',
            message: 'The flow\'s origin node has no outgoing connection in the current flow, so there is nothing downstream to restart into.'
          });
        }

        const newExecutionId = generateExecutionId();
        await manager.beginRestart(newExecutionId, root.flowId, root.flowName, root.initialMessage, root.originNodeId, execution.executionId, root.rootExecutionId || root.executionId);

        destinationIds.forEach(id => {
          const node = RED.nodes.getNode(id);
          if (!node) return;
          const seed = safeClone(root.initialMessage);
          seed._executionId = newExecutionId;
          seed._flowName = root.flowName;
          node.receive(seed);
        });

        return res.json({ executionId: newExecutionId, replayedFrom: { mode: 'restart' } });
      }

      if (mode === 'debug' && RED.settings.get('execHistoryUnsafeReplay') !== true) {
        return res.status(403).json({
          error: 'UNSAFE_REPLAY_DISABLED',
          message: 'Debug/unsafe replay is disabled. Set execHistoryUnsafeReplay: true in settings.js to allow resuming from any node.'
        });
      }

      // A Mark Auto Replay Point node is exactly as safe a manual reset
      // location as a Mark Replay Point one - if it's safe enough to retry
      // itself automatically and repeatedly, it's safe enough for a human
      // to manually resume from too. No reason to require a separate,
      // redundant Mark Replay Point right next to one just to unlock manual
      // replay.
      const candidates = mode === 'debug' ? execution.messages : execution.messages.filter(m => m.isReplayPoint || m.isAutoReplayPoint);
      if (candidates.length === 0) {
        return res.status(422).json({
          error: 'NO_REPLAY_POINT',
          message: 'This execution has no "Mark Replay Point" or "Mark Auto Replay Point" node recorded in its history. Use "Restart from Origin" instead, or add one of those node types to the flow at whatever point you consider safe to resume from - typically right after any step you would not want repeated, such as a database write.'
        });
      }

      // Three ways to pick which recorded message(s) to resume from, most
      // to least specific: an explicit arbitrary subset (?messageIds=, a
      // comma-separated list of any 1..N of them - e.g. 2 of a Split's 4
      // parts), every message this execution recorded at one node
      // (?nodeId=, the "replay all parts" convenience), or a single
      // message (?messageId=, default when none of these are given: the
      // last eligible one recorded). A node downstream of a Split (and
      // everything until its matching Join) runs once per part, so it can
      // have several recorded messages here - resuming from fewer than
      // all of them still works (each dispatched independently - see
      // beginResume), it's just the caller's call whether a downstream
      // Join will actually see enough parts to complete.
      const requestedMessageIds = req.query.messageIds
        ? req.query.messageIds.split(',').map(s => s.trim()).filter(Boolean)
        : null;
      const requestedNodeId = req.query.nodeId;
      const requestedMessageId = req.query.messageId;

      let chosenMessages;
      if (requestedMessageIds && requestedMessageIds.length > 0) {
        const idSet = new Set(requestedMessageIds.map(String));
        chosenMessages = candidates.filter(m => idSet.has(String(m._id)));
        if (chosenMessages.length === 0) {
          return res.status(400).json({ error: 'INVALID_REPLAY_POINT', message: 'None of the requested messages were found on this execution.' });
        }
      } else if (requestedNodeId) {
        chosenMessages = candidates.filter(m => m.nodeId === requestedNodeId);
        if (chosenMessages.length === 0) {
          return res.status(400).json({ error: 'INVALID_REPLAY_POINT', message: 'No matching messages were found for that node on this execution.' });
        }
      } else {
        const chosen = requestedMessageId
          ? candidates.find(m => String(m._id) === String(requestedMessageId))
          : candidates[candidates.length - 1];

        if (!chosen) {
          return res.status(400).json({ error: 'INVALID_REPLAY_POINT', message: 'The requested message was not found on this execution.' });
        }
        chosenMessages = [chosen];
      }

      // Resuming into an actual Mark Auto Replay Point node raises a
      // question no other kind of manual replay has to: should this
      // resumed execution get a full fresh automatic-retry budget (the
      // default, and the ONLY behavior every other replay/restart/debug
      // resume has ever had), or continue the count this checkpoint's
      // execution already had? `?resetAutoReplayCount=false` opts into the
      // latter - the resumed execution inherits `execution`'s own
      // autoReplayAttempt verbatim, so if it fails again immediately, it
      // can go straight back to exhausted with no further automatic
      // retries, rather than silently granting a brand-new budget just
      // because a human happened to intervene. Meaningless (and ignored)
      // for anything other than an isAutoReplayPoint checkpoint - a regular
      // Mark Replay Point resume was never part of an automatic-retry
      // budget in the first place.
      const keepAutoReplayCount = req.query.resetAutoReplayCount === 'false' && chosenMessages[0].isAutoReplayPoint;
      const attempt = keepAutoReplayCount ? (execution.autoReplayAttempt || 0) : 0;

      const result = await dispatchResume(manager, mode, execution, chosenMessages, attempt);
      if (!result.ok) {
        return res.status(422).json({ error: result.error, message: result.message });
      }

      res.json({ executionId: result.executionId, replayedFrom: result.replayedFrom });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  RED.httpAdmin.get('/api/executions/stats/:database', async (req, res) => {
    try {
      const manager = await getManager(RED, req.params.database);
      res.json(await manager.getStatistics());
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  // Every distinct flow name that has at least one recorded execution -
  // powers the dashboard's "filter by flow" dropdown.
  RED.httpAdmin.get('/api/executions/flows/:database', async (req, res) => {
    try {
      const manager = await getManager(RED, req.params.database);
      res.json(await manager.getDistinctFlows());
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  // scope: '30d' | '7d' | 'today' | 'all'
  RED.httpAdmin.delete('/api/executions', async (req, res) => {
    const cutoffDate = scopeToCutoffDate(req.query.scope);
    if (cutoffDate === undefined) {
      return res.status(400).json({ error: `Invalid scope '${req.query.scope}'. Expected one of: 30d, 7d, today, all.` });
    }

    try {
      const database = req.query.database || 'default';
      const manager = await getManager(RED, database);
      const deletedCount = await manager.clearExecutions(cutoffDate);
      res.json({ deletedCount });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------
  // Dashboard UI
  // Serves ui/dashboard.html (+ its .css/.js) under /execution-resilience-dashboard
  // Implemented without a dependency on 'express' being resolvable from
  // this node's install location (which may live outside Node-RED's own
  // node_modules tree, e.g. when mounted from a separate packages/ repo).
  // ---------------------------------------------------------------------
  const uiDir = path.join(__dirname, 'ui');
  const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8'
  };

  RED.httpAdmin.get(/^\/execution-resilience-dashboard(\/.*)?$/, (req, res) => {
    const subPath = req.params[0] || '/dashboard.html';
    const requestedPath = subPath === '/' ? '/dashboard.html' : subPath;

    const resolved = path.normalize(path.join(uiDir, requestedPath));
    if (!resolved.startsWith(uiDir)) {
      return res.status(403).end('Forbidden');
    }

    fs.readFile(resolved, (err, data) => {
      if (err) {
        return res.status(404).end('Not found');
      }
      const ext = path.extname(resolved);
      res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
      res.end(data);
    });
  });

  // Startup reconciliation: an in-memory retry timer (armRetryTimer above)
  // never survives a Node-RED restart, so anything left with a pending
  // scheduledRetry from before THIS process started needs to be found and
  // either fired immediately (if already overdue) or re-armed with a fresh
  // setTimeout for its remaining time - otherwise it's simply lost, with
  // the execution stuck at FAILED forever with no retry ever coming.
  // Deliberately fire-and-forget: this must never delay or block Node-RED's
  // own startup, and a missing/misconfigured default database here is not
  // an error worth surfacing beyond the warning the onSend hook already
  // gives on first actual use.
  (async () => {
    let manager;
    try {
      manager = await getManager(RED, 'default');
    } catch (err) {
      return;
    }

    let pending;
    try {
      pending = await manager.getPendingAutoRetries();
    } catch (err) {
      RED.log.error(`[execution-resilience] Failed to scan for pending automatic retries on startup: ${err.message}`);
      return;
    }

    pending.forEach((execution, index) => {
      const remaining = new Date(execution.scheduledRetry.dueAt).getTime() - Date.now();
      // Anything already overdue is staggered slightly (rather than all
      // firing in the same instant) - a restart happening to land during a
      // widespread outage could otherwise turn many simultaneously-overdue
      // retries into a startup thundering herd of its own.
      const delay = Math.max(remaining, 0) + (remaining <= 0 ? index * 250 : 0);

      const timer = setTimeout(() => {
        pendingRetryTimers.delete(execution.executionId);
        fireScheduledRetry(execution.executionId).catch(err => {
          RED.log.error(`[execution-resilience] Reconciled automatic retry for execution ${execution.executionId} failed: ${err.message}`);
        });
      }, delay);
      if (typeof timer.unref === 'function') timer.unref();

      pendingRetryTimers.set(execution.executionId, { timer, nodeId: execution.scheduledRetry.nodeId });
    });
  })();
};
