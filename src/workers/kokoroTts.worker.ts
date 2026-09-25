import { pipeline, env as transformersEnv } from '@huggingface/transformers';
import { createDownloadProgress } from '../lib/downloadProgress';
import { createModelCache, isModelCacheSupported, modelFileLabel } from '../lib/modelCache';
// Prevent esbuild from tree-shaking the ONNX Runtime WASM backend registration side-effects
if (typeof self !== 'undefined' && self.location && self.location.href && self.location.href.includes('prevent-tree-shaking')) {
  console.log(pipeline);
}

// The voice is a single ~310 MB file, over the 256 MiB the Cache API will store,
// so without this it was downloaded again on every visit. kokoro-js loads it
// through this same transformers.js instance — the package's `overrides` pin it
// to one copy — so setting the cache here covers the voice. See modelCache.ts.
if (isModelCacheSupported()) {
  transformersEnv.useCustomCache = true;
  transformersEnv.customCache = createModelCache({
    onStoreFailed: (key, reason) => {
      self.postMessage({ type: 'modelStorage', payload: { message: `${modelFileLabel(key)}: ${reason}` } });
    },
  });
}

// Silence benign ONNX Runtime optimization notices (e.g. shape node fallbacks to CPU EP) in DevTools console
const origWarn = console.warn;
const origError = console.error;
const isBenignOrtNotice = (...args: any[]) => {
  const str = args.map(a => (typeof a === 'string' ? a : (a?.message || ''))).join(' ');
  return str.includes('VerifyEachNodeIsAssignedToAnEp') || str.includes('preferred execution providers');
};
console.warn = (...args: any[]) => { if (!isBenignOrtNotice(...args)) origWarn.apply(console, args as any); };
console.error = (...args: any[]) => { if (!isBenignOrtNotice(...args)) origError.apply(console, args as any); };

let KokoroTTS: any = null;
let kokoroTts: any = null;
let currentVoice: string = 'af_heart';
let currentLanguage: string = 'en-US';

const ttsQueue: Array<{ text: string; isLast: boolean; isEndMarker?: boolean }> = [];
let isTtsProcessing = false;

const DEFAULT_VOICE = 'af_heart';

/**
 * Voices the model has but kokoro-js does not list.
 *
 * The wrapper exposes 28 English voices. The checkpoint it downloads carries 55
 * embeddings across nine languages, and generate_from_ids() loads a voice by
 * name without validating it, so these are reachable with no fork and no extra
 * download. Only Hindi is wired up here because only Hindi has a phonemiser in
 * this package; the rest are listed so the next language is a smaller step.
 *
 * See src/lib/hindiG2P.ts for why the English phonemiser cannot do this job.
 */
const EXTENDED_VOICES: Record<string, { language: string; gender: string }> = {
  hf_alpha: { language: 'hi-IN', gender: 'Female' },
  hf_beta: { language: 'hi-IN', gender: 'Female' },
  hm_omega: { language: 'hi-IN', gender: 'Male' },
  hm_psi: { language: 'hi-IN', gender: 'Male' },
};

/** Default voice per language, used when none is named. */
const DEFAULT_VOICE_BY_LANGUAGE: Record<string, string> = {
  'en-US': 'af_heart',
  'en-GB': 'bf_emma',
  'hi-IN': 'hf_alpha',
};

/** Languages this worker can synthesise, as opposed to voices it can load. */
const SUPPORTED_LANGUAGES = new Set(['en-US', 'en-GB', 'hi-IN']);

/**
 * Check a voice name against the engine's own table.
 *
 * Without this, an unknown voice reaches generate(), throws deep inside the
 * engine, gets swallowed by the chunk error handler, and the avatar simply
 * goes silent with no explanation. Fall back to the default voice so audio
 * keeps working, and name the valid options so the mistake is obvious.
 */
