import { KokoroTTS } from 'kokoro-js';

let kokoroTts: any = null;
let currentVoice: string = 'af_heart';

const ttsQueue: Array<{ text: string; isLast: boolean; isEndMarker?: boolean }> = [];
let isTtsProcessing = false;

const sanitizeForSpeech = (text: string): string => {
  return text
    // Remove markdown formatting: bold (**), italics (* or _), strikethroughs (~~), backticks
    .replace(/(\*{1,3}|_{1,3}|~~|`+)/g, '')
    // Remove markdown link syntax [label](url) -> label
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove headers (#), list bullets (-, *, +), blockquotes (>) at start of lines
    .replace(/^[#*+\->]\s+/gm, '')
    .replace(/^\d+[.)]\s+/gm, '')
    // Convert hyphenated numeric ranges (e.g., 620-800) into words for smooth TTS prosody ("620 to 800")
    .replace(/(\b\d+)\s*-\s*(\d+\b)/g, '$1 to $2')
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
    if (!cleanText || cleanText.length === 0) continue;

    try {
      const ttsResult = await kokoroTts.generate(cleanText, {
        voice: currentVoice || 'af_heart',
      });
      const audioData = ttsResult.audio instanceof Float32Array 
        ? ttsResult.audio 
        : new Float32Array(ttsResult.audio);
      self.postMessage({
        type: 'speechOutput',
        payload: {
          audio: audioData,
          sampleRate: ttsResult.sampling_rate,
          text: cleanText,
          isLast: item.isLast,
        },
      });
    } catch (e: any) {
      console.error('[Kokoro Worker] TTS chunk error:', e);
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
      try {
        console.log('[Kokoro Worker] Initializing Kokoro-82M on WebGPU...');
        kokoroTts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
          dtype: 'fp32',
          device: 'webgpu',
        });
      } catch (webGpuErr) {
        console.warn('[Kokoro Worker] WebGPU initialization failed, falling back to WASM...', webGpuErr);
        kokoroTts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
          dtype: 'q8',
          device: 'wasm',
        });
      }
      self.postMessage({ type: 'loadingProgress', payload: { model: 'kokoro', pct: 100 } });
      self.postMessage({ type: 'ready' });
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
};
