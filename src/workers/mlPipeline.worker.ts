import { pipeline, AutomaticSpeechRecognitionPipeline, TextGenerationPipeline, TextToAudioPipeline, TextStreamer, env } from '@huggingface/transformers';
import { normalizeToDevanagari } from '../lib/transliterate';

// Setup environment specifically for the worker
env.allowLocalModels = false;
env.useBrowserCache = true;

let asrPipeline: AutomaticSpeechRecognitionPipeline | null = null;
let llmPipeline: TextGenerationPipeline | null = null;
let ttsPipeline: TextToAudioPipeline | null = null;

let chatHistory: Array<{ role: string, content: string }> = [];

let currentDevice: 'webgpu' | 'wasm' = 'webgpu';
let currentTtsLanguage: string = 'en-US';
/** The caller's prompt without any language instruction, so it can be re-applied. */
let baseSystemPrompt: string = '';
/** The speech recognition model currently loaded, to avoid reloading it needlessly. */
let currentAsrModel: string = '';
let currentTtsVoice: string = 'af_heart';
let currentTtsEngine: 'kokoro' | 'mms' = 'mms';

const ttsQueue: Array<{ text: string; isLast: boolean }> = [];
let isTtsProcessing = false;
let isInterrupted = false;

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
    // Convert common symbols to words for better TTS prosody
    .replace(/%/g, currentTtsLanguage === 'hi-IN' ? ' प्रतिशत' : ' percent')
    .replace(/&/g, currentTtsLanguage === 'hi-IN' ? ' और ' : ' and ')
    .replace(/\+/g, currentTtsLanguage === 'hi-IN' ? ' प्लस ' : ' plus ')
    .replace(/=/g, currentTtsLanguage === 'hi-IN' ? ' बराबर ' : ' equals ')
    .replace(/@/g, currentTtsLanguage === 'hi-IN' ? ' पर ' : ' at ')
    .replace(/\$([\d,.]+)/g, currentTtsLanguage === 'hi-IN' ? '$1 डॉलर' : '$1 dollars')
    // Replace stray markdown dividers or underlines
    .replace(/[-=]{3,}/g, ' ')
    // Clean up excessive spacing and trim
    .replace(/\s+/g, ' ')
    .trim();
};

const LOCAL_TTS_REPOS: Record<string, string> = {
  'en-US': 'Xenova/mms-tts-eng',
  'hi-IN': 'Xenova/mms-tts-hin',
};

/**
 * Resolve the local voice model for a language.
 * Warns loudly rather than silently substituting English, which previously made
 * an unsupported language look supported.
 */
const resolveTtsRepo = (lang: string): string => {
  const repo = LOCAL_TTS_REPOS[lang];
  if (repo) return repo;
  const supported = Object.keys(LOCAL_TTS_REPOS).join(', ');
  console.warn(
    `[AiVoiceAvatar] ttsLanguage "${lang}" has no local voice model, so speech will be English. ` +
    `Locally supported: ${supported}. For any other language pass an onSynthesize adapter ` +
    `and use a cloud voice provider.`
  );
  return LOCAL_TTS_REPOS['en-US'];
};

/**
 * Names a language in its own script, plus English so a small model recognises it.
 */
const LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  'hi-IN':
    'Reply only in Hindi, written in the Devanagari script. ' +
    'Do not reply in English and do not write Hindi in Latin letters. ' +
    'हमेशा हिन्दी में देवनागरी लिपि में उत्तर दें।',
};

/**
 * Tell the model which language to answer in.
 *
 * Selecting a voice changes how a reply is spoken, not what language it is
 * written in, and a model given an English system prompt answers in English no
 * matter which voice is waiting to read it out. That produced the worst possible
 * result: an English sentence pronounced by a Hindi voice.
 *
 * The instruction goes last, because a small instruction-tuned model weights the
 * end of its system prompt most heavily, and it names the script explicitly,
 * since models asked for Hindi will otherwise often answer in transliterated
 * Latin, which the phonemiser has no way to read as Hindi.
 */
const withLanguageInstruction = (prompt: string, language: string): string => {
  const instruction = LANGUAGE_INSTRUCTIONS[language];
  return instruction ? `${prompt}\n\n${instruction}` : prompt;
};

/** Load a speech recognition pipeline, reporting download progress as it goes. */
const loadAsrPipeline = (model: string, device: 'webgpu' | 'wasm') =>
  pipeline('automatic-speech-recognition', model, {
    device,
    progress_callback: (p: any) => {
      if (typeof p.progress === 'number' && !Number.isNaN(p.progress)) {
        self.postMessage({ type: 'loadingProgress', payload: { model: 'asr', pct: p.progress } });
      }
    },
  });

