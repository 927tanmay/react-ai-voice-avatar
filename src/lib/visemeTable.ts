/**
 * visemeTable.ts
 *
 * Universal character-to-viseme mapping for speech-driven lip animation.
 *
 * DESIGN: Language-agnostic — maps individual characters (Latin, Devanagari,
 * and any future script) to one of ~15 canonical viseme shapes. Adding a new
 * language is as simple as appending its character → viseme entries to the
 * lookup table; no structural changes are needed.
 *
 * Each viseme resolves to a set of ARKit blend shape weights that can be
 * written directly into a Ready Player Me / Wolf3D mesh's morphTargetInfluences.
 *
 * Retroflex and aspirated Indic consonants receive dedicated shapes that are
 * distinct from their dental/unaspirated counterparts — this is the project's
 * core lip-sync differentiator claim.
 */

// ─── Canonical Viseme Identifiers ───────────────────────────────────────────

export type VisemeId =
  | 'sil'       // Silence / rest / closed mouth
  | 'PP'        // Bilabial plosive: p, b, m  (lips pressed together)
  | 'FF'        // Labiodental fricative: f, v  (lower lip against upper teeth)
  | 'TH'        // Dental fricative: th, dh  (tongue tip visible between teeth)
  | 'DD'        // Alveolar stop: t, d, n, l  (tongue touches alveolar ridge)
  | 'DD_RETRO'  // Retroflex stop: ट, ठ, ड, ढ, ण  (tongue curled back)
  | 'KK'        // Velar stop: k, g, ng  (back of tongue)
  | 'CH'        // Post-alveolar affricate: ch, j, sh, zh  (tongue raised behind ridge)
  | 'SS'        // Alveolar sibilant: s, z  (narrow tongue channel)
  | 'NN'        // Nasal: n, m, ng, anusvara  (mouth partially closed, airflow through nose)
  | 'RR'        // Rhotic: r  (tongue tap or trill)
  | 'AA'        // Open vowel: a, aa, ah  (jaw wide open)
  | 'EE'        // Close front vowel: ee, i  (lips spread)
  | 'IH'        // Near-close front: short i  (slightly less spread)
  | 'OH'        // Mid back rounded: o  (lips rounded, medium opening)
  | 'OO'        // Close back rounded: oo, u  (lips tightly rounded)
  | 'ASPIRATE'; // Aspirated release: kh, gh, th, dh, ph, bh  (wider opening, burst airflow)

// ─── ARKit Blend Shape Weights Per Viseme ───────────────────────────────────
//
// Each viseme maps to a set of morph target influences (0–1).
// Only non-zero targets are listed; all others are implicitly 0.
// Weights are tuned for Ready Player Me / Wolf3D ARKit face rigs.

export interface VisemeWeights {
  jawOpen: number;
  mouthClose: number;
  mouthFunnel: number;
  mouthPucker: number;
  mouthSmileLeft: number;
  mouthSmileRight: number;
  mouthStretchLeft: number;
  mouthStretchRight: number;
  mouthRollLower: number;
  mouthRollUpper: number;
  mouthShrugLower: number;
  mouthShrugUpper: number;
  mouthPressLeft: number;
  mouthPressRight: number;
  mouthLowerDownLeft: number;
  mouthLowerDownRight: number;
  mouthUpperUpLeft: number;
  mouthUpperUpRight: number;
  tongueOut: number;
}

const W0: VisemeWeights = {
  jawOpen: 0, mouthClose: 0, mouthFunnel: 0, mouthPucker: 0,
  mouthSmileLeft: 0, mouthSmileRight: 0, mouthStretchLeft: 0, mouthStretchRight: 0,
  mouthRollLower: 0, mouthRollUpper: 0, mouthShrugLower: 0, mouthShrugUpper: 0,
  mouthPressLeft: 0, mouthPressRight: 0, mouthLowerDownLeft: 0, mouthLowerDownRight: 0,
  mouthUpperUpLeft: 0, mouthUpperUpRight: 0, tongueOut: 0,
};

function w(overrides: Partial<VisemeWeights>): VisemeWeights {
  return { ...W0, ...overrides };
}

