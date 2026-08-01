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
let currentTtsVoice: string = 'af_heart';
let currentTtsEngine: 'kokoro' | 'mms' = 'mms';

const ttsQueue: Array<{ text: string; isLast: boolean }> = [];
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
  if (isTtsProcessing) return;
  isTtsProcessing = true;
  while (ttsQueue.length > 0) {
    const item = ttsQueue.shift()!;
    if (!item.text || item.text.trim().length === 0) continue;
    
    let cleanText = sanitizeForSpeech(item.text);
    if (cleanText.length === 0) continue;

    if (currentTtsLanguage === 'hi-IN' && !/[\u0900-\u097F]/.test(cleanText)) {
      cleanText = "मुझे क्षमा करें, मुझे इसका उत्तर नहीं पता।";
    }
    
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
        // @ts-ignore
        self.postMessage({ 
          type: 'speechOutput', 
          payload: { 
            audio: ttsResult.audio, 
            sampleRate: ttsResult.sampling_rate, 
            text: cleanText,
            isLast: item.isLast 
          } 
        });
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
      systemPrompt = "You are Tara, an empathetic, engaging, and lively voice companion from India. You speak the way a real human conversing out loud talks, never defaulting to formal written essays or chatbot jargon. Always keep your replies to 1-3 short, spoken sentences unless explicitly asked for detail. Absolutely avoid lists, numbered steps, markdown, and headers—just say it the way a person would say it out loud. Use common natural contractions like I'm, that's, let's, and don't. To maintain an authentic conversational flow rather than a Q&A terminal, occasionally end your reply with a brief, warm follow-up question."
    } = payload;
    
    currentTtsLanguage = ttsLanguage;
    currentTtsVoice = ttsVoice;
    currentTtsEngine = ttsEngine;

    chatHistory = [
      { role: 'system', content: systemPrompt }
    ];

    try {
      // 1. Check capabilities / ASR
      self.postMessage({ type: 'loadingProgress', payload: { model: 'asr', pct: 0 } });
      try {
        asrPipeline = await pipeline('automatic-speech-recognition', asrModel, {
          device: 'webgpu',
          progress_callback: (p: any) => self.postMessage({ type: 'loadingProgress', payload: { model: 'asr', pct: p.progress }})
        });
        currentDevice = 'webgpu';
      } catch (err) {
        console.warn('WebGPU ASR failed, falling back to WASM', err);
        if (fallbackMode === 'wasm') {
          asrPipeline = await pipeline('automatic-speech-recognition', asrModel, {
            device: 'wasm',
            progress_callback: (p: any) => self.postMessage({ type: 'loadingProgress', payload: { model: 'asr', pct: p.progress }})
          });
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
          progress_callback: (p: any) => self.postMessage({ type: 'loadingProgress', payload: { model: 'llm', pct: p.progress }})
        });
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // 3. Load TTS Engine (MMS only — Kokoro will be loaded via a separate worker in a future phase)
      self.postMessage({ type: 'loadingProgress', payload: { model: 'tts', pct: 0 } });
      const ttsRepo = currentTtsLanguage === 'hi-IN' ? 'Xenova/mms-tts-hin' : 'Xenova/mms-tts-eng';
      ttsPipeline = await pipeline('text-to-speech', ttsRepo, {
        device: 'wasm',
        progress_callback: (p: any) => self.postMessage({ type: 'loadingProgress', payload: { model: 'tts', pct: p.progress }})
      });
      self.postMessage({ type: 'loadingProgress', payload: { model: 'tts', pct: 100 } });

      self.postMessage({ type: 'ready' });
    } catch (error: any) {
      self.postMessage({ type: 'error', payload: { stage: 'init', message: error.message } });
    }
  }

  if (type === 'switchTts') {
    const { ttsVoice, ttsLanguage, ttsEngine } = payload;
    if (ttsVoice) currentTtsVoice = ttsVoice;
    if (ttsLanguage) currentTtsLanguage = ttsLanguage;
    if (ttsEngine) currentTtsEngine = ttsEngine;
    console.log(`[ML Worker] Switched TTS configuration → Engine: ${currentTtsEngine}, Voice: ${currentTtsVoice}, Language: ${currentTtsLanguage}`);
    
    // Load MMS pipeline for the new language if needed
    if (!ttsPipeline || (ttsLanguage && ttsLanguage !== currentTtsLanguage)) {
      const ttsRepo = currentTtsLanguage === 'hi-IN' ? 'Xenova/mms-tts-hin' : 'Xenova/mms-tts-eng';
      ttsPipeline = await pipeline('text-to-speech', ttsRepo, { device: 'wasm' });
    }
  }

  if (type === 'audioInput') {
    const { blob, language = 'en', skipLlm = false } = payload;
    
    if (!asrPipeline) {
      self.postMessage({ type: 'error', payload: { stage: 'asr', message: 'ASR not initialized' } });
      return;
    }

    try {
      // 1. Transcribe
      const asrResult = await asrPipeline(blob, { language: language, task: 'transcribe' });
      // @ts-ignore
      const rawTranscript = asrResult.text || (Array.isArray(asrResult) ? asrResult[0].text : '');
      
      // 2. Normalize script: Urdu/Romanized → Devanagari (only in Hindi mode)
      let transcript = rawTranscript;
      if (currentTtsLanguage === 'hi-IN') {
        transcript = normalizeToDevanagari(rawTranscript);
        console.log(`[ML Worker] ASR raw: "${rawTranscript}" → normalized: "${transcript}"`);
      } else {
        console.log(`[ML Worker] ASR transcript: "${transcript}"`);
      }
      
      self.postMessage({ type: 'transcript', payload: { text: transcript } });

      if (skipLlm) {
        // Main thread will handle it and call ttsOnly
        return;
      }

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

      if (!ttsPipeline) {
        self.postMessage({ type: 'error', payload: { stage: 'tts', message: 'TTS not initialized' } });
        return;
      }

      let fullReplyText = '';
      let sentenceBuffer = '';


      const streamer = new TextStreamer(llmPipeline.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (text: string) => {
          fullReplyText += text;
          sentenceBuffer += text;
          
          // Post real-time word streaming event to UI
          self.postMessage({ type: 'streamWord', payload: { word: text, fullText: fullReplyText } });

          // When using Kokoro on an isolated worker thread, dispatch sentences instantly (5+ chars)
          // to begin WebGPU TTS synthesis immediately while the LLM continues generating the remaining response in parallel.
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

      // @ts-ignore
      await llmPipeline(chatHistory, { max_new_tokens: 128, streamer });
      
      // Flush remaining text when generation finishes
      if (sentenceBuffer.trim().length > 0) {
        pushPhraseToTts(sentenceBuffer.trim(), true);
      } else if (ttsQueue.length > 0) {
        ttsQueue[ttsQueue.length - 1].isLast = true;
      } else {
        self.postMessage({ type: 'speechEnd' });
      }

      chatHistory.push({ role: 'assistant', content: fullReplyText || 'I did not catch that.' });

    } catch (error: any) {
      self.postMessage({ type: 'error', payload: { stage: 'pipeline', message: error.message } });
    }
  }

  if (type === 'ttsOnly') {
    const { text, isLast = true } = payload;
    if (!ttsPipeline) {
      self.postMessage({ type: 'error', payload: { stage: 'tts', message: 'TTS not initialized' } });
      return;
    }
    pushPhraseToTts(text, isLast);
  }

  if (type === 'clearHistory') {
    chatHistory = [chatHistory[0]]; // keep system prompt
  }
};