const resolveVoice = (voice: string): string => {
  const table = kokoroTts?.voices;
  if (!table) return voice;
  if (Object.prototype.hasOwnProperty.call(table, voice)) return voice;
  if (Object.prototype.hasOwnProperty.call(EXTENDED_VOICES, voice)) return voice;

  const fallback = DEFAULT_VOICE_BY_LANGUAGE[currentLanguage] ?? DEFAULT_VOICE;
  console.error(
    `[AiVoiceAvatar] ttsVoice "${voice}" is not a Kokoro voice, so "${fallback}" will be used instead. ` +
    `Available voices: ${[...Object.keys(table), ...Object.keys(EXTENDED_VOICES)].join(', ')}`
  );
  return fallback;
};

/**
 * Pick the voice to speak a language in.
 *
 * A voice carries its own language in Kokoro, so an English voice reading Hindi
 * phonemes produces something no one wants. When the caller names a voice that
 * does not match the language they asked for, the language wins: they were more
 * likely to have set one and forgotten the other.
 */
const resolveVoiceForLanguage = (voice: string, language: string): string => {
  const declared = EXTENDED_VOICES[voice]?.language
    ?? (kokoroTts?.voices?.[voice]?.language === 'en-gb' ? 'en-GB' : undefined)
    ?? (kokoroTts?.voices?.[voice] ? 'en-US' : undefined);

  if (declared && declared !== language) {
    const corrected = DEFAULT_VOICE_BY_LANGUAGE[language];
    if (corrected) {
      console.warn(
        `[AiVoiceAvatar] ttsVoice "${voice}" speaks ${declared}, but ttsLanguage is "${language}". ` +
        `Using "${corrected}" instead. Pass a matching voice to silence this.`
      );
      return corrected;
    }
  }
  return voice;
};

/**
 * Turn text into the phonemes Kokoro expects.
 *
 * English goes through kokoro-js's own generate(), which phonemises internally.
 * Hindi cannot: the bundled eSpeak build carries English voice data only and
 * rejects "hi", so the phonemes are built here and fed to generate_from_ids(),
 * which skips phonemisation and voice validation alike.
 */
const phonemizeHindi = async (text: string): Promise<string> => {
  const { hindiToPhonemes } = await import('../lib/hindiG2P');
  const { phonemize } = await import('phonemizer');
  return hindiToPhonemes(text, {
    // Hindi speech is full of English words, and reading them through
    // Devanagari rules gives a thick, comical accent. Each script gets the
    // converter built for it.
    phonemizeLatin: async (latin: string) => (await phonemize(latin, 'en-us')).join(' '),
  });
};

/**
 * Keep samples inside the range a Web Audio buffer can hold.
 *
 * Kokoro's output regularly peaks above 1.0. Those samples clip audibly on the
 * way into an AudioBuffer, as a crackle on the loudest syllables. Scaling the
 * whole chunk by its own peak preserves the waveform's shape, where clamping
 * each sample would flatten exactly the peaks that carry the consonants.
 */
const normalizePeaks = (audio: Float32Array): Float32Array => {
  let peak = 0;
  for (let i = 0; i < audio.length; i++) {
    const abs = Math.abs(audio[i]);
    if (abs > peak) peak = abs;
  }
  if (peak <= 1) return audio;

  const scale = 0.99 / peak;
  for (let i = 0; i < audio.length; i++) audio[i] *= scale;
  return audio;
};

/**
 * Symbols read aloud as words, per script.
 *
 * Reading "50% off" as "fifty percent off" inside an otherwise Hindi sentence
 * is the kind of seam that makes a demo feel machine-translated.
 */
interface SymbolWords {
  percent: string; and: string; plus: string; equals: string; at: string;
  dollars: string; rupees: string;
}
const ENGLISH_WORDS: SymbolWords = {
  percent: ' percent', and: ' and ', plus: ' plus ', equals: ' equals ', at: ' at ',
  dollars: ' dollars', rupees: ' rupees',
};
const HINDI_WORDS: SymbolWords = {
  percent: ' प्रतिशत', and: ' और ', plus: ' प्लस ', equals: ' बराबर ', at: ' पर ',
  dollars: ' डॉलर', rupees: ' रुपये',
};

const DEVANAGARI = /[ऀ-ॿ]/;
const LATIN = /[A-Za-z]/;

