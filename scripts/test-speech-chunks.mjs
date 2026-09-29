/**
 * Checks how text is cut into pieces for the voice.
 *
 * Every piece becomes a separate call to the voice, so a cut in the wrong place
 * is audible: a pause inside "3.5 GB", a sentence pitched as finished halfway
 * through, or a chunk of silence where a stray symbol was. The first case is
 * the demo's own greeting, which is what every visitor hears first.
 *
 * Run with: node --experimental-strip-types scripts/test-speech-chunks.mjs
 */
import { splitForSpeech, MAX_CHUNK_CHARS } from '../src/lib/speechChunks.ts';

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

/** Compare against an expected list, naming the first difference. */
function expectPieces(text, expected, options) {
  const got = splitForSpeech(text, options);
  if (JSON.stringify(got) === JSON.stringify(expected)) return null;
  return `expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(got)}`;
}

/** Nothing but whitespace may go missing between the text and its pieces. */
function lossless(text, pieces) {
  const squash = s => s.replace(/\s+/g, '');
  return squash(pieces.join('')) === squash(text);
}

check("the demo's greeting starts on its first sentence", () => expectPieces(
  "Hi! My voice, my face and my hearing all run in your browser. My answers come from a hosted model. " +
  "Tap the button and ask me something. And if I ramble, just start talking. I'll stop and listen.",
  [
    'Hi!',
    'My voice, my face and my hearing all run in your browser.',
    'My answers come from a hosted model.',
    'Tap the button and ask me something.',
    'And if I ramble, just start talking.',
    "I'll stop and listen.",
  ],
));

check('one sentence stays one piece', () => expectPieces('The download is about 590 MB.', ['The download is about 590 MB.']));

check('text with no ending punctuation is still spoken', () => expectPieces('Sure, go ahead', ['Sure, go ahead']));

check('empty and blank text produce nothing', () => {
  for (const text of ['', '   ', '\n\n']) {
    const got = splitForSpeech(text);
    if (got.length) return `${JSON.stringify(text)} gave ${JSON.stringify(got)}`;
  }
  return null;
});

check('decimals, versions and domains are not cut', () => expectPieces(
  'Qwen2.5-0.5B needs about 0.75 GB. See react-ai-voice-avatar.vercel.app for a demo.',
  ['Qwen2.5-0.5B needs about 0.75 GB.', 'See react-ai-voice-avatar.vercel.app for a demo.'],
));

check('abbreviations and initials do not end a sentence', () => expectPieces(
  'Dr. Rao and J. R. R. Tolkien met, e.g. at a talk, vs. online. Then they left.',
  ['Dr. Rao and J. R. R. Tolkien met, e.g. at a talk, vs. online.', 'Then they left.'],
));

check('a number ending a sentence still ends it', () => expectPieces(
  'The count is 590. Next question.',
  ['The count is 590.', 'Next question.'],
));

check('a numbered list is read item by item, number included', () => expectPieces(
  '1. Install the package.\n2. Render the avatar.',
  ['1. Install the package.', '2. Render the avatar.'],
));

check('line breaks separate items with no punctuation', () => expectPieces(
  'Three things\nSpeech recognition\nThe voice',
  ['Three things', 'Speech recognition', 'The voice'],
));

check('question and exclamation marks end sentences, closing quotes kept', () => expectPieces(
  'Can you hear me? "Yes!" Good.',
  ['Can you hear me?', '"Yes!"', 'Good.'],
));

check('Hindi sentences end at the danda', () => expectPieces(
  'नमस्ते। मैं आपकी मदद कर सकती हूँ। बताइए?',
  ['नमस्ते।', 'मैं आपकी मदद कर सकती हूँ।', 'बताइए?'],
));

check('a stray symbol is folded in rather than spoken as silence', () => expectPieces(
  'That is all.\n...\n',
  ['That is all....'],
));

check('a run-on sentence is cut at a clause break, never mid-word', () => {
  const text = 'This sentence goes on for a while about the avatar, the voice and the model, ' +
    'and it keeps going well past any sensible length because nobody put a full stop in it, ' +
    'which a language model will happily do when it lists things one after another';
  const pieces = splitForSpeech(text, { maxChars: 100 });
  if (pieces.length < 2) return `not cut: ${JSON.stringify(pieces)}`;
  for (const p of pieces) {
    if (p.length > 100) return `piece of ${p.length} chars: ${p}`;
  }
  for (const p of pieces.slice(0, -1)) {
    if (!/,$/.test(p)) return `cut away from a comma: ${JSON.stringify(p)}`;
  }
  if (!lossless(text, pieces)) return 'lost text';
  return null;
});

check('with no clause break, a long sentence is cut between words', () => {
  const text = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
  const pieces = splitForSpeech(text, { maxChars: 80 });
  for (const p of pieces) {
    if (p.length > 80) return `piece of ${p.length} chars`;
  }
  const words = pieces.flatMap(p => p.split(' '));
  if (words.some(w => !/^word\d+$/.test(w))) return `a word was split: ${words.find(w => !/^word\d+$/.test(w))}`;
  if (!lossless(text, pieces)) return 'lost text';
  return null;
});

check('a single unbroken token longer than the limit is still cut', () => {
  const text = 'x'.repeat(450);
  const pieces = splitForSpeech(text, { maxChars: 200 });
  if (pieces.some(p => p.length > 200)) return `lengths ${pieces.map(p => p.length)}`;
  if (!lossless(text, pieces)) return 'lost text';
  return null;
});

check('a clause break too near the start is not used', () => {
  // Cutting after "Yes," would leave a 150-character remainder with the same
  // problem, and an absurdly short first piece.
  const text = 'Yes, ' + Array.from({ length: 40 }, () => 'and more').join(' ');
  const pieces = splitForSpeech(text, { maxChars: 100 });
  if (pieces[0] === 'Yes,') return 'cut after "Yes,"';
  return null;
});

check('with a minimum, short sentences join the one after', () => expectPieces(
  "Hi! My voice runs in your browser. Ask me. I'll listen.",
  ['Hi! My voice runs in your browser.', "Ask me. I'll listen."],
  { minChars: 20 },
));

check('with a minimum, a short last sentence joins the one before', () => expectPieces(
  'The download is about 590 MB on a first visit. Okay?',
  ['The download is about 590 MB on a first visit. Okay?'],
  { minChars: 20 },
));

check('with a minimum, text shorter than it is still spoken', () => expectPieces('Hi!', ['Hi!'], { minChars: 35 }));

check('nothing is lost across a realistic reply', () => {
  const text = "Sure! It's MIT licensed and free. Install it with npm install react-ai-voice-avatar, " +
    'then render the component.\n\nThe first visit downloads about 590 MB; after that, your browser keeps the models. ' +
    'Want to know more?';
  const pieces = splitForSpeech(text);
  if (!lossless(text, pieces)) return `lost text: ${JSON.stringify(pieces)}`;
  if (pieces.some(p => p.length > MAX_CHUNK_CHARS)) return 'a piece is over the limit';
  if (pieces[0] !== 'Sure!') return `started with ${JSON.stringify(pieces[0])}`;
  return null;
});

let failures = 0;
for (const { name, fn } of checks) {
  const problem = fn();
  if (problem) {
    console.error(`FAIL  ${name}`);
    console.error(`      ${problem}`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures} speech-chunk check(s) failed.`);
  process.exit(1);
}
console.log(`All ${checks.length} speech-chunk checks passed.`);
