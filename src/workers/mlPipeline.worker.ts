import { pipeline, AutomaticSpeechRecognitionPipeline, TextGenerationPipeline, TextToAudioPipeline, TextStreamer, env } from '@huggingface/transformers';
import { normalizeToDevanagari } from '../lib/transliterate';
import { createDownloadProgress } from '../lib/downloadProgress';

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
/** The text generation model currently loaded, to avoid reloading it needlessly. */
let currentLlmModel: string = '';
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
/**
 * Instructions for languages where the speaker's own gender inflects the verb.
 *
 * Hindi conjugates the first person for gender: a woman says "करती हूँ" where a
 * man says "करता हूँ". Models default to the masculine, so a female avatar with
 * a female voice refers to herself in the masculine throughout, which to a Hindi
 * speaker is not a stylistic wobble but plainly wrong.
 *
 * A caveat measured rather than assumed: Gemma 3 1B ignores this entirely.
 * Against a persona prompt carrying no gender of its own it answered in the
 * masculine every time, whether told it was female, told it was male, or told
 * nothing, and three phrasings of the instruction changed nothing. What did
 * work was the grammar of the persona prompt itself: described as "ऑर्डर लेने
 * वाली सहायक", the same model used feminine forms consistently.
 *
 * So the reliable lever for a small local model is to write the persona in the
 * gender you want, and this instruction is a supplement for models large enough
 * to follow it. Anyone writing a Hindi persona should put the gender in the
 * description rather than rely on this.
 *
 * Only the speaker's own forms are constrained. Nothing here touches how the
 * model addresses the user, whose gender it has no way of knowing.
 */
const SPEAKER_GENDER_INSTRUCTIONS: Record<string, Record<string, string>> = {
  'hi-IN': {
    female:
      'You are female, so use feminine first-person verb forms for yourself. ' +
      'आप स्त्री हैं। अपने बारे में बात करते समय स्त्रीलिंग क्रिया रूपों का ' +
      'प्रयोग करें, जैसे "करती हूँ", "सकती हूँ", "रही हूँ"।',
    male:
      'You are male, so use masculine first-person verb forms for yourself. ' +
      'आप पुरुष हैं। अपने बारे में बात करते समय पुल्लिंग क्रिया रूपों का ' +
      'प्रयोग करें, जैसे "करता हूँ", "सकता हूँ", "रहा हूँ"।',
  },
};

/**
 * Read a speaker's gender out of a Kokoro voice name.
 *
 * Kokoro names voices <language><gender>_<name>, so af_heart is an American
 * female and hm_omega a Hindi male. Deriving it beats asking the caller for it
 * twice, and a name that does not follow the convention simply yields nothing
 * rather than a guess.
 */
const genderFromVoice = (voice: string): 'female' | 'male' | null => {
  const marker = voice?.[1];
  if (marker === 'f') return 'female';
  if (marker === 'm') return 'male';
  return null;
};

const withLanguageInstruction = (prompt: string, language: string, voice?: string): string => {
  const parts = [prompt];

  const instruction = LANGUAGE_INSTRUCTIONS[language];
  if (instruction) parts.push(instruction);

  const gender = voice ? genderFromVoice(voice) : null;
  const gendered = gender ? SPEAKER_GENDER_INSTRUCTIONS[language]?.[gender] : undefined;
  if (gendered) parts.push(gendered);

  return parts.join('\n\n');
};

/** Report one model's download as a single forward-only figure. See downloadProgress.ts. */
const reportProgress = (model: 'asr' | 'llm' | 'tts') =>
  createDownloadProgress(pct => {
    self.postMessage({ type: 'loadingProgress', payload: { model, pct } });
  });

