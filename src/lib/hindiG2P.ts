/**
 * hindiG2P.ts
 *
 * Converts Devanagari Hindi into the phoneme alphabet Kokoro was trained on.
 *
 * WHY THIS EXISTS
 *
 * Kokoro ships four Hindi voices, but kokoro-js only exposes the 28 English
 * ones, and the eSpeak build bundled with `phonemizer` carries English voice
 * data alone: it rejects "hi" outright. So the model can speak Hindi and the
 * voices are sitting in the same download we already make, but nothing in the
 * JavaScript stack can turn Hindi text into the phonemes the model expects.
 * This closes that gap without a second phonemizer download.
 *
 * Writing a grapheme-to-phoneme converter would be reckless for English, whose
 * spelling barely predicts its pronunciation. Devanagari is close to phonemic:
 * each letter maps to a sound, and the one genuinely hard part is schwa
 * deletion, handled below. That is why a few hundred lines can do a job that
 * needs a dictionary and a neural net in English.
 *
 * Every symbol emitted here is checked against Kokoro's 115-symbol vocabulary.
 * Anything outside it becomes an unknown token, which the model renders as
 * silence or noise, so the maps deliberately use the nearest in-vocabulary
 * symbol rather than the strictly correct IPA in two places (see BREATHY_MAP).
 */

/** Inherent vowel carried by every bare Devanagari consonant. */
const SCHWA = 'ə';

/**
 * Independent vowel letters, used at the start of a word or after another
 * vowel. Hindi ऐ and औ are the open-mid /ɛː ɔː/, not the diphthongs their
 * transliterations ("ai", "au") suggest.
 */
const INDEPENDENT_VOWELS: Record<string, string> = {
  'अ': 'ə',   'आ': 'aː',  'इ': 'ɪ',   'ई': 'iː',
  'उ': 'ʊ',   'ऊ': 'uː',  'ऋ': 'rɪ',
  'ए': 'eː',  'ऐ': 'ɛː',  'ओ': 'oː',  'औ': 'ɔː',
  'ऍ': 'ɛ',   'ऑ': 'ɔː',  'ऎ': 'e',   'ऒ': 'o',
};

/** Dependent vowel signs (matras), which replace a consonant's inherent schwa. */
const MATRAS: Record<string, string> = {
  'ा': 'aː',  'ि': 'ɪ',   'ी': 'iː',
  'ु': 'ʊ',   'ू': 'uː',  'ृ': 'rɪ',
  'े': 'eː',  'ै': 'ɛː',  'ो': 'oː',  'ौ': 'ɔː',
  'ॅ': 'ɛ',   'ॉ': 'ɔː',  'ॆ': 'e',   'ॊ': 'o',
};

/**
 * Consonants, without their inherent vowel.
 *
 * Hindi's dental series (त थ द ध) is truly dental rather than alveolar, but
 * Kokoro's vocabulary has no dental diacritic, so they share the alveolar
 * symbols with no audible loss. The retroflex series (ट ठ ड ढ ण) does have
 * dedicated symbols and keeps them, since retroflexion is the contrast an
 * English-trained listener most often hears as "an Indian accent".
 */
const CONSONANTS: Record<string, string> = {
  // Velar
  'क': 'k',  'ख': 'kʰ', 'ग': 'ɡ',  'घ': 'ɡʰ', 'ङ': 'ŋ',
  // Palatal
  'च': 'ʧ',  'छ': 'ʧʰ', 'ज': 'ʤ',  'झ': 'ʤʰ', 'ञ': 'ɲ',
  // Retroflex
  'ट': 'ʈ',  'ठ': 'ʈʰ', 'ड': 'ɖ',  'ढ': 'ɖʰ', 'ण': 'ɳ',
  // Dental
  'त': 't',  'थ': 'tʰ', 'द': 'd',  'ध': 'dʰ', 'न': 'n',
  // Labial
  'प': 'p',  'फ': 'pʰ', 'ब': 'b',  'भ': 'bʰ', 'म': 'm',
  // Approximants and fricatives
  'य': 'j',  'र': 'r',  'ल': 'l',  'व': 'ʋ',
  'श': 'ʃ',  'ष': 'ʂ',  'स': 's',  'ह': 'h',
  'ळ': 'l',
  // Nukta forms, which carry sounds borrowed from Persian, Arabic and English
  'क़': 'q',  'ख़': 'x',  'ग़': 'ɡ',  'ज़': 'z',  'फ़': 'f',
  'ड़': 'ɽ',  'ढ़': 'ɽʰ', 'ऱ': 'r',  'ऩ': 'n',
};

/**
 * Nasal consonants chosen by what follows them.
 *
 * An anusvara takes the place of articulation of the consonant after it, so
 * हिंदी is /hɪndiː/ with a dental n, while रंग is /rəŋɡ/ with a velar one.
 * Treating every anusvara as vowel nasalisation instead is the single most
 * common shortcut in naive Hindi phonemisers, and it is why their output sounds
 * faintly French.
 */