const processTtsQueue = async () => {
  if (isTtsProcessing) return;
  isTtsProcessing = true;
  while (ttsQueue.length > 0) {
    if (!ttsPipeline && currentTtsEngine !== 'kokoro') {
      // MMS pipeline is still loading; pause queue processing.
      // switchTts will call processTtsQueue() when ready.
      isTtsProcessing = false;
      return;
    }
    const item = ttsQueue.shift()!;
    if (!item.text || item.text.trim().length === 0) continue;
    
    const cleanText = sanitizeForSpeech(item.text);
    if (cleanText.length === 0) continue;

    try {
      if (currentTtsEngine === 'kokoro') {
        self.postMessage({
          type: 'speechOutput',
          payload: {
            audio: null,
            sampleRate: 0,
            text: cleanText,
            isLast: item.isLast,
          },
        });
        continue;
      }

      if (ttsPipeline) {
        const ttsResult = await ttsPipeline(cleanText);
        // Create a fresh copy to guarantee we don't transfer the WASM heap buffer, which would crash the worker.
        // Transferring the buffer is critical for flat memory profiles on mobile.
        const audioData = new Float32Array(ttsResult.audio as any);
        const payload = { 
          type: 'speechOutput', 
          payload: { 
            audio: audioData, 
            sampleRate: ttsResult.sampling_rate, 
            text: cleanText,
            isLast: item.isLast 
          } 
        };
        // @ts-ignore - TS mixes up Window.postMessage and DedicatedWorkerGlobalScope.postMessage
        self.postMessage(payload, [audioData.buffer]);
      }
    } catch (e: any) {
      console.error('[ML Worker] TTS streaming chunk error:', e);
    }
  }
  isTtsProcessing = false;
};

