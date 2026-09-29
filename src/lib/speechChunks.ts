/**
 * speechChunks.ts
 *
 * Cut text the avatar is about to say into pieces the voice can start on one
 * at a time.
 *
 * WHY THIS EXISTS
 *
 * `speak()`, and a reply an `onSubmit` handler returns as one string, used to
 * go to the voice whole. The voice produces audio for everything it is given
 * before handing any of it back, so a four-sentence greeting sat in silence
 * until all four sentences existed — on a machine without WebGPU, many seconds,
 * straight after a long download. Streamed replies never had this problem,
 * because they arrive a sentence at a time already.
 *
 * Given sentences, the voice hands back the first one as soon as it exists and
 * works on the second while the first plays. The wait before the avatar opens
 * its mouth becomes the cost of one sentence rather than all of them.
 *
 * Deliberately a sentence splitter and nothing cleverer. Cutting at commas
 * would start sooner still, but the voice pitches a fragment as if it were a
 * whole sentence, and that is audible.
 */

/**
 * The longest piece handed to the voice in one go.
 *
 * Kokoro reads a bounded number of phonemes per call and silently truncates
 * past that, so an unpunctuated run-on has to be cut somewhere regardless.
 * 200 characters is comfortably inside the limit and still a natural phrase.
 */
export const MAX_CHUNK_CHARS = 200;

/**
 * Words that end in a full stop without ending the sentence.
 *
 * Only what a spoken reply is likely to contain. Missing one costs a slightly
 * early pause, not a wrong word, so this does not try to be complete.
 */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'vs', 'etc', 'approx',
  'e.g', 'i.e', 'no', 'fig', 'inc', 'ltd', 'co', 'u.s', 'u.k', 'a.m', 'p.m',
]);

/** Sentence-ending punctuation, with any closing quotes or brackets after it. */
const SENTENCE_END = /[.!?।॥…]+["'”’)\]]*/g;

/** Where a sentence that runs too long can be cut with the least damage. */
const SOFT_BREAK = /[,;:—–]\s/g;

export interface SplitOptions {
  /** Longest piece. Defaults to {@link MAX_CHUNK_CHARS}. */
  maxChars?: number;
  /**
   * Shortest piece worth a call of its own; shorter ones join the next. The
   * engine passes the same floor its streaming path uses for each voice.
   */
  minChars?: number;
}

/**
 * Split text into sentences, and any sentence longer than `maxChars` into
 * phrases. Returns the pieces in order, trimmed, with nothing lost but
 * whitespace.
 */
export function splitForSpeech(text: string, options: SplitOptions = {}): string[] {
  const { maxChars = MAX_CHUNK_CHARS, minChars = 0 } = options;
  const pieces: string[] = [];
  // A line break is a boundary even without punctuation: list items and
  // headings end that way, and reading them as one run-on sentence is wrong.
  for (const line of text.split(/\n+/)) {
    for (const sentence of splitSentences(line)) {
      for (const piece of limitLength(sentence, maxChars)) pieces.push(piece);
    }
  }
  return mergeShort(mergeBare(pieces), minChars);
}

/** Join pieces shorter than `minChars` onto the one that follows. */
function mergeShort(pieces: string[], minChars: number): string[] {
  if (minChars <= 0) return pieces;
  const out: string[] = [];
  let pending = '';
  for (const piece of pieces) {
    pending = pending ? `${pending} ${piece}` : piece;
    if (pending.length >= minChars) {
      out.push(pending);
      pending = '';
    }
  }
  // A short tail joins the piece before rather than going alone.
  if (pending) {
    if (out.length > 0) out[out.length - 1] += ` ${pending}`;
    else out.push(pending);
  }
  return out;
}

function splitSentences(line: string): string[] {
  const out: string[] = [];
  let start = 0;
  SENTENCE_END.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SENTENCE_END.exec(line)) !== null) {
    const end = match.index + match[0].length;
    // Only a boundary when followed by a space or the end of the line, which
    // is what keeps "3.5", "0.5B" and "react-ai-voice-avatar.vercel.app" whole.
    if (end < line.length && !/\s/.test(line[end])) continue;
    if (match[0].startsWith('.') && match[0].length === 1 && !endsSentence(line.slice(start, match.index))) continue;
    const sentence = line.slice(start, end).trim();
    if (sentence) out.push(sentence);
    start = end;
  }
  const rest = line.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/** Whether a single full stop after this text ends a sentence. */
function endsSentence(before: string): boolean {
  const words = before.trim().split(/\s+/);
  const word = words[words.length - 1] ?? '';
  const bare = word.replace(/^["'(\[“‘]+/, '');
  if (ABBREVIATIONS.has(bare.toLowerCase())) return false;
  // An initial, as in "J. R. R. Tolkien".
  if (/^\p{Lu}$/u.test(bare)) return false;
  // A list number opening the sentence: "1. Install it."
  if (words.length === 1 && /^\d+$/.test(bare)) return false;
  return true;
}

/** Cut a sentence longer than `maxChars` at the gentlest break available. */
function limitLength(sentence: string, maxChars: number): string[] {
  const out: string[] = [];
  let rest = sentence;
  while (rest.length > maxChars) {
    const cut = breakPoint(rest, maxChars);
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function breakPoint(text: string, maxChars: number): number {
  const window = text.slice(0, maxChars + 1);
  // A clause break, as long as it leaves a piece worth pitching on its own.
  let best = -1;
  SOFT_BREAK.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SOFT_BREAK.exec(window)) !== null) best = match.index + 1;
  if (best >= maxChars * 0.4) return best;
  // Otherwise between words, and only mid-word when there is no space at all.
  const space = window.lastIndexOf(' ');
  return space > 0 ? space : maxChars;
}

/**
 * Fold pieces with nothing speakable in them into the piece before.
 *
 * A stray "..." or a closing quote on its own line would otherwise become a
 * call to the voice that produces silence, and a gap in the middle of a reply.
 */
function mergeBare(pieces: string[]): string[] {
  const out: string[] = [];
  for (const piece of pieces) {
    if (!/[\p{L}\p{N}]/u.test(piece) && out.length > 0) {
      out[out.length - 1] += piece;
    } else if (/[\p{L}\p{N}]/u.test(piece)) {
      out.push(piece);
    }
  }
  return out;
}