/** Load a text generation pipeline, reporting download progress as it goes. */
const loadLlmPipeline = (model: string) => {
  self.postMessage({ type: 'loadingProgress', payload: { model: 'llm', pct: 0 } });
  return pipeline('text-generation', model, {
    device: currentDevice,
    // q4, not q4f16, even though q4f16 is transformers.js's recommendation for
    // WebGPU and is 461 MB against 750 MB for Qwen2.5-0.5B. Measured in Chrome
    // on WebGPU with shader-f16, greedy decoding, identical prompts: q4 answered
    // every one ("The capital of France is Paris."), while q4f16 repeated each
    // question back verbatim and degenerated into repeated fragments. Qwen's
    // activations overflow half precision. Re-measure before changing this.
    dtype: 'q4',
    progress_callback: reportProgress('llm'),
  });
};

type ChatTurn = { role: string; content: string };

/**
 * Force the conversation into strict user/assistant alternation.
 *
 * Stricter chat templates, Gemma's among them, refuse anything else outright
 * with "Conversation roles must alternate", and the message points at the
 * history rather than at what actually produced it. Two things produce it here.
 * Trimming keeps the last six turns, and six turns back can land on an
 * assistant, so the conversation opens with a reply to nothing. And an
 * interrupted turn never records its assistant half, leaving two user turns
 * together. Qwen's template tolerates both, which is why neither showed up
 * until a second model arrived.
 *
 * Leading assistant turns are dropped, having nothing to answer. Same-role
 * neighbours are merged rather than discarded, since what was said still
 * belongs in the context.
 */
const alternating = (turns: ChatTurn[]): ChatTurn[] => {
  const out: ChatTurn[] = [];
  for (const turn of turns) {
    if (out.length === 0 && turn.role !== 'user') continue;
    const previous = out[out.length - 1];
    if (previous && previous.role === turn.role) {
      previous.content = `${previous.content}\n${turn.content}`;
      continue;
    }
    out.push({ ...turn });
  }
  return out;
};

/**
 * Shape the conversation the way this particular model expects it.
 *
 * The system turn is kept in our own history whatever the model wants, so that
 * switching models mid-session never loses the instructions. Templates with no
 * system role get it folded into the first thing the user said instead.
 */
const messagesForModel = (history: ChatTurn[], tokenizer: any): ChatTurn[] => {
  const hasSystem = history.length > 0 && history[0].role === 'system';
  if (!hasSystem) return alternating(history);

  const [system, ...rest] = history;
  const turns = alternating(rest);

  // A template that never mentions the system role cannot render one.
  const supportsSystem = String(tokenizer?.chat_template ?? '').includes('system');
  if (supportsSystem) return [system, ...turns];

  if (turns.length === 0) return [{ role: 'user', content: system.content }];
  return turns.map((turn, i) =>
    i === 0 ? { role: 'user', content: `${system.content}\n\n${turn.content}` } : turn
  );
};

