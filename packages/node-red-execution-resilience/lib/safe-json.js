// Circular-safe stand-in for JSON.parse(JSON.stringify(value)).
//
// Node-RED messages can carry live objects with genuine cycles (e.g. an
// HTTP In node attaches msg.req/msg.res, whose Socket <-> HTTPParser
// references loop back on each other). Node-RED's own cloneMessage()
// sidesteps this by never deep-cloning req/res in the first place - but we
// persist arbitrary payloads to Mongo, so anything could theoretically be
// circular, not just req/res. This is a generic backstop: known cycles are
// replaced with a "[Circular]" marker instead of throwing.
function safeClone(value) {
  const seen = new WeakSet();

  const json = JSON.stringify(value, function (key, val) {
    if (typeof val === 'object' && val !== null) {
      if (seen.has(val)) {
        return '[Circular]';
      }
      seen.add(val);
    }
    return val;
  });

  return JSON.parse(json);
}

module.exports = { safeClone };