/**
 * Pick the spoken form of a symbol from the script it is embedded in.
 *
 * Choosing by the session's language instead produced the worst of both: with
 * Hindi selected, an English sentence came out as "100 प्रतिशत client-side",
 * which is neither language and is unreadable to either phonemiser. What
 * matters is the script immediately around the symbol, since Hindi text mixes
 * English freely and both halves have to be read correctly.
 */
const wordsAround = (text: string, index: number): SymbolWords => {
  const window = text.slice(Math.max(0, index - 24), index + 24);
  if (DEVANAGARI.test(window)) return HINDI_WORDS;
  if (LATIN.test(window)) return ENGLISH_WORDS;
  // A bare number with no surrounding words: fall back to the session language.
  return currentLanguage === 'hi-IN' ? HINDI_WORDS : ENGLISH_WORDS;
};

const sanitizeForSpeech = (text: string): string => {
  return text
    // Strip pictographs and emojis to prevent vocal hallucination babble
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Presentation}/gu, '')
    // Remove markdown formatting: bold (**), italics (* or _), strikethroughs (~~), backticks
    .replace(/(\*{1,3}|_{1,3}|~~|`+)/g, '')
    // Remove markdown link syntax [label](url) -> label
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove headers (#), list bullets (-, *, +), blockquotes (>) at start of lines
    .replace(/^[#*+\->]\s+/gm, '')
    .replace(/^\d+[.)]\s+/gm, '')
    // Convert hyphenated numeric ranges (e.g., 620-800) into words for smooth TTS prosody ("620 to 800")
    .replace(/(\b\d+)\s*-\s*(\d+\b)/g, '$1 to $2')
    // Convert common symbols to words for better TTS prosody
    .replace(/%/g, (_m, i: number, s: string) => wordsAround(s, i).percent)
    .replace(/&/g, (_m, i: number, s: string) => wordsAround(s, i).and)
    .replace(/\+/g, (_m, i: number, s: string) => wordsAround(s, i).plus)
    .replace(/=/g, (_m, i: number, s: string) => wordsAround(s, i).equals)
    .replace(/@/g, (_m, i: number, s: string) => wordsAround(s, i).at)
    // The currency name comes from the symbol, never from the session language:
    // a dollar is a dollar in a Hindi sentence and a rupee is a rupee in an
    // English one.
    .replace(/\$([\d,.]+)/g, (_m, n: string, i: number, s: string) => `${n}${wordsAround(s, i).dollars}`)
    .replace(/₹([\d,.]+)/g, (_m, n: string, i: number, s: string) => `${n}${wordsAround(s, i).rupees}`)
    // Replace stray markdown dividers or underlines
    .replace(/[-=]{3,}/g, ' ')
    // Clean up excessive spacing and trim
    .replace(/\s+/g, ' ')
    .trim();
};

const processTtsQueue = async () => {
  if (isTtsProcessing || !kokoroTts) return;
  isTtsProcessing = true;

  while (ttsQueue.length > 0) {
    const item = ttsQueue.shift()!;
    if (item.isEndMarker) {
      self.postMessage({ type: 'speechEnd' });
      continue;
    }
    const cleanText = sanitizeForSpeech(item.text);
    if (!cleanText || cleanText.length === 0) {
      if (item.isLast) {
        self.postMessage({ type: 'speechEnd' });
      } else {
        // Emit an empty speechOutput chunk so the main thread doesn't stall waiting for a dropped non-last chunk
        self.postMessage({
          type: 'speechOutput',
          payload: { audio: new Float32Array(0), sampleRate: 24000, text: '', phonemes: '', isLast: false }
        });
      }
      continue;
    }

    try {
      let ttsResult: any = null;
      let phonemesUsed = '';
      let generateRetries = 0;
      while (generateRetries < 5) {
        try {
          const voice = currentVoice || DEFAULT_VOICE;

          // Hindi is phonemised here and handed to generate_from_ids(), which
          // takes token ids directly. English goes through generate(), which
          // phonemises with the eSpeak build kokoro-js bundles.
          const generation = currentLanguage === 'hi-IN'
            ? (async () => {
                phonemesUsed = await phonemizeHindi(cleanText);
                const { input_ids } = kokoroTts.tokenizer(phonemesUsed, { truncation: true });
                return kokoroTts.generate_from_ids(input_ids, { voice });
              })()
            : kokoroTts.generate(cleanText, { voice });

          // Wrap generate in a 30s timeout using Promise.race to prevent GPU hangs from blocking forever
          ttsResult = await Promise.race([
            generation,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Kokoro TTS generation timeout (30s exceeded)')), 30000)
            )
          ]);
          break;
        } catch (genErr: any) {
          const msg = genErr?.message || String(genErr);
          if (msg.includes('Invalid language identifier') && generateRetries < 4) {
            generateRetries++;
            await new Promise(r => setTimeout(r, 250));
          } else {
            throw genErr;
          }
        }
      }
      // Create a fresh copy to guarantee we don't transfer the WASM heap buffer, which would crash the worker.
      // Transferring the buffer is critical for flat memory profiles on mobile (prevents OOM after long conversations).
      const audioData = normalizePeaks(new Float32Array(ttsResult.audio as any));
      const payload = {
        type: 'speechOutput',
        payload: {
          audio: audioData,
          sampleRate: ttsResult.sampling_rate,
          text: cleanText,
          // generate_from_ids() returns no phonemes, since it never saw the
          // text. Passing ours back keeps lip sync phoneme-driven in Hindi
          // rather than dropping it to amplitude alone.
          phonemes: ttsResult.phonemes || phonemesUsed || '',
          isLast: item.isLast,
        },
      };
      // @ts-ignore - TS mixes up Window.postMessage and DedicatedWorkerGlobalScope.postMessage
      self.postMessage(payload, [audioData.buffer]);
    } catch (e: any) {
      console.error('[Kokoro Worker] TTS chunk error:', e);
      if (item.isLast) {
        self.postMessage({ type: 'speechEnd' });
      } else {
        // Guarantee main thread recovery: emit a zero-sample fallback chunk for EVERY failed non-last item
        self.postMessage({
          type: 'speechOutput',
          payload: {
            audio: new Float32Array(0),
            sampleRate: 24000,
            text: cleanText,
            phonemes: '',
            isLast: false,
          },
        });
      }
    }
  }

  isTtsProcessing = false;
};

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'init') {
    const { voice, language = 'en-US' } = payload;
    currentLanguage = SUPPORTED_LANGUAGES.has(language) ? language : 'en-US';
    if (language && !SUPPORTED_LANGUAGES.has(language)) {
      console.warn(
        `[AiVoiceAvatar] ttsLanguage "${language}" has no Kokoro voice, so speech will be English. ` +
        `Supported: ${[...SUPPORTED_LANGUAGES].join(', ')}.`
      );
    }
    currentVoice = voice || DEFAULT_VOICE_BY_LANGUAGE[currentLanguage] || DEFAULT_VOICE;

    try {
      self.postMessage({ type: 'loadingProgress', payload: { model: 'kokoro', pct: 0 } });
      if (!KokoroTTS) {
        try {
          // Silence verbose ONNX Runtime C++ optimization warnings (e.g., shape nodes fallback to CPU EP)
          const ort = await import('onnxruntime-web');
          const env = ort.env || (ort as any).default?.env;
          if (env) {
            env.logLevel = 'error';
            if (env.wasm) {
              env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/';
            }
          }
        } catch (_) {}
        try {
          // Set wasm paths on transformers env to ensure clean WASM fallback
          const { env: tfEnv } = await import('@huggingface/transformers');
          if (tfEnv && tfEnv.backends && tfEnv.backends.onnx && tfEnv.backends.onnx.wasm) {
            tfEnv.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/';
          }
        } catch (_) {}
        const mod = await import('kokoro-js');
        KokoroTTS = mod.KokoroTTS || (mod as any).default?.KokoroTTS || mod;
        if (mod.env) {
          mod.env.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/';
        }
      }

      // Summed across the model's files and forward-only; see downloadProgress.ts.
      const progressCallback = createDownloadProgress(pct => {
        self.postMessage({
          type: 'loadingProgress',
          payload: { model: 'kokoro', pct: Math.round(pct) },
        });
      });

      try {
        console.log('[Kokoro Worker] Initializing Kokoro-82M on WebGPU (fp32)...');
        kokoroTts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
          dtype: 'fp32',
          device: 'webgpu',
          progress_callback: progressCallback,
        });
      } catch (webGpuErr) {
        console.warn('[Kokoro Worker] WebGPU initialization failed, falling back to WASM (fp32)...', webGpuErr);
        kokoroTts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
          dtype: 'fp32',
          device: 'wasm',
          progress_callback: progressCallback,
        });
      }

      // Warmup & Emscripten filesystem readiness verification:
      // In production builds, eSpeak-NG dictionaries extract asynchronously via DecompressionStream.
      // We validate operational status by verifying audio output length on a diagnostic probe sentence.
      // NOTE: Because espeak-ng caches an empty voice array in C memory permanently if probed before voice tables
      // finish decompressing, retrying generate() on the same instance cannot recover. If the probe fails (<2.0s),
      // we immediately request full worker termination and clean re-creation from scratch.
      // Always probe with an English voice, whatever language was requested.
      // The probe exists to prove eSpeak's dictionaries finished decompressing,
      // which only generate() depends on, and generate() rejects any voice
      // kokoro-js does not list. Probing with a Hindi voice would throw, be read
      // as a dead filesystem, and put the worker into an endless recreate loop.
      const probeText = 'The quick brown fox jumps over the lazy dog.';
      try {
        const probe: any = await Promise.race([
          kokoroTts.generate(probeText, { voice: DEFAULT_VOICE }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Warmup generation timeout')), 15000))
        ]);
        const audioLen = probe?.audio?.length || (probe?.audio instanceof Float32Array ? probe.audio.length : 0);
        const sampleRate = probe?.sampling_rate || 24000;
        const seconds = audioLen / sampleRate;
        if (seconds < 2.0) {
          throw new Error(`espeak voices not loaded in C memory (probe produced ${seconds.toFixed(2)}s, expected >2s)`);
        }
        console.log(`[Kokoro Worker] Warmup probe verified: ${seconds.toFixed(2)}s generated.`);
      } catch (warmupErr: any) {
        const msg = warmupErr?.message || String(warmupErr);
        console.warn(`[Kokoro Worker] Warmup probe failed: ${msg}. Requesting clean worker recreation to reset C memory...`);
        self.postMessage({ type: 'recreate_required', payload: { stage: 'kokoro-init', message: msg } });
        return;
      }

      // The voice table is only readable once the model is loaded, so validate here.
      currentVoice = resolveVoiceForLanguage(resolveVoice(currentVoice), currentLanguage);

      self.postMessage({ type: 'loadingProgress', payload: { model: 'kokoro', pct: 100 } });
      self.postMessage({ type: 'ready' });
      // Guarantee no stranded tasks: process any TTS jobs queued during model initialization
      processTtsQueue();
    } catch (err: any) {
      console.error('[Kokoro Worker] Init failed:', err);
      self.postMessage({ type: 'error', payload: { stage: 'kokoro-init', message: err.message } });
    }
  }

  if (type === 'synthesize') {
    const { text, isLast = true } = payload;
    ttsQueue.push({ text, isLast });
    processTtsQueue();
  }

  if (type === 'setVoice') {
    if (payload.language) {
      currentLanguage = SUPPORTED_LANGUAGES.has(payload.language) ? payload.language : currentLanguage;
    }
    const requested = payload.voice || DEFAULT_VOICE_BY_LANGUAGE[currentLanguage] || currentVoice;
    currentVoice = resolveVoiceForLanguage(resolveVoice(requested), currentLanguage);
  }

  if (type === 'speechEnd') {
    ttsQueue.push({ text: '', isLast: true, isEndMarker: true });
    processTtsQueue();
  }

  if (type === 'interrupt') {
    ttsQueue.length = 0;
  }
};
