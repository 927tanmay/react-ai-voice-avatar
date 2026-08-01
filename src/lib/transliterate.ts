/**
 * transliterate.ts
 * 
 * Converts Urdu (Nastaliq/Arabic) script to Devanagari Hindi.
 * Since spoken Hindi and Urdu are the same language (Hindustani),
 * there is a clean phonetic mapping between the two scripts.
 * 
 * This is needed because Whisper-base often outputs Hindi speech
 * in Urdu script, since it can't reliably distinguish the two.
 */

// Urdu consonants → Devanagari
const URDU_TO_DEVANAGARI: Record<string, string> = {
  // Basic consonants
  'ا': 'अ',   // alif
  'آ': 'आ',   // alif madda
  'ب': 'ब',   // ba
  'پ': 'प',   // pa
  'ت': 'त',   // ta
  'ٹ': 'ट',   // retroflex ta
  'ث': 'स',   // sa (archaic)
  'ج': 'ज',   // ja
  'چ': 'च',   // cha
  'ح': 'ह',   // ha (pharyngeal)
  'خ': 'ख़',  // kha
  'د': 'द',   // da
  'ڈ': 'ड',   // retroflex da
  'ذ': 'ज़',  // za (archaic)
  'ر': 'र',   // ra
  'ڑ': 'ड़',  // retroflex flap
  'ز': 'ज़',  // za
  'ژ': 'झ',   // zha
  'س': 'स',   // sa
  'ش': 'श',   // sha
  'ص': 'स',   // sa (emphatic)
  'ض': 'ज़',  // za (emphatic)
  'ط': 'त',   // ta (emphatic)
  'ظ': 'ज़',  // za (emphatic)
  'ع': 'अ',   // ain
  'غ': 'ग़',  // ghain
  'ف': 'फ़',  // fa
  'ق': 'क़',  // qaf
  'ک': 'क',   // kaf
  'گ': 'ग',   // gaf
  'ل': 'ल',   // lam
  'م': 'म',   // mim
  'ن': 'न',   // nun
  'ں': 'ं',   // noon ghunna (nasal)
  'و': 'व',   // waw
  'ہ': 'ह',   // ha
  'ھ': '्ह',  // do-chashmi he (aspiration marker)
  'ی': 'य',   // ya
  'ے': 'े',   // bari ye (vowel sound)
  'ئ': 'ई',   // hamza on ye

  // Vowel diacritics (harakat)
  'َ': 'ा',   // zabar → aa matra
  'ِ': 'ि',   // zer → i matra
  'ُ': 'ु',   // pesh → u matra
  'ٰ': 'ा',   // khari zabar → aa matra
  'ً': 'न',   // tanwin (nasalization)
  'ّ': '्',   // tashdid (gemination/halant)

  // Common ligature / special characters
  'ء': '',    // hamza (glottal stop, usually silent in Hindi context)
  'ة': 'ह',   // ta marbuta
  'ؤ': 'ओ',  // hamza on waw

  // Punctuation normalization
  '،': ',',   // Urdu comma
  '؛': ';',   // Urdu semicolon
  '؟': '?',   // Urdu question mark
  '۔': '।',   // Urdu full stop → Devanagari danda

  // Urdu/Eastern Arabic numerals → standard
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

// Common Romanized Hindi words → Devanagari
// These are the words Whisper most frequently romanizes
const ROMANIZED_WORDS: Record<string, string> = {
  'namaste': 'नमस्ते',
  'namaskar': 'नमस्कार',
  'dhanyavaad': 'धन्यवाद',
  'dhanyawad': 'धन्यवाद',
  'shukriya': 'शुक्रिया',
  'haan': 'हाँ',
  'nahi': 'नहीं',
  'kya': 'क्या',
  'hai': 'है',
  'hain': 'हैं',
  'aap': 'आप',
  'main': 'मैं',
  'mujhe': 'मुझे',
  'bharat': 'भारत',
  'india': 'भारत',
  'hindi': 'हिंदी',
  'rajdhani': 'राजधानी',
  'dilli': 'दिल्ली',
  'delhi': 'दिल्ली',
  'mumbai': 'मुंबई',
  'accha': 'अच्छा',
  'theek': 'ठीक',
  'batao': 'बताओ',
  'bolo': 'बोलो',
  'kaise': 'कैसे',
  'kaisa': 'कैसा',
  'kaisi': 'कैसी',
  'achha': 'अच्छा',
};

/**
 * Checks if a string contains Urdu/Arabic script characters.
 */
function containsUrduScript(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

/**
 * Checks if a string is predominantly Latin/ASCII characters.
 */
function isPredominantlyLatin(text: string): boolean {
  const latinChars = text.replace(/[\s\d.,!?;:'"()\-]/g, '').split('').filter(c => /[a-zA-Z]/.test(c)).length;
  const totalChars = text.replace(/[\s\d.,!?;:'"()\-]/g, '').length;
  return totalChars > 0 && (latinChars / totalChars) > 0.5;
}

/**
 * Checks if a string contains Devanagari characters.
 */
function containsDevanagari(text: string): boolean {
  return /[\u0900-\u097F]/.test(text);
}

/**
 * Transliterates Urdu script text to Devanagari.
 * Performs character-by-character mapping with context-aware adjustments.
 */
function urduToDevanagari(text: string): string {
  let result = '';
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    
    if (char in URDU_TO_DEVANAGARI) {
      // Handle alif (ا) context-dependently
      if (char === 'ا') {
        // At the start of a word or after a space, it's a vowel carrier
        const prev = i > 0 ? text[i - 1] : ' ';
        if (prev === ' ' || prev === '\n' || i === 0) {
          result += 'अ';
        } else {
          // Mid-word alif usually indicates long 'aa'
          result += 'ा';
        }
      } else if (char === 'و') {
        // Waw can be 'v', 'o', or 'u' depending on context
        const prev = i > 0 ? text[i - 1] : ' ';
        if (prev === ' ' || prev === '\n' || i === 0) {
          result += 'व';
        } else {
          result += 'ो';
        }
      } else if (char === 'ی') {
        // Ya can be 'y' or 'i' depending on context
        const prev = i > 0 ? text[i - 1] : ' ';
        if (prev === ' ' || prev === '\n' || i === 0) {
          result += 'य';
        } else {
          result += 'ी';
        }
      } else {
        result += URDU_TO_DEVANAGARI[char];
      }
    } else {
      // Keep non-Urdu characters as-is (spaces, Latin chars, etc.)
      result += char;
    }
  }
  
  return result;
}

/**
 * Attempts to transliterate common romanized Hindi words to Devanagari.
 * This handles the case where Whisper outputs "Namaste!" instead of "नमस्ते".
 */
function romanizedToDevanagari(text: string): string {
  let result = text.toLowerCase();
  
  // Sort by length (longest first) to avoid partial replacements
  const sortedWords = Object.entries(ROMANIZED_WORDS)
    .sort(([a], [b]) => b.length - a.length);
  
  for (const [roman, devanagari] of sortedWords) {
    // Use word boundary matching
    const regex = new RegExp(`\\b${roman}\\b`, 'gi');
    result = result.replace(regex, devanagari);
  }
  
  return result;
}

/**
 * Main entry point: normalizes ASR output to Devanagari Hindi.
 * 
 * Strategy:
 * 1. If already Devanagari → return as-is
 * 2. If Urdu script → transliterate to Devanagari
 * 3. If romanized Latin → attempt word-level transliteration
 * 4. Mixed scripts → transliterate Urdu portions, attempt romanized portions
 * 
 * @param text Raw ASR output from Whisper
 * @returns Text normalized toward Devanagari Hindi
 */
export function normalizeToDevanagari(text: string): string {
  if (!text || text.trim().length === 0) return text;
  
  // Case 1: Already in Devanagari — pass through
  if (containsDevanagari(text) && !containsUrduScript(text)) {
    return text;
  }
  
  // Case 2: Contains Urdu script — transliterate
  if (containsUrduScript(text)) {
    const transliterated = urduToDevanagari(text);
    console.log(`[Transliterate] Urdu → Devanagari: "${text}" → "${transliterated}"`);
    return transliterated;
  }
  
  // Case 3: Predominantly Latin — try romanized word lookup
  if (isPredominantlyLatin(text)) {
    const converted = romanizedToDevanagari(text);
    // Check if we actually converted anything
    if (converted !== text.toLowerCase()) {
      console.log(`[Transliterate] Romanized → Devanagari: "${text}" → "${converted}"`);
      return converted;
    }
    // If no known words matched, return original (LLM can handle romanized Hindi)
    console.log(`[Transliterate] Romanized text not in dictionary, passing through: "${text}"`);
    return text;
  }
  
  // Case 4: Mixed or unknown — return as-is
  return text;
}