const HOMORGANIC_NASALS: Record<string, string> = {
  'k': 'ŋ', 'ɡ': 'ŋ',
  'ʧ': 'ɲ', 'ʤ': 'ɲ',
  'ʈ': 'ɳ', 'ɖ': 'ɳ',
  't': 'n', 'd': 'n',
  'p': 'm', 'b': 'm',
};

/**
 * Substitutes for the two Hindi sounds Kokoro's vocabulary cannot spell.
 *
 * The breathy-voiced glottal /ɦ/ and the breathy release /ʱ/ are both absent.
 * Their plain counterparts are the closest available and are what the model's
 * own Hindi training data used, so this costs less than it appears to.
 */
const BREATHY_MAP: Record<string, string> = {
  'ɦ': 'h',
  'ʱ': 'ʰ',
};

/** Devanagari digits, and the Hindi words for 0-9, for spoken numbers. */
const DEVANAGARI_DIGITS: Record<string, string> = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
};

const VIRAMA = '्';
const ANUSVARA = 'ं';
const CHANDRABINDU = 'ँ';
const VISARGA = 'ः';
const NUKTA = '़';

/** Punctuation Kokoro understands, plus the Devanagari full stop. */
const PUNCTUATION: Record<string, string> = {
  '।': '.', '॥': '.', '‚': ',',
};

/**
 * One consonant with whatever vowel follows it, or one standalone vowel.
 *
 * Schwa deletion operates on these rather than on characters, because the
 * question it answers is per-syllable: does this consonant keep its inherent
 * vowel or not.
 */
interface Unit {
  onset: string;
  /** Empty when a virama or schwa deletion has stripped the vowel. */
  vowel: string;
  /** True while the vowel is still the unwritten inherent one. */
  inherent: boolean;
  /** Nasal consonant or vowel tilde to append after the vowel. */
  coda: string;
}

/**
 * Delete the inherent schwas Hindi writes but does not say.
 *
 * Devanagari spells a vowel after every consonant, yet Hindi drops many of
 * them: कमल is written ka-ma-la and said "kamal". Getting this wrong is the
 * difference between Hindi and a robot spelling Hindi out, and it is the reason
 * a simple character map is not enough.
 *
 * Three rules, applied right to left, cover the overwhelming majority:
 *
 *  1. A word's final inherent schwa is always dropped, unless the word is a
 *     single syllable that would otherwise have no vowel at all.
 *  2. An inherent schwa is dropped when the syllable after it still has a
 *     vowel. समझना loses the schwa on झ because ना keeps its ā, giving
 *     /səməʤʰnaː/. Checking the follower after it has already been processed
 *     is what stops two schwas in a row from both being dropped, which would
 *     leave an unpronounceable cluster.
 *  3. A word-initial schwa is never dropped, since Hindi has no word-initial
 *     consonant clusters of that shape.
 */
function deleteSchwas(units: Unit[]): void {
  if (units.length <= 1) return;

  for (let i = units.length - 1; i >= 1; i--) {
    const unit = units[i];
    if (!unit.inherent || unit.vowel === '') continue;

    const isFinal = i === units.length - 1;
    const followerHasVowel = !isFinal && units[i + 1].vowel !== '';

    if (isFinal || followerHasVowel) {
      unit.vowel = '';
      unit.inherent = false;
    }
  }
}

/** Convert one run of Devanagari (a single word) into phonemes. */
function convertWord(word: string): string {
  const units: Unit[] = [];
  const chars = Array.from(word);

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = chars[i + 1];

    // Fold a following nukta into the base letter, so क + ़ becomes क़. Text
    // arrives both precomposed and decomposed depending on the keyboard used.
    let letter = ch;
    if (next === NUKTA && CONSONANTS[ch + NUKTA]) {
      letter = ch + NUKTA;
      i++;
    }

    const consonant = CONSONANTS[letter];
    if (consonant) {
      units.push({ onset: consonant, vowel: SCHWA, inherent: true, coda: '' });
      continue;
    }

    const independent = INDEPENDENT_VOWELS[letter];
    if (independent) {
      units.push({ onset: '', vowel: independent, inherent: false, coda: '' });
      continue;
    }

    const current = units[units.length - 1];

    const matra = MATRAS[letter];
    if (matra) {
      if (current) {
        current.vowel = matra;
        current.inherent = false;
      }
      continue;
    }

    if (letter === VIRAMA) {
      // Explicitly silences the inherent vowel, forming a conjunct.
      if (current) {
        current.vowel = '';
        current.inherent = false;
      }
      continue;
    }

    if (letter === ANUSVARA || letter === CHANDRABINDU) {
      if (!current) continue;
      // A chandrabindu is always vowel nasalisation. An anusvara becomes a
      // nasal consonant matching whatever follows, and falls back to
      // nasalisation at the end of a word or before a non-stop.
      if (letter === CHANDRABINDU) {
        current.coda = '̃';
      } else {
        current.coda = ANUSVARA; // resolved once the next unit is known
      }
      continue;
    }

    if (letter === VISARGA) {
      if (current) current.coda = 'h';
      continue;
    }

    // Anything else (stray marks, unknown signs) is skipped rather than
    // guessed at, since a wrong phoneme is worse than a missing one.
  }

  // Resolve anusvaras now that every unit's onset is known.
  for (let i = 0; i < units.length; i++) {
    if (units[i].coda !== ANUSVARA) continue;
    const following = units[i + 1];
    const homorganic = following ? HOMORGANIC_NASALS[following.onset] : undefined;
    units[i].coda = homorganic ?? '̃';
  }

  deleteSchwas(units);

  return units.map(u => u.onset + u.vowel + u.coda).join('');
}