/** Load a speech recognition pipeline, reporting download progress as it goes. */
const loadAsrPipeline = (model: string, device: 'webgpu' | 'wasm') =>
  pipeline('automatic-speech-recognition', model, {
    device,
    progress_callback: reportProgress('asr'),
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

    // Say which models this session will use. Several are chosen by language
    // rather than named by the caller, and without this the only way to find out
    // which one you got was to watch the network tab during a long download.
    console.log(
      `[ML Worker] Language ${ttsLanguage} → speech recognition: ${asrModel}, ` +
      `text generation: ${payload.loadLlm === false ? 'skipped (onSubmit supplied)' : llmModel}`
    );

    baseSystemPrompt = systemPrompt;
    chatHistory = [
      // payload.ttsVoice rather than the destructured ttsVoice: that one carries
      // a default, and inferring the speaker's gender from a voice the caller
      // never chose would put a claim in the prompt they did not make.
      { role: 'system', content: withLanguageInstruction(systemPrompt, ttsLanguage, payload.ttsVoice) }
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

      // Download progress stops at 99 until loading is confirmed, so completion
      // has to be announced. Without it the row for a finished model sat at
      // 99% for the rest of the load and looked stalled.
      self.postMessage({ type: 'loadingProgress', payload: { model: 'asr', pct: 100 } });
      self.postMessage({ type: 'capabilities', payload: { webgpu: currentDevice === 'webgpu', estimatedVram: null } });
      await new Promise(resolve => setTimeout(resolve, 200));

      // 2. Load LLM if not skipped
      if (payload.loadLlm !== false) {
        currentLlmModel = llmModel;
        llmPipeline = await loadLlmPipeline(llmModel);
        self.postMessage({ type: 'loadingProgress', payload: { model: 'llm', pct: 100 } });
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // 3. Load TTS Engine (Only load MMS if engine is not set to Kokoro)
      if (currentTtsEngine !== 'kokoro') {
        self.postMessage({ type: 'loadingProgress', payload: { model: 'tts', pct: 0 } });
        const ttsRepo = resolveTtsRepo(currentTtsLanguage);
        ttsPipeline = await pipeline('text-to-speech', ttsRepo, {
          device: 'wasm',
          progress_callback: reportProgress('tts'),
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

  /**
   * Load the local language model after startup skipped it.
   *
   * A host that supplies `onSubmit` never downloads one, which is right: its
   * replies come from somewhere else. But an application can want both — answer
   * from a hosted model straight away, and quietly fetch the local one so the
   * conversation keeps working when the network, the quota or the wifi does
   * not. This is what makes that second half possible.
   *
   * Turns answered by the host are invisible to this worker, so they are passed
   * in here. Without them the local model takes over mid-conversation with no
   * memory of what was already said, and the first thing it does is ask a
   * question that was answered a minute ago.
   */
  if (type === 'loadLocalLlm') {
    if (llmPipeline) {
      self.postMessage({ type: 'localLlmReady' });
      return;
    }

    const model = payload?.llmModel || 'onnx-community/Qwen2.5-0.5B-Instruct';
    try {
      llmPipeline = await loadLlmPipeline(model);
      currentLlmModel = model;
      self.postMessage({ type: 'loadingProgress', payload: { model: 'llm', pct: 100 } });

      const seed = Array.isArray(payload?.history) ? payload.history : [];
      if (seed.length > 0) {
        chatHistory = [chatHistory[0], ...seed.slice(-6)];
      }

      self.postMessage({ type: 'localLlmReady' });
    } catch (err: any) {
      console.error('[AiVoiceAvatar] Could not load the local language model.', err);
      self.postMessage({
        type: 'error',
        payload: { stage: 'llm', message: `Could not load ${model}: ${err?.message || err}` },
      });
    }
    return;
  }

  if (type === 'switchLlm') {
    const { llmModel } = payload;
    // Skip when unchanged, and when the host supplies its own replies: there is
    // no local model to swap and downloading one would be pure waste.
    if (!llmModel || llmModel === currentLlmModel || !llmPipeline) return;

    const previousModel = currentLlmModel;
    console.log(`[ML Worker] Switching language model → ${llmModel}`);
    try {
      llmPipeline = await loadLlmPipeline(llmModel);
      currentLlmModel = llmModel;
      chatHistory = chatHistory.slice(0, 1); // A new model has no memory of the old one's turns.
      self.postMessage({ type: 'loadingProgress', payload: { model: 'llm', pct: 100 } });
    } catch (err: any) {
      console.error(
        `[AiVoiceAvatar] Could not load language model "${llmModel}", ` +
        `continuing with "${previousModel}".`, err
      );
      self.postMessage({
        type: 'error',
        payload: { stage: 'llm', message: `Could not load ${llmModel}: ${err?.message || err}` },
      });
    }
    return;
  }

  if (type === 'switchTts') {
    const { ttsVoice, ttsLanguage, ttsEngine } = payload;
    const oldLanguage = currentTtsLanguage;
    const oldVoice = currentTtsVoice;
    if (ttsVoice) currentTtsVoice = ttsVoice;
    if (ttsLanguage) currentTtsLanguage = ttsLanguage;
    if (ttsEngine) currentTtsEngine = ttsEngine;
    console.log(`[ML Worker] Switched TTS configuration → Engine: ${currentTtsEngine}, Voice: ${currentTtsVoice}, Language: ${currentTtsLanguage}`);

    // Rebuild the system prompt when the language changes, or when the voice
    // changes to one of a different gender. Without the first, switching to
    // Hindi changed the voice but left the model under English instructions, so
    // it kept answering in English and the Hindi voice read that aloud. Without
    // the second, switching from a female to a male voice leaves the model still
    // speaking of itself as a woman, which in Hindi is audible in every verb.
    const languageChanged = Boolean(ttsLanguage) && ttsLanguage !== oldLanguage;
    const genderChanged = genderFromVoice(currentTtsVoice) !== genderFromVoice(oldVoice);
    if ((languageChanged || genderChanged) && chatHistory.length > 0 && chatHistory[0].role === 'system') {
      chatHistory[0] = {
        role: 'system',
        content: withLanguageInstruction(baseSystemPrompt, currentTtsLanguage, currentTtsVoice),
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

/**
 * Things Whisper says when handed audio containing no words.
 *
 * Asked to transcribe a cough, a door or a breath, it does not return nothing.
 * It returns whatever filler is most common in its training data, confidently
 * and in full sentences. These are the phrases it reaches for, drawn from the
 * subtitle corpora it learned from, and an avatar that answers one has
 * abandoned a real reply to respond to a noise.
 *
 * Matched only against the whole transcript, never as a substring, so someone
 * genuinely saying "thank you" is still heard.
 */
const NON_SPEECH_TRANSCRIPTS = new Set([
  'you', 'thank you', 'thank you.', 'thanks for watching!', 'thanks for watching.',
  'thank you for watching', 'thank you for watching.', 'bye', 'bye.', 'bye bye',
  'okay', 'okay.', 'oh', 'oh.', 'mm', 'mmm', 'hmm', 'uh', 'um', 'ah',
  '[blank_audio]', '[music]', '[silence]', '(upbeat music)', 'subtitles by the amara.org community',
  'शुक्रिया', 'धन्यवाद', 'धन्यवाद.',
]);

/** True when a transcript is one of the phrases produced by non-speech audio. */
const isNonSpeech = (transcript: string): boolean => {
  const normalised = transcript.trim().toLowerCase().replace(/\s+/g, ' ');
  return normalised.length < 2 || NON_SPEECH_TRANSCRIPTS.has(normalised);
};

  async function runLlmInference(transcript: string) {
    if (!transcript || isNonSpeech(transcript)) {
      self.postMessage({
        type: 'error',
        payload: { stage: 'pipeline', message: `Ignored a transcript with no speech in it: ${JSON.stringify(transcript)}` },
      });
      return;
    }

    if (!llmPipeline) {
      self.postMessage({ type: 'error', payload: { stage: 'llm', message: 'LLM not initialized' } });
      return;
    }

    // 2. LLM Inference & Streaming Phrase-by-Phrase TTS
    chatHistory.push({ role: 'user', content: transcript });

    // Truncate chat history to prevent WebGPU OOM or Tensor Shape crashes.
    // Keep the system prompt and the last three exchanges, cutting on a user
    // turn: six messages back can land on an assistant, which would open the
    // conversation with a reply to nothing.
    if (chatHistory.length > 7) {
      const recent = chatHistory.slice(-6);
      const firstUser = recent.findIndex(m => m.role === 'user');
      chatHistory = [chatHistory[0], ...(firstUser === -1 ? [] : recent.slice(firstUser))];
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
      await llmPipeline(messagesForModel(chatHistory, llmPipeline.tokenizer), { max_new_tokens: 128, streamer });
      
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
