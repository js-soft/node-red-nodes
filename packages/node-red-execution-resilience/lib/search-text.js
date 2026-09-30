// Support for Deep Search: turning an arbitrary message payload into a
// plain-text blob that a literal substring/regex search can run against,
// and turning a match back into a short human-readable snippet.

const MAX_SEARCH_TEXT_LENGTH = 10000;

// Walks a (already safeClone'd, so cycle-free) JSON value and joins every
// primitive leaf into one string, dropping object/array keys entirely - the
// point is searching actual message CONTENT, not its shape, and structural
// JSON syntax would otherwise just be noise a search term could accidentally
// match. Capped since a message can carry an arbitrarily large payload
// (e.g. a base64 blob) that would otherwise bloat every message document.
function flattenForSearch(value) {
  const parts = [];
  let budget = MAX_SEARCH_TEXT_LENGTH;

  const visit = (v) => {
    if (budget <= 0 || v === null || v === undefined) return;

    if (typeof v === 'string') {
      parts.push(v);
      budget -= v.length;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      const s = String(v);
      parts.push(s);
      budget -= s.length;
    } else if (Array.isArray(v)) {
      for (const item of v) {
        if (budget <= 0) break;
        visit(item);
      }
    } else if (typeof v === 'object') {
      for (const key of Object.keys(v)) {
        if (budget <= 0) break;
        // Skip Node-RED/this package's own internal bookkeeping properties
        // (_msgid, _executionId, _flowName, ...) - their values are opaque
        // ids, not message content, and would otherwise show up first in
        // every snippet (Node-RED sets _msgid before any of a message's
        // actual fields), pushing the real match out of view.
        if (key.startsWith('_')) continue;
        visit(v[key]);
      }
    }
  };

  visit(value);
  return parts.join(' ').slice(0, MAX_SEARCH_TEXT_LENGTH);
}

// A short excerpt of `text` centered on the first occurrence of `term`, for
// the deep search results list - so a user can tell WHERE a match happened
// without opening the execution's full detail view first.
function buildSnippet(text, term, radius = 60) {
  if (!text) return '';

  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return text.slice(0, radius * 2);

  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + term.length + radius);

  let snippet = text.slice(start, end);
  if (start > 0) snippet = '…' + snippet;
  if (end < text.length) snippet += '…';
  return snippet;
}

module.exports = { flattenForSearch, buildSnippet };
