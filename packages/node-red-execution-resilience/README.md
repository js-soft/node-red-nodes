# Execution Resilience Node for Node-RED

A comprehensive workflow execution tracking and visualization node for Node-RED. Captures execution flow, messages, errors, and timing information with persistent storage for debugging and audit purposes.

## Features

- **Automatic Tracking**: Monitors workflow executions with minimal configuration
- **Status Monitoring**: Tracks execution status (RUNNING, COMPLETED, FAILED)
- **Message Recording**: One `input` entry for the origin node, one `output` entry per node after that
- **Branch Visualization**: Branching flows render as a collapsible tree ("Output 1", "Output 2", ...) instead of an interleaved flat list, auto-expanded down to the result
- **Split/Join Support**: Nodes that ran multiple times (a Split node and everything until its matching Join) show one box flagged `split`, with arrows to step through each part
- **Error Tracking**: Records detailed error information on failures
- **Web Dashboard**: Visual inspection of execution history, with collapsible/expandable JSON trees for message payloads (via the vendored [renderjson](https://github.com/caldwell/renderjson) library) rather than truncated text; search by execution ID; filter by flow name via a type-ahead combobox (suggestions list every flow that has run) or click a status count to filter by it; one-click copy of the execution ID, right from the overview table
- **Deep Search** (opt-in): full-text search across every recorded message's actual *content*, not just execution metadata - see "Deep Search" below
- **Replay**: resume a `FAILED` (or any) execution as a brand-new tracked run - always available as a full restart from the flow's true origin, plus an optional, better alternative from a developer-placed **Mark Replay Point** checkpoint when a full restart would repeat a side effect - see "Replay" below
- **Wide, Two-Column Detail View**: Metadata/error on the left, the full message tree on the right, each scrolling independently so a long message tree never pushes the metadata out of view
- **Configurable Storage**: MongoDB persistence with pluggable adapter pattern
- **Manual Cleanup**: Delete executions older than 30/7 days, older than today, or all of them, from the dashboard
- **Unique IDs**: Each execution receives a unique identifier for tracing

## Installation

```bash
npm install node-red-execution-resilience
```

Or add to your Node-RED custom nodes package.json:

```json
"node-red-execution-resilience": "^0.1.0"
```

## Configuration

### 1. Settings Setup

Add MongoDB connection configuration to `settings.js`:

```javascript
execHistoryDB_default: {
  uri: 'mongodb://localhost:27017',
  database: 'execution_history',
  executionsCollection: 'executions',
  messagesCollection: 'execution_messages'
}
```

Optionally, enable the **Deep Search** tab (disabled by default - see "Deep Search" below for why):

```javascript
execHistoryDeepSearch: true
```

Optionally, enable unsafe debug replay - resuming from any node, not just a
`Mark Replay Point` checkpoint (disabled by default - see "Replay" below):

```javascript
execHistoryUnsafeReplay: true
```

**Strongly recommended**: password-protect the dashboard - it exposes recorded
message payloads, a more sensitive surface than the editor itself, and is
**not protected by Node-RED's own `adminAuth`** even if you have that
configured (see "Securing the Dashboard" below):

```javascript
execHistoryAuth: {
  username: 'admin',
  password: '$2b$08$...' // a bcrypt hash - see "Securing the Dashboard" below
}
```

### 2. Node Placement (both optional)

Once `execHistoryDB_default` is configured in settings, every `inject` and
`http in` node is tracked automatically - **no node needs to be placed in
any flow**, and every execution can already be replayed with a full restart
from its origin. This package ships three nodes, all opt-in, each solving a
different gap that automatic tracking can't fill on its own:

- **Mark Execution Complete** - only needed if your flow has no
  `http response` node (most non-HTTP automations) and you want it to reach
  `COMPLETED` instead of staying `RUNNING` forever.
- **Mark Replay Point** - only needed if a full restart from origin isn't
  good enough for a given flow, e.g. because it would repeat a database
  write or a payment charge. See "Replay" below for why this is an
  additional, deliberate per-flow opt-in rather than something automatic.
- **Mark Auto Replay Point** - the same checkpoint idea as Mark Replay
  Point, but the resume triggers itself automatically on failure instead of
  waiting for a person to click Replay. See "Automatic Replay" below.

1. Add either node wherever it's needed in the flow
2. Optionally give it a **Name**
3. Open the dashboard from the "Execution Resilience" sidebar tab (or its
   "Open Dashboard" button) to view executions

Cleaning up old executions (retention) is manual only for now - use the
dashboard's Delete dropdown (30d/7d/today/all).

### The "Execution Resilience" sidebar tab

The editor's own sidebar tab (`Ctrl`/`Cmd`+`Shift`+ the history icon, or the
tab strip on the right) isn't just a link to the dashboard - it shows a
live, compact **system health overview** so a glance at the editor is
enough to notice trouble without leaving it: a colored headline (green
"All healthy" or red "N exhausted retries, M failed"), a stat grid (Total,
Running, Completed, Failed, Replays, Exhausted), and the 5 most recent
executions with their status. Clicking a recent execution opens the full
dashboard already scoped to it (`?executionId=...`), search box pre-filled
and its detail view open, rather than the plain unfiltered list. Refreshes
every 10 seconds. If `execHistoryAuth` is configured (see "Securing the
Dashboard" below), the sidebar shows a "Protected - open the dashboard to
sign in" note instead of live data - it deliberately never attempts an
authenticated fetch itself, since that would trigger the browser's native
Basic Auth prompt just from opening the editor.

## Securing the Dashboard

The dashboard (and its `/api/executions*` endpoints) show recorded message
**payloads** - potentially PII, secrets, or other sensitive business data -
not just flow structure. That's a meaningfully more sensitive surface than
the Node-RED editor itself, and it is served on its own, **separate from
Node-RED's own `adminAuth`** - configuring `adminAuth` for the editor does
**not** also protect this dashboard. Left unconfigured, anyone who can reach
the Node-RED HTTP port can browse full execution history with no login at
all - the dashboard shows a prominent orange warning banner at the top of
every page whenever this is the case, precisely so this never happens
silently.

Set `execHistoryAuth` in `settings.js` to require HTTP Basic Auth (the
browser's native login prompt, no separate session/cookie mechanism to
manage) for the whole dashboard surface:

```javascript
execHistoryAuth: {
  username: 'admin',
  password: '$2b$08$...' // a bcrypt hash of the actual password - never plaintext
}
```

Generate the hash the same way you would for Node-RED's own `adminAuth`
(this uses the exact same `bcryptjs` library and hash format, so a hash you
already generated for `adminAuth` works here too):

```bash
node-red admin hash-pw
# or, without the Node-RED CLI:
node -e "console.log(require('bcryptjs').hashSync('yourpassword', 8))"
```

Once configured, every request to the dashboard's pages and API - browser
or script/curl alike - must present that username/password via HTTP Basic
Auth, or receives `401 Unauthorized`. The warning banner disappears once
`execHistoryAuth` is set (regardless of whether you got the credentials
right on any given request - the banner is about whether protection is
*configured at all*, not about the current request's own auth state).

## Usage

### Automatic tracking

Every `inject` and `http in` node is a flow origin, so that's where tracking
begins automatically, the moment it fires:

```
[Inject: "Order Placed"] → [Your Nodes] → [HTTP Response]
        ^
        execution starts here, no node placement required
```

At that point:
- A unique execution ID is generated and stamped onto `msg._executionId`
- The **flow name** is set to the origin node's configured name (e.g.
  `"Order Placed"`) and stamped onto `msg._flowName`. If the origin is an
  unnamed `http in` node, the same default label Node-RED's own editor
  would show is used instead (e.g. `"[get] /foo/bar"`) rather than a
  meaningless placeholder.
- A `RUNNING` execution record is written to MongoDB immediately

Placing the **Mark Execution Complete** node anywhere downstream is
optional - it's a plain pass-through node whose only job is to flip the
execution to `COMPLETED` when a message reaches it, for flows with no
`http response` node to do that automatically (see "Execution Status"
below).

### Per-node message recording

Every node in a tracked flow gets a message recorded automatically - no
node placement required - following one rule:

- **The origin node** (the `inject`/`http in` that started the execution)
  gets exactly one entry, `direction: 'input'`, flagged `isFirst: true` -
  its outgoing payload, i.e. what starts everything.
- **Every node after that** gets exactly one entry, `direction: 'output'`,
  recorded via `onComplete` (fired when a node calls its `done()` callback -
  the same runtime mechanism as Node-RED's own built-in "Complete" node).
  The origin's own completion is deliberately *not* recorded a second time
  here - it already has its one entry from above.
- **An `http response` node's output, or a Mark Execution Complete node's
  output,** is additionally flagged `isResult: true`, since that message
  represents the execution's actual outcome, not just another checkpoint
  along the way.
- **A node that called `done(err)`** gets its entry flagged `isError: true`
  instead, and the whole execution flips to `FAILED` (see "Execution
  Status" below).

One real limitation, structural to Node-RED itself, not a bug to work
around: nodes using the legacy single-argument
`on('input', function(msg) {...})` style never call `done()`, so their
output isn't recorded. Modern core nodes (function, switch, change,
http request, ...) do call it.

Each recorded message includes the node's display name (`nodeName`) - its
configured `name`, or if left empty, the same default Node-RED's own editor
would show (the node type for most node types; `[method] /url` for an
unnamed `http in` node; `http` for an unnamed `http response` node).

### Execution Status

| Status | Meaning | Trigger |
|--------|---------|---------|
| **RUNNING** | Execution in progress | An `inject`/`http in` node fires |
| **COMPLETED** | Successfully finished | An `http response` node completes, or a **Mark Execution Complete** node is reached |
| **FAILED** | Error occurred | Any node calls its `done(err)` callback with an error |

`FAILED` detection hooks into the same runtime mechanism (`onComplete`)
used for everything else - it fires whenever a node calls `done(err)`, the
same mechanism behind Node-RED's own **Catch** node, so it catches the same
failures a Catch node would. It does **not** catch a node that throws
*synchronously* inside its own input handler (Node-RED routes that straight
to the node's error log without ever calling `done()`), nor a node that
simply hangs and never calls `done()` at all - both leave the execution
stuck `RUNNING` instead. This is a limitation of Node-RED's hook API, not
something worked around here.

Flows that don't end in an `http response` node and have no **Mark
Execution Complete** node placed anywhere (most non-HTTP flows, if left
unmodified) will simply stay `RUNNING` forever - there's no universal "the
flow is done" signal to hook into the way there is for inject/http-in
origins.

### Message Splitting

If a node outputs multiple messages from a single input:
- All outputs are grouped under the **same execution ID** (it's carried on
  `msg._executionId`, which Node-RED's message cloning preserves)
- Treated as a single execution run
- Each message is individually recorded

A Split node - and every node downstream of it until the matching Join -
runs once per split part, so each gets multiple recorded messages for the
same node. The dashboard shows this as one box flagged `split` (yellow, to
stand out from `FIRST`/`result`) with **&larr;/&rarr;** arrows to step
through each part's payload, rather than a separate branch per part. Once
a Join node recombines the parts back into one message, its own
downstream nodes go back to a single box each, automatically - there's
nothing to configure.

### Branching flows

When a node has multiple outputs (or one output wired to multiple
destinations), the dashboard shows this as a collapsible tree rather than a
flat list - each divergence point becomes a labeled, expandable section
("Output 1 (3 messages)", "Output 2 (1 message)") instead of interleaving
both branches' messages together in temporal order.

By default, only the path down to the first `isResult`-flagged message
(the outcome most developers care about, e.g. what a branch to an
`http response` node produced) is expanded; sibling branches start
collapsed. If no `isResult` message exists anywhere in the execution (most
non-HTTP flows), every branch defaults to expanded instead, since there's
no principled way to pick one over another.

### Independent destinations vs. reconverging ones

One output wired to several destination nodes (not a Split/Join - just
multiple wires off one port) is a further, finer-grained split: each
destination gets its own nested sub-branch inside that output's box, but
only if they never share a later node. This is checked with a standard
graph-theory test for independent paths in a DAG: compute each
destination's full forward-reachable set (by following recorded edges),
and check whether any two of those sets intersect. Disjoint sets means
genuinely independent branches, worth their own dropdowns; any overlap
means they reconverge somewhere downstream (a "diamond"), so they're
rendered flat instead - one shared box, exactly as if there'd only been one
destination to begin with. This avoids either duplicating the shared
downstream portion under both branches, or arbitrarily attributing it to
just one of them.

This is reconstructed client-side from the flat `messages` + `edges` the
API returns - see "Edges Collection" below for what makes it possible.

## Replay

Every row on the **Executions** tab has a **Replay** button that resumes
that execution - typically a `FAILED` one, after whatever caused it has
been fixed - as a brand-new, independently tracked execution, in one of
three modes.

### Restart from Origin - always available

Every tracked execution can always be replayed as a full restart: re-inject
its flow's original input back into the true `inject`/`http in` origin, and
let it run through again from scratch. This needs no node placement at all
and works on any execution, in any flow - a flow is always repeatable from
the very beginning.

This even works correctly on an execution that is *itself* the product of an
earlier replay, any number of generations deep: restart follows the chain of
"what was this replayed from" back to whichever execution a real origin
actually began, and reuses **that** execution's own recorded input. So
however many times something has already been resumed from a later
checkpoint, "start completely over" is always one click away.

### Mark Replay Point - an optional, better alternative

A full restart isn't always the right choice. If the original execution
already wrote to a database, charged a payment, or sent a notification
before it failed, restarting from scratch would repeat that side effect.
Whether that's acceptable is a judgment call about the flow's own side
effects - this package can't infer it (checking "was a database call made?"
doesn't generalize to every kind of side effect a node might have), so it
doesn't try to. Instead, if you want something smarter than a full restart,
it requires an explicit, visible decision from whoever built the flow.

That decision takes the form of a node this package ships: **Mark Replay
Point** (`replay-point`), found under the *debug* category in the palette,
sharing the same color as **Mark Execution Complete** since both are the
same kind of thing - a deliberately-placed marker, not something that
transforms the message. It's a plain pass-through node - functionally a
no-op - whose only job is to mark, for tracking purposes, "this is an
additional point it's safe to resume from, skipping everything before it."
Placing this node doesn't disable or replace Restart from Origin - it just
adds a second, more targeted option alongside it.

Unlike Mark Execution Complete's name (cosmetic), **this node's name is
required**. It's how the Replay dialog's checkpoint picker and a resumed
execution's message tree tell one checkpoint apart from another - an
unnamed node there would leave you choosing between indistinguishable
options, so the editor won't let you deploy one without a name.

Place it wherever you've decided it's safe to resume from - typically right
after any step you wouldn't want repeated (a database write, a payment
charge, an email sent), and before whatever's actually likely to fail (an
external API call is the common case). When the message passes through it,
that node's recorded output message is flagged `isReplayPoint: true` (see
"Messages Collection" below) - the same automatic, no-configuration
recording every other node already gets, just additionally tagged.

If an execution has at least one message flagged `isReplayPoint: true` in
its own recorded history - i.e. the message genuinely passed through a
**Mark Replay Point** node *during that specific execution* - the Replay
tab lists each one as an extra option alongside "Restart from Origin",
defaulting to the last one recorded (usually the one closest to wherever the
execution went on to fail). Adding the node to the flow later doesn't
retroactively give older, already-recorded executions a checkpoint option;
they need to be re-run first.

**A `Mark Auto Replay Point` node (see "Automatic Replay" below) is exactly
as safe a manual reset location as this one** - if it's safe enough to
retry itself automatically and repeatedly, it's safe enough for a human to
manually decide to resume from too. Its own recorded messages (flagged
`isAutoReplayPoint: true`) show up in the same picker, tagged
<code>auto</code> to note which kind of node they came from - there's no
need to also place a `Mark Replay Point` right next to one just to unlock
manual replay at the same spot.

Picking one of these raises a second, follow-up question the dialog asks
before actually resuming: **reset the automatic retry count, or keep it?**
Resetting (the default, and the only behavior every other kind of replay
has ever had) gives the resumed execution a full fresh budget of "Max
attempts" again. Keeping it instead has the resumed execution inherit the
checkpoint's own current attempt count - useful when you're manually
continuing the *same* incident (e.g. "the flaky service is back up, try
this exact spot again") rather than treating the manual intervention as a
brand-new failure chain that deserves a brand-new retry budget.

### What resuming from a checkpoint actually does

Once a checkpoint is chosen, resuming:

1. Generates a brand-new execution ID and creates a new `RUNNING` execution
   record, cross-referenced back to the one it was resumed from (see
   "Executions Collection" below).
2. Records the checkpoint's own recorded payload as this new execution's one
   `input` message - exactly like a real origin's `initialMessage` - flagged
   both `isReplayPoint: true` and `isReplayed: true` (see "Messages
   Collection" below for what each means).
3. Dispatches a fresh clone of that payload directly into the **Mark Replay
   Point** node itself via Node-RED's own `node.receive()` - not into
   whatever was wired downstream of it historically.

Dispatching into the checkpoint node itself, rather than its recorded
downstream destinations, matters for two reasons:

- The new execution always follows the flow's **current** wiring, not a
  historical snapshot - if the flow has changed since (a node inserted,
  rewired, whatever), the resumed execution still goes wherever the
  checkpoint is *actually* connected today.
- The checkpoint node genuinely runs again as part of the new execution, so
  its own output is itself a fresh, valid checkpoint. **A resumed execution
  can be resumed again from the same checkpoint, any number of times** - if
  the retry fails too, its own Replay dialog finds this new execution's own
  `isReplayPoint` message just like it would any other.

Restarting from origin works the same way under the hood - dispatched into
whatever the origin node is currently wired to - except the origin node
itself is never re-triggered (an `http in` node has no way to be triggered
by a message anyway), so a restarted execution's `input` message is flagged
`isRestarted: true` instead.

From that point on, the resumed execution is a completely ordinary tracked
execution - every node it passes through gets recorded exactly as it would
for any other run, including a fresh set of edges, since a fixed bug might
send it down a different path than the original failure did.

### Checkpoints downstream of a Split

A node downstream of a Split - and everything until its matching Join -
runs once per part, so it can have several recorded messages for the same
execution (see "Message Splitting" above). If a **Mark Replay Point** node
sits in that stretch of the flow, the Replay dialog groups its recorded
parts together, colored consistently (the same color-hashing used for the
message tree's carousel boxes - see "Branching flows" above), and shows a
checkbox per part - **any number of them from 1 up to all, not just "all or
exactly one"** - all checked by default, with "All"/"None" links for
convenience.

Which parts actually make sense to replay is a judgment call the dialog
doesn't try to make for you: each part still carries its original
`msg.parts` metadata (the same correlation id and count the Split node
originally stamped it with) unchanged, so a downstream Join relies on
seeing the same count it originally expected to complete - resuming from
fewer than all of them will typically leave it waiting forever for the
rest, unless that's specifically what you want (e.g. deliberately narrowing
in on one or two failing parts for debugging, where you don't need or want
Join to ever complete). The same checkbox picker applies to the unsafe
debug mode below, when a non-checkpoint node also sits downstream of a
Split.

### Debugging: resume from any node (unsafe)

Separately, an operator can enable an unsafe **debug mode** that allows
resuming from literally any node an execution passed through - not just ones
flagged as a sanctioned checkpoint:

```javascript
execHistoryUnsafeReplay: true
```

When enabled, the Replay dialog shows a collapsed "Debugging: resume from
any node" section listing every recorded message. Picking one resumes from
it exactly like a checkpoint would, mechanically - but the seed message is
flagged `isDebugResume: true` instead of `isReplayPoint`/`isReplayed`,
**deliberately not** making it a sanctioned checkpoint itself: resuming from
it again still requires debug mode, it doesn't retroactively become safe.

This is disabled by default and meant for debugging a specific failure, not
as a routine way to retry things - it bypasses the entire point of Mark
Replay Point, which is forcing a considered decision about where a retry is
actually safe.

### When replay isn't possible

- **Checkpoint/debug resume chosen, but the target node no longer exists**:
  the node the execution was recorded against was deleted or the flow was
  redeployed since. Refused rather than guessing at a substitute.
- **No outgoing connection**: the resume target (the checkpoint node, or the
  origin for a restart) currently has no wire leading anywhere in the
  current flow.
- **Debug mode picked, but it's disabled**: `execHistoryUnsafeReplay` isn't
  set to `true` in `settings.js`.

Restart from Origin itself is refused only if the flow's true origin node
has been deleted or disconnected since - otherwise it always works.

## Automatic Replay

**Mark Auto Replay Point** is a second checkpoint node, alongside Mark
Replay Point: it marks the same kind of safe-to-resume-from spot, but the
resume triggers itself automatically when the execution fails somewhere
downstream, instead of waiting for a person to click Replay. It's a bigger
decision than a manual checkpoint - place it only where you're confident
it's genuinely safe for the flow to retry itself, possibly several times,
completely unattended (typically right after a non-repeatable step, never
before one).

### Settings

- **Max attempts** - hard cap on automatic retries for one failure chain.
  Once reached with no success, no further automatic retry happens and
  "When exhausted" decides what happens next (see below).
- **Strategy** - `immediate` retries right away; `fixed` waits the same
  delay before every attempt; `exponential` doubles the delay each attempt,
  up to a configured maximum.
- **Jitter** - randomizes the actual delay so many retries don't land at the
  same instant. Always on for exponential backoff.
- **When exhausted** - `error` (default) or `output`, see "Exhausted output"
  below.

### What happens on failure

If the execution later fails downstream of the checkpoint, a retry is
scheduled for that node's configured delay and re-enters the flow at the
checkpoint with its originally recorded message, as a new, separately
tracked execution (`replayMode: 'auto'`). Because the checkpoint node
genuinely runs again as part of that new execution, its own output is
itself a fresh, valid checkpoint - so a resumed execution can be
automatically resumed again from the same point, up to Max attempts times.

The seed message is flagged `isAutoReplayPoint: true`/`isAutoReplayed: true`
(parallel to Mark Replay Point's `isReplayPoint`/`isReplayed`), shown as
an **auto-retried from here** badge in the dashboard's message tree, and
the execution's metadata panel shows the same "Replayed From"/"Replayed As"
links the manual checkpoint flow uses.

A pending automatic retry is **durably recorded** (an additive
`scheduledRetry` field on the execution document), not just held in an
in-process timer - if Node-RED restarts while one is waiting, a startup
reconciliation scan re-arms or immediately fires it, instead of the retry
silently disappearing.

### Exhausted output

Once Max attempts is reached and the final attempt has also failed, no
further automatic retry happens - that execution is flagged
`retriesExhausted: true` (shown as a **retries exhausted** badge in the
Executions list) either way. "When exhausted" controls what happens *in
addition* to that:

- **`error`** (the default) - raises it via `node.error()`, the same
  mechanism any node failure uses, catchable with a Catch node scoped to
  this tab (or any tab, for a catch-all). **Nothing new is created.** This
  is the default specifically because a second output nobody wired up would
  otherwise leave a brand-new tracked execution stuck `RUNNING` forever -
  see "Execution Status" above: nothing marks an execution `COMPLETED` or
  `FAILED` except reaching an actual downstream node, and an unwired output
  never reaches one.
- **`output`** - adds a **second output** that fires exactly once, carrying
  the last failed payload plus the recorded error, as a new, fully tracked
  execution (`replayMode: 'auto-exhausted'`). Wire it to an alert, a
  dead-letter path, or a **Mark Execution Complete** node so it actually
  terminates - it's a regular tracked execution, not a bare untracked
  message, so left unwired it will sit `RUNNING` indefinitely. The node only
  gains this second output once you save the edit dialog with this option
  selected.

### Split/Join scope (v1)

Like Mark Replay Point, a checkpoint placed downstream of a Split runs once
per part, and an automatic retry always resumes **all of that execution's
recorded parts together** - never just the one that failed. Retrying only
the failed part isn't supported yet: it would need a persistent,
package-owned Join (backed by its own collection, keyed by the Split's
correlation id rather than by execution id) that this package doesn't have.
This is a deliberate v1 scope limit, not an oversight.

### Coexists with Restart and Mark Replay Point

This node doesn't replace Restart from Origin or Mark Replay Point - all
three can be used together in the same flow. Manually replaying an
execution (restart or checkpoint) resets that checkpoint's automatic
attempt count back to zero for whatever happens next.

This node's own checkpoint is also a valid **manual** reset location -
see "Mark Replay Point" above. You don't need a separate `Mark Replay
Point` node next to it just to be able to manually jump back once
whatever was flaky (e.g. an external service) is working again.

## Grouping replay/retry chains

Every replay - restart, checkpoint, debug, or automatic - creates a brand
new, independently tracked execution, linked back to what it was replayed
from via `replayOf`. Left ungrouped, a flow that fails and gets retried a
few times before succeeding shows up as several separate rows, which gets
noisy fast, especially with `auto-replay-point` in the mix.

The dashboard's **Executions** tab has a "Group replay chains" toggle
(**on by default**) that instead shows one row per chain - the original
execution plus everything it eventually led to, however many replay
generations deep:

- **Execution ID**: the chain's **root** - the execution a real
  inject/http-in origin actually began, i.e. the same one "Restart from
  Origin" would restart from (see `getRootExecution` above).
- **Flow**: unchanged - every execution in a chain is always the same flow.
- **Tags**: its own column - a `replay` badge if this row was itself
  produced by a replay, an `automatic replay failed` badge instead if the
  chain's last event was its automatic retries being exhausted (not another
  attempt - see "Exhausted output" below), and/or `retries exhausted` if any
  member of the chain used up its automatic retry budget.
- **Status**: the **last** execution's status. If a retry eventually
  succeeds, the whole chain shows as `COMPLETED`.
- **Flow-Duration**: wall-clock time from the first execution's first
  message to the last execution's completion - not any single execution's
  own duration.
- **Start Time**: the first execution's start time.
- **Actions** (View/Replay) act on the chain's **latest** execution - its
  current state - and the execution detail view already shows the full
  chain via its "Replayed From"/"Replayed As" links.

Turning the toggle off goes back to one row per execution, exactly as
before. Grouping is powered by an additive `rootExecutionId` field stamped
on every execution at creation time (see "Executions Collection" below) -
executions recorded before this field existed have no `rootExecutionId` and
simply show as their own one-member group.

### Inspecting one chain without ungrouping everything

Turning the toggle off ungroups the *entire* list, which is more disruptive
than wanting to look closely at just one chain. Instead, any grouped row
with more than one execution gets an expand caret (`&#9656;`) next to its
id - every other row (a chain with only one execution, or a non-oldest
member inside an already-expanded chain) shows a plain dot (`&#8226;`) in
the same spot instead, purely so the id column stays aligned. Clicking the
caret swaps that one summary row for its actual member executions, **oldest
at the top, newest at the bottom**, each shown exactly as it would be in the
ungrouped view (its own status, duration, and View/Replay actions) - the
caret moves to the top (oldest) row and now collapses the chain back to its
one summary row. This is backed by `GET /api/executions/chain/:rootExecutionId`
(see "API Endpoints" below),
not by re-fetching or re-filtering the whole list.

## Deep Search

The dashboard's **Deep Search** tab searches the actual *content* of every
recorded message across all executions - not execution IDs or flow names
(that's what the Executions tab's search box already does), but the
message payloads themselves. It's how you'd find "which execution had this
customer's order ID in it" without knowing the flow, the execution ID, or
which node's payload it lived in.

It's **disabled by default**, since unlike everything else in this
dashboard it has no index to fall back on - it's a literal, case-insensitive
substring regex scan over message content, so its cost scales directly with
how much history has accumulated. Enable it with:

```javascript
execHistoryDeepSearch: true
```

When disabled, the tab is hidden entirely (the dashboard checks
`GET /api/executions/config` on load) and the underlying
`/api/executions/search` endpoint responds `403`.

How it works:
- Every message's payload is flattened at write time into a `payloadText`
  field (its values only, not JSON keys/structure - see "Messages
  Collection" below), which is what a search actually matches against.
- A search scans at most 5000 matching messages (newest first); if that cap
  is hit, the dashboard shows a notice that results may be incomplete. If
  you hit this regularly, either narrow the search term or treat it as a
  signal that message volume has outgrown a plain regex scan - a dedicated
  search backend (e.g. Elasticsearch) would be the next step, though this
  package doesn't implement one today.
- Results are grouped one row per **execution**, even when the term matches
  several of its messages, with a snippet shown inline alongside the
  standard status/flow/date filters. A **"Jump to first/last match"**
  control picks which of an execution's matches that snippet (and the
  detail view's deep-link) refers to: **first** (the default) is the
  earliest matching message chronologically - typically where the
  searched-for content actually entered the flow; **last** is the most
  recent one - typically closer to the outcome, useful when you care about
  what an execution eventually did with it.
- Clicking a result opens the same detail view used everywhere else in the
  dashboard, already scrolled to and briefly highlighted on the exact
  message that matched - including auto-expanding whichever collapsed
  branch it's inside, and (if it's part of a Split/Join) jumping the
  carousel straight to the matching part.

## Data Storage

### Executions Collection

```javascript
{
  executionId: "exec_a1b2c3d4_1691234567890",
  flowId: "9dd1849365bee2b6",       // the origin node's tab/flow id
  flowName: "Order Placed",         // the origin inject/http-in node's name
  originNodeId: "nodeABC",          // the node whose recorded 'input' message begins this
                                     // execution's own tracked history - a real inject/http-in
                                     // node for a normal execution, or the resumed-from node
                                     // (a checkpoint, or an unsafe debug-mode node) otherwise.
                                     // Used to find the TRUE origin when following replayOf
                                     // chains back for a full restart - see "Replay" above.
  status: "COMPLETED",
  startTime: ISODate("2024-08-04T10:30:00Z"),
  endTime: ISODate("2024-08-04T10:30:05Z"),
  duration: 5000,
  nodeCount: 5,
  messageCount: 8,
  error: null,
  completionNodeId: "node123",
  createdAt: ISODate("2024-08-04T10:30:00Z"),
  updatedAt: ISODate("2024-08-04T10:30:05Z"),

  // Present only on an execution created BY a replay (see "Replay" above) -
  // absent on a normal inject/http-in-triggered execution.
  replayOf: "exec_9f8e7d6c_1691234000000",   // the executionId this one was replayed from
  replayMode: "checkpoint",                   // "restart" | "checkpoint" | "debug" | "auto" | "auto-exhausted"
  replayFromNodeId: "node789",                // absent for "restart" - the resumed-from node
  replayFromMessageIds: ["64f1a2b3c4d5e6f7a8b9c0d1"], // absent for "restart" - the specific message(s) used as
                                                        // the seed; more than one when resumed from every part
                                                        // of a Split-downstream node together (see "Replay" above)

  // Present only on an execution that has ITSELF been replayed at least
  // once - one entry per replay triggered from it, oldest first. `exhausted`
  // is present only on the one-time link to a beginAutoExhausted execution -
  // distinguishes "the automatic retry mechanism gave up here" (shown as
  // "automatic replay failed" in the dashboard) from an actual retry
  // attempt (shown as "auto-retried") - both are autoTriggered: true.
  replays: [
    { executionId: "exec_1a2b3c4d_1691234999999", timestamp: ISODate("2024-08-04T11:00:00Z"), autoTriggered: false }
  ],

  // Automatic-replay bookkeeping (see "Automatic Replay" above) - additive,
  // 0/absent on any execution that never involved a Mark Auto Replay Point.
  autoReplayAttempt: 0,          // 0 for normal/manually-replayed; parent's + 1 for an automatic resume
  scheduledRetry: {              // present only while an automatic retry is pending; cleared once
    dueAt: ISODate("2024-08-04T10:30:10Z"), // it fires, is claimed, or is superseded by a manual replay
    attempt: 1,
    nodeId: "node456",
    messageIds: ["64f1a2b3c4d5e6f7a8b9c0d1"]
  },
  retriesExhausted: false,       // true once Max attempts is reached and the last attempt also failed

  // Stamped once at creation, never recomputed - see "Grouping replay/retry
  // chains" above. Equal to this execution's own executionId for a real
  // inject/http-in origin; inherited from the parent (whatever it was
  // replayed/retried from) otherwise. Absent on executions recorded before
  // this field existed.
  rootExecutionId: "exec_a1b2c3d4_1691234567890"
}
```

### Messages Collection

```javascript
{
  _id: ObjectId("..."),         // also the chronological sort tiebreaker (see below)
  executionId: "exec_a1b2c3d4_1691234567890",
  nodeId: "node123",
  nodeName: "build response",   // the node's display name - see "Per-node message recording"
  direction: "input",           // "input" for the origin's one entry, "output" for every node after
  isFirst: true,                // only ever true on the origin's 'input' entry
  isResult: false,              // true on an http response / Mark Execution Complete node's 'output' entry
  isError: false,               // true when this node's 'output' entry came from a done(err) call
  isReplayPoint: false,         // true on a Mark Replay Point node's 'output' entry, OR on a
                                 // "checkpoint"-mode resumed execution's one 'input' entry (see
                                 // isReplayed below) - both are genuine checkpoints a later
                                 // replay can resume from - see "Replay" above
  isReplayed: false,            // true ONLY on a "checkpoint"-mode resumed execution's one
                                 // 'input' entry - marks "this execution began by resuming a
                                 // Mark Replay Point checkpoint"
  isRestarted: false,           // true ONLY on a "restart"-mode execution's one 'input' entry -
                                 // marks "this execution began as a full restart from origin"
  isDebugResume: false,         // true ONLY on a "debug"-mode execution's one 'input' entry -
                                 // marks "this execution began via an unsafe debug-mode resume
                                 // from an arbitrary node" - deliberately NOT isReplayPoint, so
                                 // it doesn't itself become a sanctioned checkpoint
  isAutoReplayPoint: false,     // true on a Mark Auto Replay Point node's 'output' entry, OR on
                                 // an "auto"-mode resumed execution's one 'input' entry (see
                                 // isAutoReplayed below) - parallel to isReplayPoint, but for
                                 // automatic rather than manually-triggered resumes
  isAutoReplayed: false,        // true ONLY on an "auto"-mode resumed execution's one 'input'
                                 // entry - marks "this execution began by an automatic retry
                                 // from a Mark Auto Replay Point checkpoint" - parallel to isReplayed
  payload: { /* message data */ },
  payloadText: "flattened text of payload's values, for Deep Search",
  timestamp: ISODate("2024-08-04T10:30:01Z"),
  createdAt: ISODate("2024-08-04T10:30:01Z")
}
```

Queried sorted by `(timestamp, _id)` - `_id` (an ObjectId, monotonically
increasing per-process) is a tiebreaker for messages that land in the same
millisecond, which timestamp alone doesn't have enough resolution to order.

### Edges Collection

```javascript
{
  _id: ObjectId("..."),
  executionId: "exec_a1b2c3d4_1691234567890",
  sourceNodeId: "node123",     // the node that called send()
  sourcePort: 1,                // which of its outputs (0-indexed)
  destinationNodeId: "node456", // the node that wire leads to
  createdAt: ISODate("2024-08-04T10:30:01Z")
}
```

One edge per wire actually dispatched across, recorded for every node's
`send()` call (not just origins). This is what lets the dashboard
reconstruct the real branch structure a message took - which output port
fed which downstream node - rather than only a flat, order-only list of
"these nodes ran". See "Branching flows" below.

## API Endpoints

### List Executions

```
GET /api/executions?database=default&status=COMPLETED&page=1&limit=50
```

Query Parameters:
- `database`: Database configuration key
- `status`: Filter by RUNNING, COMPLETED, or FAILED
- `flowId`: Filter by flow ID (the origin node's tab id)
- `flowName`: Filter by flow name (the origin node's configured name), case-insensitive substring
  match - what the dashboard's "Flow" combobox actually filters by, since a tab can have more than
  one distinctly-named origin node and `flowId` alone can't tell those apart
- `onlyReplays`: `true` to only return executions produced by a replay (i.e. `replayOf` is set -
  see "Replay" above). Independent of `status`, so it combines with it rather than replacing it
  (e.g. `status=FAILED&onlyReplays=true` for "failed replays")
- `grouped`: `true` to return one row per replay/retry **chain** instead of one row per execution -
  see "Grouping replay/retry chains" below. When set, `status` filters on the chain's *last*
  execution's status, not any individual member's.
- `page`: Page number (default 1)
- `limit`: Results per page (default 50)

Response:
```json
{
  "executions": [...],
  "total": 247
}
```

### List Distinct Flow Names

```
GET /api/executions/flows/{database}
```

Response:
```json
[
  { "flowName": "Nightly Cleanup" },
  { "flowName": "Order Placed" }
]
```

Every flow name that has at least one recorded execution, alphabetically sorted - powers the
dashboard's "Flow" filter dropdown.

### Get One Chain's Executions

```
GET /api/executions/chain/{rootExecutionId}?database=default
```

Response:
```json
{
  "executions": [ /* raw execution documents, oldest createdAt first */ ]
}
```

Every execution belonging to one replay/retry chain (see "Grouping replay/retry chains" above) -
the chain's root plus every generation replayed/retried from it, however many deep, oldest first.
`rootExecutionId` is whatever a grouped `/api/executions?grouped=true` row reports as its
`executionId`. Powers the dashboard's per-row expand control.

### Get Execution Details

```
GET /api/executions/{executionId}?database=default
```

Response includes execution metadata, all recorded `messages`, and all
recorded `edges` (see "Edges Collection" above) - together enough to
reconstruct the full branch tree the dashboard renders, and (client-side)
to determine whether it has any replay points (`messages` entries with
`isReplayPoint: true`) - see "Replay" above.

### Replay an Execution

```
POST /api/executions/{executionId}/replay?database=default&mode=checkpoint&messageId=64f1a2b3c4d5e6f7a8b9c0d1
```

Query Parameters:
- `database`: Database configuration key
- `mode`: `restart` (default) | `checkpoint` | `debug` - see "Replay" above for what each does.
  `restart` always works with no further parameters. `checkpoint` resumes from a
  `Mark Replay Point` checkpoint; `debug` resumes from any recorded node, but requires
  `execHistoryUnsafeReplay: true` in `settings.js`.
- `messageId`: For `checkpoint`/`debug`, resumes from this ONE specific message's `_id`.
  Defaults to the last eligible one recorded when omitted (and `nodeId` isn't given either).
  Ignored for `restart`.
- `nodeId`: For `checkpoint`/`debug`, resumes from EVERY eligible message this execution
  recorded at this node, together, in their original order - needed when the node sits
  downstream of a Split, since it then has one message per part and resuming from only one
  would leave a downstream Join waiting forever (see "Checkpoints downstream of a Split"
  above). Takes precedence over `messageId` if both are given. Ignored for `restart`.
- `resetAutoReplayCount`: `true` (default) | `false`. Only meaningful when the resumed
  checkpoint was recorded at a **Mark Auto Replay Point** node (ignored otherwise, since a
  regular checkpoint was never part of an automatic-retry budget to begin with). `true` gives
  the resumed execution a full fresh budget of "Max attempts" again, same as every other kind
  of manual replay always has. `false` instead has it inherit the checkpoint's own current
  attempt count - if it fails again right away, it can go straight back to "retries exhausted"
  with no further automatic retries, instead of silently granting a new budget just because a
  human happened to intervene.

Resumes the given execution as a brand-new tracked execution - see "Replay" above for exactly
what each mode does.

Response:
```json
{
  "executionId": "exec_1a2b3c4d_1691234999999",
  "replayedFrom": {
    "mode": "checkpoint",
    "nodeId": "node789",
    "nodeName": "after DB write",
    "messageIds": ["64f1a2b3c4d5e6f7a8b9c0d1"],
    "partCount": 1
  }
}
```

`messageIds`/`partCount` reflect how many recorded messages were actually replayed together -
more than one when `nodeId` matched several (a Split scenario), otherwise always one.

For `mode=restart`, `replayedFrom` is just `{ "mode": "restart" }` - the resume target is
always the flow's true origin, not a specific message.

Error responses (all `4xx`, with a human-readable `message` alongside a machine-readable
`error` code):
- `404`: execution not found
- `403 UNSAFE_REPLAY_DISABLED`: `mode=debug` requested but `execHistoryUnsafeReplay` isn't
  enabled
- `422 NO_REPLAY_POINT`: `mode=checkpoint` requested but this execution has no `Mark Replay
  Point` node in its recorded history - use `mode=restart` instead, or add the node and re-run
- `422 NO_DOWNSTREAM`: the resume target (the origin, for `restart`; the chosen node, for
  `checkpoint`/`debug`) has no outgoing connection in the current flow
- `422 FLOW_CHANGED`: the resume target no longer exists in the current flow (deleted or
  redeployed since)
- `400 INVALID_REPLAY_POINT`: the given `messageId` doesn't match any eligible message on this
  execution

### Get Statistics

```
GET /api/executions/stats/{database}
```

Response:
```json
{
  "total": 247,
  "running": 3,
  "completed": 240,
  "failed": 4,
  "replays": 12,
  "exhausted": 2
}
```

Backed by real counts against persisted history (`countDocuments` by
status, or by `replayOf`/`retriesExhausted` existing for `replays`/
`exhausted`), not in-memory process state - accurate across restarts, and
correctly reflects executions that have completed or failed rather than
only ones the current process happens to still be tracking. `replays`
counts executions produced by a replay, regardless of status - powers the
dashboard's "Replays" stat card. `exhausted` counts executions flagged
`retriesExhausted: true` - a stronger "needs a human" signal than `failed`
alone, since a failed execution may already have been auto-retried into
eventual success downstream, but an exhausted one means the automatic
retry mechanism gave up and nothing further will happen on its own.

### Dashboard Config

```
GET /api/executions/config
```

Response:
```json
{ "deepSearchEnabled": false, "unsafeReplayEnabled": false, "authConfigured": false }
```

Tells the dashboard whether to show the Deep Search tab (`true` only when
`execHistoryDeepSearch: true` is set in `settings.js`) and whether to show the Replay dialog's
unsafe "resume from any node" section (`true` only when `execHistoryUnsafeReplay: true` is
set). `authConfigured` drives the dashboard's unsecured-access warning banner (see "Securing the
Dashboard" above) - `false` means `execHistoryAuth` isn't set in `settings.js` at all, never the
actual username/password.

**This is the one `/api/executions*` route that does NOT require HTTP Basic Auth**, even when
`execHistoryAuth` is configured - it discloses only boolean feature flags, nothing sensitive, and
`authConfigured` is already observable for free from any other route's 401 (or lack of one), so
exempting it reveals no new information. This is what lets the editor's sidebar tab (see "The
'Execution Resilience' sidebar tab" above) safely check whether it's allowed to fetch live stats
before ever doing so - without the exemption, that check would itself trigger the browser's
native Basic Auth prompt just from opening the editor. Every other `/api/executions*` route and
the dashboard's own static files still require auth once configured, as before.

### Deep Search

```
GET /api/executions/search?database=default&q=order-4471
```

Query Parameters:
- `database`: Database configuration key
- `q`: The search term - a literal, case-insensitive substring match against every message's
  content
- `status`, `flowName`, `createdAfter`, `createdBefore`: Same meaning as on `GET /api/executions`
- `matchPosition`: `first` (default) or `last` - which of an execution's matching messages to
  report as `match` below, when it matched more than once
- `page`, `limit`: Pagination, at the execution level (an execution matching several messages
  still counts once)

Returns `403` if `execHistoryDeepSearch` is not enabled in `settings.js`.

Response:
```json
{
  "executions": [
    {
      "executionId": "exec_a1b2c3d4_1691234567890",
      "flowName": "Order Placed",
      "status": "COMPLETED",
      "matchCount": 2,
      "match": {
        "nodeId": "node123",
        "nodeName": "build response",
        "messageId": "...",
        "snippet": "…customer ordered order-4471, shipping to…"
      }
    }
  ],
  "total": 1,
  "truncated": false
}
```

`truncated: true` means the underlying scan hit its 5000-message cap - see "Deep Search" above.

### Delete Executions

```
DELETE /api/executions?database=default&scope=30d
```

Query Parameters:
- `database`: Database configuration key
- `scope`: One of `30d`, `7d`, `today`, `all` - deletes executions (and
  their messages) created before that cutoff; `all` deletes everything
  unconditionally

Response:
```json
{ "deletedCount": 12 }
```

Available from the dashboard via the scope dropdown next to the header's
"Delete" button.

## Possible Future Directions

Replay itself (partial replay from a developer-marked checkpoint - see "Replay" above) is
implemented today, not just designed for. A few extensions the current data model would
support, not yet built:

- **What-If Analysis**: let a replay edit the seed payload before dispatching it, rather than
  always reusing the checkpoint's recorded message verbatim
- **Flow Comparison**: diff two executions' message trees side by side, e.g. an original
  failure against its replay
- **Persistent, package-owned Join node**: a `Mark Auto Replay Point` downstream of a Split
  always retries all recorded parts together today (see "Automatic Replay" above) because
  Node-RED's core `join` node buffers parts in an opaque in-memory correlation this package
  can't see. A dedicated Join node backed by its own collection (keyed by the Split's
  correlation id rather than by execution id) could track part-collection state itself,
  making "retry only the failed part" safe and observable.

## Adapter Pattern

The node uses a pluggable adapter pattern for storage:

```javascript
class CustomAdapter extends DatabaseAdapter {
  async connect(config) { /* ... */ }
  async createExecution(data) { /* ... */ }
  async recordMessage(executionId, nodeId, message) { /* ... */ }
  // ... implement other methods
}
```

This enables:
- PostgreSQL storage
- File system persistence
- Cloud storage backends
- Custom implementations

## Performance Considerations

- Messages are recorded asynchronously (non-blocking)
- Indexes on `executionId`, `status`, `flowId`, `createdAt`
- Cleanup is manual only (see "Manual Cleanup" above) - nothing runs automatically yet
- Memory-efficient message recording (JSON serialization)
- Deep Search (see above) is the one exception to "everything else is indexed" - it's a regex
  scan with no index to use, capped at 5000 scanned messages per query, and disabled by default
  for exactly this reason

## Troubleshooting

### "Database configuration not found"

Ensure MongoDB connection is configured in `settings.js` under the key `execHistoryDB_default`
(tracking always targets the `default` database; other configuration keys are only used if you
pass a matching `?database=` query parameter to the dashboard/API yourself).

### Executions not recording

- Check database connection in settings
- Verify MongoDB is running and accessible
- Check Node-RED logs for connection errors

### Dashboard not appearing

- Open browser console for errors
- Ensure `execHistoryDB_default` is configured in `settings.js` - the dashboard and its API are
  always served, but will error on the first request that needs a database connection if it's missing
- Check that at least one execution has been recorded

### "Authentication required" (401) when opening the dashboard

`execHistoryAuth` is configured in `settings.js` (see "Securing the Dashboard" above) - enter
the configured username/password in the browser's login prompt. For scripts/curl, pass them via
HTTP Basic Auth (e.g. `curl -u username:password ...`).

## License

MIT
