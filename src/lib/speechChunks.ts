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

/**
 * Sentence-ending punctuation, with any closing quotes or brackets after it.
 *
 * Latin, Devanagari (। ॥), Urdu and Arabic (۔ ؟), and Chinese and Japanese
 * (。！？). The last group is written without a space after it, so it ends a
 * sentence on its own; the rest only do when whitespace follows.
 */
const SENTENCE_END = /[.!?।॥…۔؟。！？]+["'”’)\]」』]*/g;

/** Endings that need no space after them to close a sentence. */
const CLOSES_WITHOUT_SPACE = /[。！？]/;

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
    if (end < line.length && !/\s/.test(line[end]) && !CLOSES_WITHOUT_SPACE.test(match[0])) continue;
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

/**
 * The same cuts for text that arrives a piece at a time: a reply streamed from
 * `onSubmit`, or tokens from the in-browser model.
 *
 * WHY THIS EXISTS
 *
 * Both used to cut on the first full stop in the buffer, so "72.5 percent" was
 * spoken as "72." and then "5 percent", and "Is 72.5 ok?" stopped at the
 * decimal point too. A stream also hides what follows a full stop until the
 * next piece arrives, so here an ending is only trusted once the character
 * after it is known. A single unconfirmed "." is held, never guessed at.
 */
export interface SentenceStream {
  /** Add text and take whatever sentences it completed. */
  push(text: string): string[];
  /**
   * True while a complete sentence shorter than `minChars` is held back,
   * waiting to join the next. Hand it over with {@link release} if the stream
   * goes quiet, so "Sure." before a tool call is not kept waiting for it.
   */
  readonly holding: boolean;
  /** Take a held short sentence now. */
  release(): string[];
  /** The stream has ended: take everything left. */
  flush(): string[];
}

export function createSentenceStream(options: SplitOptions = {}): SentenceStream {
  const { maxChars = MAX_CHUNK_CHARS, minChars = 0 } = options;
  let buffer = '';
  let held = '';

  /** Pass one finished piece on, or hold it if it is too short to go alone. */
  const take = (piece: string, out: string[]) => {
    if (!/[\p{L}\p{N}]/u.test(piece)) {
      // A stray "..." or quote. Joins what is held, or is dropped as silence.
      if (held) held += piece;
      return;
    }
    held = held ? `${held} ${piece}` : piece;
    if (held.length >= minChars) {
      out.push(held);
      held = '';
    }
  };

  /** The end of the first sentence in the buffer that is certainly over, or -1. */
  const confirmedEnd = (): number => {
    const newline = buffer.indexOf('\n');
    SENTENCE_END.lastIndex = 0;
    let match: RegExpExecArray | null;
    let start = 0;
    while ((match = SENTENCE_END.exec(buffer)) !== null) {
      if (newline !== -1 && newline < match.index) return newline + 1;
      const end = match.index + match[0].length;
      if (CLOSES_WITHOUT_SPACE.test(match[0])) return end;
      // What follows has not arrived yet: "72." may become "72.5".
      if (end >= buffer.length) return -1;
      if (!/\s/.test(buffer[end])) continue;
      if (match[0].startsWith('.') && match[0].length === 1 && !endsSentence(buffer.slice(start, match.index))) continue;
      return end;
    }
    return newline === -1 ? -1 : newline + 1;
  };

  return {
    push(text) {
      buffer += text;
      const out: string[] = [];
      for (let end = confirmedEnd(); end !== -1; end = confirmedEnd()) {
        const sentence = buffer.slice(0, end).trim();
        buffer = buffer.slice(end);
        for (const piece of limitLength(sentence, maxChars)) if (piece) take(piece, out);
      }
      // A run-on with no ending yet still has to be cut somewhere.
      while (buffer.length > maxChars) {
        const cut = breakPoint(buffer, maxChars);
        take(buffer.slice(0, cut).trim(), out);
        buffer = buffer.slice(cut);
      }
      return out;
    },
    get holding() {
      return held.length > 0;
    },
    release() {
      if (!held) return [];
      const out = [held];
      held = '';
      return out;
    },
    flush() {
      const out: string[] = [];
      const rest = buffer;
      buffer = '';
      for (const piece of splitForSpeech(rest, { maxChars })) take(piece, out);
      // A short tail goes alone: what came before it has already been said.
      if (held) out.push(held);
      held = '';
      return out;
    },
  };
}