const pushPhraseToTts = (phrase: string, isLast: boolean) => {
  ttsQueue.push({ text: phrase, isLast });
  processTtsQueue();
};

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'init') {
    const { 
      llmModel = 'onnx-community/Qwen2.5-0.5B-Instruct', 
      asrModel = 'onnx-community/whisper-base', 
      ttsLanguage = 'en-US', 
      ttsEngine = 'mms',
      ttsVoice = 'af_heart',
      fallbackMode = 'wasm',
      lowMemoryMode: _lowMemoryMode = false,
      systemPrompt = "You are Tara, an empathetic, engaging, and lively voice companion. You speak the way a real human conversing out loud talks, never defaulting to formal written essays or chatbot jargon. Always keep your replies to 1-3 short, spoken sentences unless explicitly asked for detail. Absolutely avoid lists, numbered steps, markdown, and headers—just say it the way a person would say it out loud. Use common natural contractions like I'm, that's, let's, and don't. To maintain an authentic conversational flow rather than a Q&A terminal, occasionally end your reply with a brief, warm follow-up question.",
      onnxWasmPath = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/'
    } = payload;
    
    // Explicitly set WASM paths so fallback backend binaries load correctly in strict environments
    if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
      env.backends.onnx.wasm.wasmPaths = onnxWasmPath;
    }
    
    currentTtsLanguage = ttsLanguage;
    currentTtsVoice = ttsVoice;
    currentTtsEngine = ttsEngine;

    baseSystemPrompt = systemPrompt;
    chatHistory = [
      { role: 'system', content: withLanguageInstruction(systemPrompt, ttsLanguage) }
    ];

    try {
      // 1. Check capabilities / ASR
      self.postMessage({ type: 'loadingProgress', payload: { model: 'asr', pct: 0 } });
      currentAsrModel = asrModel;
      try {
        asrPipeline = await loadAsrPipeline(asrModel, 'webgpu');
        currentDevice = 'webgpu';
      } catch (err) {
        console.warn('WebGPU ASR failed, falling back to WASM', err);
        if (fallbackMode === 'wasm') {
          asrPipeline = await loadAsrPipeline(asrModel, 'wasm');
          currentDevice = 'wasm';
        } else if (fallbackMode === 'error') {
          self.postMessage({ type: 'error', payload: { stage: 'asr', message: 'WebGPU failed' } });
          return;
        }
      }

      self.postMessage({ type: 'capabilities', payload: { webgpu: currentDevice === 'webgpu', estimatedVram: null } });
      await new Promise(resolve => setTimeout(resolve, 200));

      // 2. Load LLM if not skipped
      if (payload.loadLlm !== false) {
        self.postMessage({ type: 'loadingProgress', payload: { model: 'llm', pct: 0 } });
        llmPipeline = await pipeline('text-generation', llmModel, {
          device: currentDevice,
          dtype: 'q4', // Quantization for speed
          progress_callback: (p: any) => {
            if (typeof p.progress === 'number' && !Number.isNaN(p.progress)) {
              self.postMessage({ type: 'loadingProgress', payload: { model: 'llm', pct: p.progress }});
            }
          }
        });
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // 3. Load TTS Engine (Only load MMS if engine is not set to Kokoro)
      if (currentTtsEngine !== 'kokoro') {
        self.postMessage({ type: 'loadingProgress', payload: { model: 'tts', pct: 0 } });
        const ttsRepo = resolveTtsRepo(currentTtsLanguage);
        ttsPipeline = await pipeline('text-to-speech', ttsRepo, {
          device: 'wasm',
          progress_callback: (p: any) => {
            if (typeof p.progress === 'number' && !Number.isNaN(p.progress)) {
              self.postMessage({ type: 'loadingProgress', payload: { model: 'tts', pct: p.progress }});
            }
          }
        });
        self.postMessage({ type: 'loadingProgress', payload: { model: 'tts', pct: 100 } });
      }

      self.postMessage({ type: 'ready' });
    } catch (error: any) {
      self.postMessage({ type: 'error', payload: { stage: 'init', message: error.message } });
    }
  }

  if (type === 'switchAsr') {
    const { asrModel } = payload;
    if (!asrModel || asrModel === currentAsrModel) return;

    // Reload only the recognition model. Recreating the whole worker would
    // discard the language model too, and re-downloading a gigabyte because
    // someone changed language is not a trade worth making.
    const previousModel = currentAsrModel;
    console.log(`[ML Worker] Switching speech recognition model → ${asrModel}`);
    try {
      self.postMessage({ type: 'loadingProgress', payload: { model: 'asr', pct: 0 } });
      asrPipeline = await loadAsrPipeline(asrModel, currentDevice === 'wasm' ? 'wasm' : 'webgpu');
      currentAsrModel = asrModel;
      self.postMessage({ type: 'loadingProgress', payload: { model: 'asr', pct: 100 } });
    } catch (err: any) {
      // Keep the model that is already loaded rather than leaving the pipeline
      // with nothing to transcribe with. Worse recognition beats none.
      console.error(
        `[AiVoiceAvatar] Could not load speech recognition model "${asrModel}", ` +
        `continuing with "${previousModel}".`, err
      );
      self.postMessage({
        type: 'error',
        payload: { stage: 'asr', message: `Could not load ${asrModel}: ${err?.message || err}` },
      });
    }
    return;
  }

  if (type === 'switchTts') {
    const { ttsVoice, ttsLanguage, ttsEngine } = payload;
    const oldLanguage = currentTtsLanguage;
    if (ttsVoice) currentTtsVoice = ttsVoice;
    if (ttsLanguage) currentTtsLanguage = ttsLanguage;
    if (ttsEngine) currentTtsEngine = ttsEngine;
    console.log(`[ML Worker] Switched TTS configuration → Engine: ${currentTtsEngine}, Voice: ${currentTtsVoice}, Language: ${currentTtsLanguage}`);

    // Re-language the system prompt when the language changes mid-session.
    // Without this, switching to Hindi changed the voice but left the model
    // still under English instructions, so it kept answering in English and the
    // Hindi voice simply read that English aloud.
    if (ttsLanguage && ttsLanguage !== oldLanguage && chatHistory.length > 0 && chatHistory[0].role === 'system') {
      chatHistory[0] = {
        role: 'system',
        content: withLanguageInstruction(baseSystemPrompt, currentTtsLanguage),
      };
    }
    
    // Load MMS pipeline only when running in MMS mode and either uninitialized or language changed
    if (currentTtsEngine !== 'kokoro' && (!ttsPipeline || (ttsLanguage && ttsLanguage !== oldLanguage))) {
      const ttsRepo = resolveTtsRepo(currentTtsLanguage);
      ttsPipeline = await pipeline('text-to-speech', ttsRepo, { device: 'wasm' });
      processTtsQueue();
    } else if (currentTtsEngine === 'kokoro') {
      processTtsQueue();
    }
  }

  async function runLlmInference(transcript: string) {
    if (!transcript || transcript.trim().length < 2) {
      self.postMessage({ type: 'error', payload: { stage: 'pipeline', message: 'Empty or noise transcript ignored.' } });
      return;
    }

    if (!llmPipeline) {
      self.postMessage({ type: 'error', payload: { stage: 'llm', message: 'LLM not initialized' } });
      return;
    }

    // 2. LLM Inference & Streaming Phrase-by-Phrase TTS
    chatHistory.push({ role: 'user', content: transcript });

    // Truncate chat history to prevent WebGPU OOM or Tensor Shape crashes
    // We keep the system prompt (index 0) and the last 6 messages (3 turns)
    if (chatHistory.length > 7) {
      chatHistory = [chatHistory[0], ...chatHistory.slice(-6)];
    }

    let fullReplyText = '';
    let sentenceBuffer = '';
    isInterrupted = false;

    const streamer = new TextStreamer(llmPipeline.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text: string) => {
        if (isInterrupted) {
          throw new Error('INTERRUPTED');
        }
        fullReplyText += text;
        sentenceBuffer += text;
        
        self.postMessage({ type: 'streamWord', payload: { word: text, fullText: fullReplyText } });

        const sentenceMatch = sentenceBuffer.match(/([.!?\u0964]|\n\n+)/);
        const minLen = currentTtsEngine === 'kokoro' ? 5 : 35;
        if ((sentenceMatch && sentenceBuffer.trim().length > minLen) || sentenceBuffer.trim().length > 150) {
          const splitIdx = sentenceMatch 
            ? sentenceBuffer.lastIndexOf(sentenceMatch[0]) + sentenceMatch[0].length 
            : sentenceBuffer.lastIndexOf(' ') + 1;

          if (splitIdx > 0) {
            const chunk = sentenceBuffer.substring(0, splitIdx).trim();
            sentenceBuffer = sentenceBuffer.substring(splitIdx);
            
            if (chunk.length > 0) {
              pushPhraseToTts(chunk, false);
            }
          }
        }
      }
    });

    try {
      // @ts-ignore
      await llmPipeline(chatHistory, { max_new_tokens: 128, streamer });
      
      if (sentenceBuffer.trim().length > 0) {
        pushPhraseToTts(sentenceBuffer.trim(), true);
      } else if (ttsQueue.length > 0) {
        ttsQueue[ttsQueue.length - 1].isLast = true;
      } else {
        self.postMessage({ type: 'speechEnd' });
      }

      chatHistory.push({ role: 'assistant', content: fullReplyText || 'I did not catch that.' });
    } catch (error: any) {
      if (error.message === 'INTERRUPTED') {
        console.log('[ML Worker] LLM inference interrupted by user.');
        chatHistory.push({ role: 'assistant', content: (fullReplyText || '') + ' [Interrupted]' });
        return;
      }
      self.postMessage({ type: 'error', payload: { stage: 'pipeline', message: error.message } });
    }
  }

  if (type === 'audioInput') {
    const { blob, language = 'en', skipLlm = false } = payload;
    
    if (!asrPipeline) {
      self.postMessage({ type: 'error', payload: { stage: 'asr', message: 'ASR not initialized' } });
      return;
    }

    try {
      const asrResult = await asrPipeline(blob, { language: language, task: 'transcribe' });
      // @ts-ignore
      const rawTranscript = asrResult.text || (Array.isArray(asrResult) ? asrResult[0].text : '');
      
      // Whisper often returns Hindi speech in Urdu script, so fold it back to Devanagari.
      const transcript = currentTtsLanguage === 'hi-IN'
        ? normalizeToDevanagari(rawTranscript)
        : rawTranscript;

      self.postMessage({ type: 'transcript', payload: { text: transcript } });

      if (skipLlm) return;
      await runLlmInference(transcript);
    } catch (error: any) {
      self.postMessage({ type: 'error', payload: { stage: 'pipeline', message: error.message } });
    }
  }

  if (type === 'textInput') {
    const { text, skipLlm = false } = payload;
    self.postMessage({ type: 'transcript', payload: { text } });
    
    if (skipLlm) return;
    await runLlmInference(text);
  }

  if (type === 'ttsOnly') {
    const { text, isLast = true } = payload;
    pushPhraseToTts(text, isLast);
  }

  if (type === 'interrupt') {
    isInterrupted = true;
    ttsQueue.length = 0;
  }

  if (type === 'clearHistory') {
    chatHistory = [chatHistory[0]]; // keep system prompt
  }
};
