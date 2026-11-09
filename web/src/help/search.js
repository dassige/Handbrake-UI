// Searching the help: every topic title and text, ignoring accents and case; every typed word must match.
// Ported from dgsoft-image-manager (web/src/help/search.ts).

/** A piece of text, marked when it's one of the words searched for. */
/** A block of help as plain text: link labels kept, formatting marks and list or heading prefixes taken out. */
export function plainText(block) {
  return block
    .replace(/^(### |- |\d+\. )/, '')
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

/** Lower case without accents, with where each of its characters comes from in the text (for highlighting). */
function folded(text) {
  let out = '';
  const from = [];
  let i = 0;
  for (const ch of text) {
    const f = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    out += f;
    for (let k = 0; k < f.length; k++) from.push(i);
    i += ch.length;
  }
  from.push(i);
  return { text: out, from };
}

/** The words of a search, folded; quotes and punctuation around them don't count. */
export function searchWords(query) {
  const words = folded(query)
    .text.split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
  return [...new Set(words)];
}

/** Every place one of the words is found in the text, as [start, end) ranges of the text, merged. */
function ranges(text, words) {
  const f = folded(text);
  const found = [];
  for (const w of words) {
    for (let at = f.text.indexOf(w); at >= 0; at = f.text.indexOf(w, at + w.length)) found.push([f.from[at], f.from[at + w.length]]);
  }
  found.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of found) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

/** The text cut into pieces, the words marked. */
export function highlight(text, words) {
  const out = [];
  let at = 0;
  for (const [s, e] of ranges(text, words)) {
    if (s > at) out.push({ text: text.slice(at, s), mark: false });
    out.push({ text: text.slice(s, e), mark: true });
    at = e;
  }
  if (at < text.length) out.push({ text: text.slice(at), mark: false });
  return out;
}

const BEFORE = 60;
const LENGTH = 180;

/** About LENGTH characters of the text around the first word found, cut between words, with "…" where it's cut. */
export function snippetOf(text, words) {
  const first = ranges(text, words)[0];
  let start = first ? Math.max(0, first[0] - BEFORE) : 0;
  let end = Math.min(text.length, start + LENGTH);
  if (start > 0) {
    const space = text.indexOf(' ', start);
    start = space >= 0 && first && space < first[0] ? space + 1 : start;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    end = space > start + LENGTH / 2 ? space : end;
  }
  const pieces = highlight(text.slice(start, end), words);
  if (start > 0) pieces.unshift({ text: '…', mark: false });
  if (end < text.length) pieces.push({ text: '…', mark: false });
  return pieces;
}

const count = (haystack, word) => {
  let n = 0;
  for (let at = haystack.indexOf(word); at >= 0; at = haystack.indexOf(word, at + word.length)) n++;
  return n;
};

/**
 * The topics having every word of the search (in their title or text), best first: words in the title count most
 * (more at the start of one of its words), then how often they're in the text. Ties keep the topics' order.
 */
export function searchHelp(query, topics) {
  const words = searchWords(query);
  if (!words.length) return [];
  const hits = [];
  for (const t of topics) {
    const title = folded(t.title).text;
    const blocks = t.body.map(plainText);
    const text = folded(blocks.join('\n')).text;
    if (!words.every((w) => title.includes(w) || text.includes(w))) continue;
    let score = 0;
    for (const w of words) {
      if (title.includes(w)) score += 10 + (new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(title) ? 5 : 0);
      score += Math.min(5, count(text, w));
    }
    if (words.length > 1 && title.includes(words.join(' '))) score += 20;
    const block = blocks.find((b) => words.some((w) => folded(b).text.includes(w))) ?? blocks[0] ?? '';
    hits.push({ id: t.id, title: highlight(t.title, words), snippet: snippetOf(block, words), score });
  }
  return hits.sort((a, b) => b.score - a.score);
}