export const VISEME_WEIGHTS: Record<VisemeId, VisemeWeights> = {
  // ── Silence ──
  sil: w({ mouthClose: 0.1 }),

  // ── Bilabial (p, b, m) — lips pressed together ──
  PP: w({ mouthClose: 0.7, mouthPressLeft: 0.4, mouthPressRight: 0.4 }),

  // ── Labiodental (f, v) — lower lip tucked under upper teeth ──
  FF: w({
    jawOpen: 0.1, mouthFunnel: 0.3,
    mouthUpperUpLeft: 0.2, mouthUpperUpRight: 0.2,
    mouthRollLower: 0.3,
  }),

  // ── Dental fricative (English th, Hindi dental t/d) — tongue tip peeks ──
  TH: w({
    jawOpen: 0.15, tongueOut: 0.3,
    mouthLowerDownLeft: 0.1, mouthLowerDownRight: 0.1,
  }),

  // ── Alveolar stop (t, d, n, l) — tongue behind upper teeth, modest opening ──
  DD: w({
    jawOpen: 0.2, mouthStretchLeft: 0.1, mouthStretchRight: 0.1,
    mouthShrugUpper: 0.15,
  }),

  // ── Retroflex stop (ट, ठ, ड, ढ, ण) — tongue curled back, wider jaw, lips neutral ──
  // Distinct from DD: more jaw drop, slight lip retraction, no tongue visibility
  DD_RETRO: w({
    jawOpen: 0.3, mouthStretchLeft: 0.15, mouthStretchRight: 0.15,
    mouthShrugLower: 0.15, mouthRollLower: 0.1,
  }),

  // ── Velar stop (k, g, ng) — back of tongue rises, minimal lip movement ──
  KK: w({
    jawOpen: 0.15, mouthShrugLower: 0.1, mouthShrugUpper: 0.1,
  }),

  // ── Post-alveolar affricate (ch, j, sh, zh) — lips slightly rounded & pushed forward ──
  CH: w({
    jawOpen: 0.15, mouthFunnel: 0.35, mouthPucker: 0.15,
    mouthShrugUpper: 0.1,
  }),

  // ── Alveolar sibilant (s, z) — narrow opening, lips slightly stretched ──
  SS: w({
    jawOpen: 0.05, mouthStretchLeft: 0.25, mouthStretchRight: 0.25,
    mouthSmileLeft: 0.1, mouthSmileRight: 0.1,
  }),

  // ── Nasal (n, m, anusvara) — lips loosely closed, air through nose ──
  NN: w({
    mouthClose: 0.4, mouthPressLeft: 0.2, mouthPressRight: 0.2,
    mouthShrugLower: 0.1,
  }),

  // ── Rhotic (r, ɹ) — lips slightly open, tongue vibrating ──
  RR: w({
    jawOpen: 0.2, mouthFunnel: 0.15, mouthShrugUpper: 0.1,
  }),

  // ── Open vowel (a, aa, अ, आ) — jaw wide open ──
  AA: w({
    jawOpen: 0.6, mouthLowerDownLeft: 0.2, mouthLowerDownRight: 0.2,
    mouthStretchLeft: 0.1, mouthStretchRight: 0.1,
  }),

  // ── Close front vowel (ee, i, ई, इ) — lips spread laterally ──
  EE: w({
    jawOpen: 0.15, mouthSmileLeft: 0.35, mouthSmileRight: 0.35,
    mouthStretchLeft: 0.2, mouthStretchRight: 0.2,
  }),

  // ── Near-close front (short i, इ) — slightly less spread than EE ──
  IH: w({
    jawOpen: 0.2, mouthSmileLeft: 0.2, mouthSmileRight: 0.2,
    mouthStretchLeft: 0.1, mouthStretchRight: 0.1,
  }),

  // ── Mid back rounded (o, ओ) — lips rounded, medium opening ──
  OH: w({
    jawOpen: 0.35, mouthFunnel: 0.25, mouthPucker: 0.15,
  }),

  // ── Close back rounded (oo, u, ऊ, उ) — lips tightly pursed ──
  OO: w({
    jawOpen: 0.1, mouthFunnel: 0.45, mouthPucker: 0.4,
  }),

  // ── Aspirated release (kh, gh, ph, bh etc) — burst airflow, wider clearance ──
  // Distinct from base consonant: extra jaw drop + lip outward push
  ASPIRATE: w({
    jawOpen: 0.35, mouthFunnel: 0.2, mouthShrugLower: 0.2,
    mouthShrugUpper: 0.15, mouthLowerDownLeft: 0.1, mouthLowerDownRight: 0.1,
  }),
};