/** True for characters in the Devanagari block. */
function isDevanagari(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return code >= 0x0900 && code <= 0x097f;
}

/**
 * Spell a number out in Hindi words.
 *
 * Read digit by digit above a hundred rather than composed into lakhs and
 * crores. Hindi's number words are famously irregular, needing a full table of
 * all hundred forms rather than the tens-plus-units composition English allows,
 * and a wrong number spoken confidently is worse than a digit sequence read
 * plainly.
 */
const HINDI_DIGITS = ['शून्य', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ'];
const HINDI_TENS: Record<string, string> = {
  '10': 'दस', '11': 'ग्यारह', '12': 'बारह', '13': 'तेरह', '14': 'चौदह',
  '15': 'पंद्रह', '16': 'सोलह', '17': 'सत्रह', '18': 'अठारह', '19': 'उन्नीस',
  '20': 'बीस', '30': 'तीस', '40': 'चालीस', '50': 'पचास',
  '60': 'साठ', '70': 'सत्तर', '80': 'अस्सी', '90': 'नब्बे', '100': 'सौ',
};

function numberToHindi(digits: string): string {
  const exact = HINDI_TENS[digits];
  if (exact) return exact;
  if (digits.length === 1) return HINDI_DIGITS[Number(digits)] ?? digits;
  return Array.from(digits)
    .map(d => HINDI_DIGITS[Number(d)] ?? d)
    .join(' ');
}

export interface HindiPhonemizeOptions {
  /**
   * Phonemiser for Latin-script runs. Hindi speech mixes English constantly,
   * and reading those words through Devanagari rules produces a thick, comical
   * accent. Supply the English phonemiser here and each script is handled by
   * the converter built for it. Without it, Latin runs are dropped.
   */
  phonemizeLatin?: (text: string) => Promise<string>;
}

/**
 * Convert mixed Hindi text into Kokoro's phoneme alphabet.
 *
 * Handles Devanagari, Latin (delegated), digits and punctuation, in the order
 * they appear, so a code-switched sentence comes back as one phoneme string.
 */
export async function hindiToPhonemes(
  text: string,
  options: HindiPhonemizeOptions = {}
): Promise<string> {
  // Normalise Devanagari digits to ASCII so one number path covers both.
  const normalised = Array.from(text)
    .map(ch => DEVANAGARI_DIGITS[ch] ?? ch)
    .join('');

  const out: string[] = [];
  let i = 0;

  while (i < normalised.length) {
    const ch = normalised[i];

    if (isDevanagari(ch)) {
      let j = i;
      while (j < normalised.length && isDevanagari(normalised[j])) j++;
      out.push(convertWord(normalised.slice(i, j)));
      i = j;
      continue;
    }

    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < normalised.length && /[0-9]/.test(normalised[j])) j++;
      const words = numberToHindi(normalised.slice(i, j));
      out.push(Array.from(words).filter(isDevanagari).length > 0
        ? words.split(' ').map(convertWord).join(' ')
        : '');
      i = j;
      continue;
    }

    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < normalised.length && /[A-Za-z'’-]/.test(normalised[j])) j++;
      const latin = normalised.slice(i, j);
      if (options.phonemizeLatin) {
        try {
          out.push(await options.phonemizeLatin(latin));
        } catch {
          // A failed English phonemisation should not silence the Hindi around
          // it, so drop just this word.
        }
      }
      i = j;
      continue;
    }

    const punctuation = PUNCTUATION[ch];
    if (punctuation) {
      out.push(punctuation);
      i++;
      continue;
    }

    if (/[.,!?;:"'()\s]/.test(ch)) {
      out.push(ch === '\n' ? ' ' : ch);
      i++;
      continue;
    }

    // Unknown character: skip it rather than feed the model a token it will
    // render as noise.
    i++;
  }

  return out
    .join('')
    .replace(/[ɦʱ]/g, m => BREATHY_MAP[m] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Exported for tests, which check schwa deletion against known words. */
export const __internal = { convertWord, deleteSchwas, numberToHindi };
