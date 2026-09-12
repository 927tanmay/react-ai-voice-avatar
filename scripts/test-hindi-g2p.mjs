/**
 * Checks the Hindi grapheme-to-phoneme converter against words whose
 * pronunciation is not in dispute.
 *
 * Schwa deletion is the rule most likely to regress silently: get it wrong and
 * the output is still valid phonemes, still generates audio, and still sounds
 * like speech. It just sounds like someone spelling Hindi out letter by letter.
 * A listening test catches that; a type checker never will.
 *
 * Run with: node --experimental-strip-types scripts/test-hindi-g2p.mjs
 */
import { hindiToPhonemes } from '../src/lib/hindiG2P.ts';

const cases = [
  // [input, expected phonemes, what it is guarding]
  ['कमल', 'kəməl', 'final schwa dropped, medial one kept'],
  ['नमस्ते', 'nəməsteː', 'conjunct via virama, explicit final vowel'],
  ['भारत', 'bʰaːrət', 'aspirate onset, final schwa dropped'],
  ['समझना', 'səməʤʰnaː', 'medial schwa dropped before a vowel-bearing syllable'],
  ['हिंदी', 'hɪndiː', 'anusvara takes the dental place of the d after it'],
  ['रंग', 'rəŋɡ', 'anusvara takes the velar place of the g after it'],
  ['पसंद', 'pəsənd', 'anusvara plus final schwa deletion together'],
  ['बहुत', 'bəhʊt', 'final schwa dropped after a short vowel'],
  ['मुझे', 'mʊʤʰeː', 'matras leave no schwa to delete'],
  ['एक', 'eːk', 'independent vowel then final schwa deletion'],
  ['रास्ता', 'raːstaː', 'virama conjunct inside the word'],
  ['लड़का', 'ləɽkaː', 'nukta retroflex flap'],
  ['क्या', 'kjaː', 'consonant cluster as a syllable onset'],
  ['अच्छा', 'əʧʧʰaː', 'geminate with aspiration'],
  ['चाँद', 'ʧaː̃d', 'chandrabindu nasalises the vowel'],
  ['धन्यवाद', 'dʰənjʋaːd', 'several conjuncts in one word'],
  // Word-initial schwa must survive, or Hindi gains clusters it does not have.
  ['अगर', 'əɡər', 'word-initial schwa is never dropped'],
];

const KOKORO_VOCAB = new Set(
  ' $;:,.!?—…"()“”̃ʣʥʦʨᵝꭧAIOQSTWYᵊabcdefhijklmnopqrstuvwxyzɑɐɒæβɔɕçɖðʤəɚɛɜɟɡɥɨɪʝɯɰŋɳɲɴøɸθœɹɾɻʁɽʂʃʈʧʊʋʌɣɤχʎʒʔˈˌːʰʲ↓→↗↘ᵻ'
);

let failures = 0;

for (const [input, expected, guarding] of cases) {
  const actual = await hindiToPhonemes(input);
  if (actual !== expected) {
    console.error(`FAIL  ${input}\n      expected ${expected}\n      actual   ${actual}\n      (${guarding})`);
    failures++;
  }
}

// Every symbol the converter can emit must exist in Kokoro's vocabulary, or the
// model receives an unknown token and renders it as noise.
const corpus = [
  'नमस्ते, आप कैसे हैं? मुझे ५० रुपये चाहिए।',
  'ट्रेन छूट गई। क्या आप मदद कर सकते हैं?',
  'ऋषि ने ज्ञान और विज्ञान पढ़ा।',
];
for (const text of corpus) {
  const phonemes = await hindiToPhonemes(text);
  for (const ch of phonemes) {
    if (!KOKORO_VOCAB.has(ch)) {
      console.error(`FAIL  ${text}\n      emitted ${JSON.stringify(ch)} (U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}), which is not in Kokoro's vocabulary`);
      failures++;
    }
  }
}

// Latin runs are delegated, and must not be silently dropped when a phonemiser
// is supplied: Hindi speech code-switches constantly.
const mixed = await hindiToPhonemes('मेरा नाम Tanmay है', {
  phonemizeLatin: async () => 'tˈænmeɪ',
});
if (!mixed.includes('tˈænmeɪ')) {
  console.error(`FAIL  code-switched sentence lost its English word\n      actual ${mixed}`);
  failures++;
}

if (failures > 0) {
  console.error(`\n${failures} Hindi phonemisation check(s) failed.`);
  process.exit(1);
}

console.log(`All ${cases.length + corpus.length + 1} Hindi phonemisation checks passed.`);