// ─── Character → Viseme Lookup ──────────────────────────────────────────────
//
// Universal table covering Latin (English) and Devanagari (Hindi) characters.
// The table is intentionally flat for O(1) lookup in the animation loop.
// To add a new script (Tamil, Telugu, Bangla, Gujarati…), just append entries.

const CHAR_TO_VISEME: Record<string, VisemeId> = {
  // ── Latin (English) ──────────────────────────────────────────────────────
  // Vowels
  'a': 'AA', 'e': 'EE', 'i': 'IH', 'o': 'OH', 'u': 'OO',

  // Bilabials
  'p': 'PP', 'b': 'PP', 'm': 'PP',

  // Labiodentals
  'f': 'FF', 'v': 'FF',

  // Dental / alveolar
  't': 'DD', 'd': 'DD', 'n': 'NN', 'l': 'DD',

  // Velar
  'k': 'KK', 'g': 'KK',

  // Post-alveolar / affricates
  'c': 'KK', 'j': 'CH', 'x': 'KK', 'q': 'KK',

  // Sibilants / fricatives
  's': 'SS', 'z': 'SS',

  // Rhotic
  'r': 'RR',

  // Approximants
  'w': 'OO', 'y': 'EE',

  // Glottal / other
  'h': 'ASPIRATE',

  // ── Devanagari Vowels (Hindi) ────────────────────────────────────────────
  'अ': 'AA',   // a
  'आ': 'AA',   // aa
  'इ': 'IH',   // i (short)
  'ई': 'EE',   // ii (long)
  'उ': 'OO',   // u (short)
  'ऊ': 'OO',   // uu (long)
  'ए': 'EE',   // e
  'ऐ': 'AA',   // ai (diphthong, jaw-open component)
  'ओ': 'OH',   // o
  'औ': 'OH',   // au (diphthong)
  'ऋ': 'RR',   // ri (vocalic r)

  // Devanagari vowel matras (combining marks)
  'ा': 'AA',   // aa matra
  'ि': 'IH',   // i matra
  'ी': 'EE',   // ii matra
  'ु': 'OO',   // u matra
  'ू': 'OO',   // uu matra
  'े': 'EE',   // e matra
  'ै': 'AA',   // ai matra
  'ो': 'OH',   // o matra
  'ौ': 'OH',   // au matra
  'ृ': 'RR',   // ri matra

  // ── Devanagari Consonants — Velar (ka-varga) ─────────────────────────────
  'क': 'KK',         // ka
  'ख': 'ASPIRATE',   // kha (aspirated)
  'ग': 'KK',         // ga
  'घ': 'ASPIRATE',   // gha (aspirated)
  'ङ': 'NN',         // nga (nasal)

  // ── Palatal (cha-varga) ──────────────────────────────────────────────────
  'च': 'CH',         // cha
  'छ': 'ASPIRATE',   // chha (aspirated)
  'ज': 'CH',         // ja
  'झ': 'ASPIRATE',   // jha (aspirated)
  'ञ': 'NN',         // nya (nasal)

  // ── Retroflex (ṭa-varga) — DISTINCT shape ────────────────────────────────
  'ट': 'DD_RETRO',   // ṭa (retroflex t)
  'ठ': 'ASPIRATE',   // ṭha (retroflex aspirated — combines retro position + airflow burst)
  'ड': 'DD_RETRO',   // ḍa (retroflex d)
  'ढ': 'ASPIRATE',   // ḍha (retroflex aspirated)
  'ण': 'DD_RETRO',   // ṇa (retroflex nasal)

  // ── Dental (ta-varga) ────────────────────────────────────────────────────
  'त': 'TH',         // ta (dental — tongue tip touches teeth, not alveolar ridge)
  'थ': 'ASPIRATE',   // tha (dental aspirated)
  'द': 'TH',         // da (dental)
  'ध': 'ASPIRATE',   // dha (dental aspirated)
  'न': 'NN',         // na (dental nasal)

  // ── Labial (pa-varga) ────────────────────────────────────────────────────
  'प': 'PP',         // pa
  'फ': 'ASPIRATE',   // pha (aspirated — NOT English 'f', but puff of air)
  'ब': 'PP',         // ba
  'भ': 'ASPIRATE',   // bha (aspirated)
  'म': 'PP',         // ma

  // ── Semi-vowels / Approximants ───────────────────────────────────────────
  'य': 'EE',   // ya
  'र': 'RR',   // ra
  'ल': 'DD',   // la
  'व': 'FF',   // va/wa (labiodental in standard Hindi)

  // ── Sibilants & Glottal ──────────────────────────────────────────────────
  'श': 'CH',   // sha (palatal sibilant — lip shape similar to English sh)
  'ष': 'SS',   // ṣha (retroflex sibilant)
  'स': 'SS',   // sa (dental sibilant)
  'ह': 'ASPIRATE', // ha (glottal)

  // ── Special Characters ───────────────────────────────────────────────────
  'ं': 'NN',   // anusvara (nasalization)
  'ँ': 'NN',   // chandrabindu (nasalization)
  'ः': 'ASPIRATE', // visarga (aspiration)
  '्': 'sil',  // halant/virama (suppresses vowel — silence/transition)

  // ── Nukta Variants (Perso-Arabic loans in Hindi) ─────────────────────────
  'क़': 'KK',
  'ख़': 'ASPIRATE',
  'ग़': 'KK',
  'ज़': 'SS',   // za — closer to sibilant articulation
  'फ़': 'FF',   // fa — true labiodental f (English-like)
  'ड़': 'DD_RETRO', // ṛa (retroflex flap)
  'ढ़': 'ASPIRATE', // ṛha (retroflex aspirated flap)

  // ── IPA (International Phonetic Alphabet) used by eSpeak-ng / Kokoro ──────
  'ə': 'AA', 'ʌ': 'AA', 'æ': 'AA', 'ɑ': 'AA', 'ɒ': 'AA', 'ɐ': 'AA',
  'ɪ': 'IH', 'ɛ': 'IH',
  'ʊ': 'OO', 'ɔ': 'OH',
  'θ': 'TH', 'ð': 'TH',
  'ʃ': 'CH', 'ʒ': 'CH', 'ʧ': 'CH', 'ʤ': 'CH',
  'ŋ': 'NN',
  'ɹ': 'RR', 'ɾ': 'RR',
  'ˈ': 'sil', 'ˌ': 'sil', 'ː': 'sil', 'ˑ': 'sil', // Stress and length markers
};

