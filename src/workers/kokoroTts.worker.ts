// Silence benign ONNX Runtime optimization notices (e.g. shape node fallbacks to CPU EP) in DevTools console
const origWarn = console.warn;
const origError = console.error;
const isBenignOrtNotice = (...args: any[]) => {
  const str = args.map(a => (typeof a === 'string' ? a : (a?.message || ''))).join(' ');
  return str.includes('VerifyEachNodeIsAssignedToAnEp') || str.includes('preferred execution providers');
};
console.warn = (...args: any[]) => { if (!isBenignOrtNotice(...args)) origWarn.apply(console, args as any); };
console.error = (...args: any[]) => { if (!isBenignOrtNotice(...args)) origError.apply(console, args as any); };

// Runtime integrity check: Verify that bundlers have copied this worker verbatim rather than re-compiling it
if (typeof fetch !== 'undefined' && self.location && self.location.href) {
  fetch(self.location.href).then(async (res) => {
    const buffer = await res.arrayBuffer();
    if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      console.log(`[Kokoro Worker Runtime] Script byte length: ${buffer.byteLength} bytes | SHA-256: ${hashHex}`);
    } else {
      console.log(`[Kokoro Worker Runtime] Script byte length: ${buffer.byteLength} bytes`);
    }
    if (buffer.byteLength < 2000000 && !self.location.href.includes('localhost') && !self.location.href.includes('127.0.0.1')) {
      console.warn(`[Kokoro Worker Runtime] WARNING: Worker script size is ${buffer.byteLength} bytes (<2MB). A consumer bundler may have re-bundled or code-split this script instead of copying it verbatim, which can disrupt Emscripten initialization order.`);
    }
  }).catch(() => {
    // Ignore fetch errors in restrictive CSP or cross-origin worker setups
  });
}

let KokoroTTS: any = null;
let kokoroTts: any = null;
let currentVoice: string = 'af_heart';

const ttsQueue: Array<{ text: string; isLast: boolean; isEndMarker?: boolean }> = [];
let isTtsProcessing = false;

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
    .replace(/%/g, ' percent')
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .replace(/=/g, ' equals ')
    .replace(/@/g, ' at ')
    .replace(/\$([\d,.]+)/g, '$1 dollars')
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
      let generateRetries = 0;
      while (generateRetries < 5) {
        try {
          // Wrap generate in a 30s timeout using Promise.race to prevent GPU hangs from blocking forever
          ttsResult = await Promise.race([
            kokoroTts.generate(cleanText, {
              voice: currentVoice || 'af_heart',
            }),
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
      const audioData = new Float32Array(ttsResult.audio as any);
      const payload = {
        type: 'speechOutput',
        payload: {
          audio: audioData,
          sampleRate: ttsResult.sampling_rate,
          text: cleanText,
          phonemes: ttsResult.phonemes || '',
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
    const { voice = 'af_heart' } = payload;
    currentVoice = voice;

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
              env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/';
            }
          }
        } catch (_) {
          // Continue if direct ORT import is handled internally by consumer bundlers
        }
        const mod = await import('kokoro-js');
        KokoroTTS = mod.KokoroTTS || (mod as any).default?.KokoroTTS || mod;
      }

      const progressCallback = (data: any) => {
        if (data && data.status === 'progress' && typeof data.progress === 'number') {
          self.postMessage({
            type: 'loadingProgress',
            payload: { model: 'kokoro', pct: Math.min(99, Math.round(data.progress)) },
          });
        }
      };

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
      const probeText = 'The quick brown fox jumps over the lazy dog.';
      try {
        const probe: any = await Promise.race([
          kokoroTts.generate(probeText, { voice: currentVoice || 'af_heart' }),
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
    currentVoice = payload.voice;
    console.log('[Kokoro Worker] Voice changed to:', currentVoice);
  }

  if (type === 'speechEnd') {
    ttsQueue.push({ text: '', isLast: true, isEndMarker: true });
    processTtsQueue();
  }

  if (type === 'interrupt') {
    ttsQueue.length = 0;
  }
};