/**
 * Look up the viseme for a single character.
 * Returns 'sil' for unmapped characters (whitespace, punctuation, unknown scripts).
 */
export function getVisemeForChar(char: string): VisemeId {
  // Normalize to lowercase for Latin script
  const key = char.length === 1 ? char.toLowerCase() : char;
  return CHAR_TO_VISEME[key] ?? 'sil';
}

/**
 * Get the full ARKit blend shape weights for a character.
 */
export function getVisemeWeights(char: string): VisemeWeights {
  return VISEME_WEIGHTS[getVisemeForChar(char)];
}

/**
 * Decompose a text string into an ordered array of viseme IDs.
 * Useful for building timing profiles in phonemeTiming.ts.
 */
export function textToVisemeSequence(text: string): VisemeId[] {
  const result: VisemeId[] = [];
  for (const char of text) {
    result.push(getVisemeForChar(char));
  }
  return result;
}

/**
 * Check if a viseme represents an aspirated articulation.
 * Used by the hybrid audio-text blender to scale burst energy.
 */
export function isAspiratedViseme(id: VisemeId): boolean {
  return id === 'ASPIRATE';
}

/**
 * Check if a viseme represents a retroflex articulation.
 * Used by the hybrid blender to apply distinct tongue-curled mouth shapes.
 */
export function isRetroflexViseme(id: VisemeId): boolean {
  return id === 'DD_RETRO';
}

// Re-export the raw lookup for advanced usage
export { CHAR_TO_VISEME };
