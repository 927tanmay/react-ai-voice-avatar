import React from 'react';
import ReactDOM from 'react-dom/client';
import { useAiVoiceAvatar, streamingTranscriber, speechReply } from 'react-ai-voice-avatar/headless';

/**
 * Time a spoken turn through your own adapters, for
 * scripts/measure-adapter-latency.mjs, from the moment the user stops
 * talking to the moment the reply is heard.
 *
 * The providers are stand-ins with fixed delays (PROVIDER below), so what
 * changes between runs is only how the hook uses them:
 *
 *   ?stt=batch|stream     onTranscribe after the silence timer, or a
 *                         streamingTranscriber whose provider ends the turn
 *   ?voice=whole|stream   onSynthesize returning a sentence whole, or chunks
 *   ?reply=text|speech    onSubmit streaming text, or speechReply(audio)
 *
 * The end of speech is measured on the microphone itself, not taken from the
 * hook: the page listens to the same stream the hook is given.
 */
const params = new URLSearchParams(location.search);
const stt = params.get('stt') ?? 'batch';
const voiceMode = params.get('voice') ?? 'whole';
const replyMode = params.get('reply') ?? 'text';

/** The stand-in providers. Typical figures for hosted APIs, not measurements. */
const PROVIDER = {
  /** onTranscribe: upload and transcribe a short clip. */
  sttBatchMs: 300,
  /** Streaming STT: quiet before the provider calls the end of the turn. */
  sttEndpointMs: 300,
  /** Streaming STT: its end-of-turn message reaching the browser. */
  sttNetworkMs: 50,
  /** onSubmit: time to first token, then one word every msPerWord. */
  llmFirstTokenMs: 350,
  llmMsPerWord: 30,
  /** onSynthesize: time to first audio, then generated this many times faster than real time. */
  ttsFirstAudioMs: 200,
  ttsSpeed: 4,
  /** speechReply: a speech-to-speech model's time to first audio. */
  speechFirstAudioMs: 500,
};
const REPLY = 'Paris is the capital of France, on the Seine. It has been the capital for over a thousand years.';
/** Seconds of speech for a piece of text, at a typical speaking rate. */
const secondsFor = (text: string) => Math.max(0.3, text.length * 0.06);

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const tone = (seconds: number) => {
  const pcm = new Float32Array(Math.round(24000 * seconds));
  for (let i = 0; i < pcm.length; i++) pcm[i] = 0.1 * Math.sin((2 * Math.PI * 440 * i) / 24000);
  return pcm;
};

type Turn = {
  /** The detector, or the provider, decided the turn was over. */
  decided?: number;
  transcript?: number;
  /** onSubmit wrote the end of its first sentence. */
  firstSentence?: number;
  /** onSynthesize was asked for the first sentence, and gave its first audio. */
  synthAsked?: number;
  synthAudio?: number;
  /** The reply began to play. */
  audio?: number;
  /** The end of the user's speech before it, from the microphone. */
  speechEnd?: number;
};
const turns: Turn[] = [];
let current: Turn | null = null;
/** Every end of speech heard on the microphone, as performance.now(). */
const speechEnds: number[] = [];
Object.assign(window, { __turns: turns, __provider: PROVIDER, __speechEnds: speechEnds });

/**
 * Listen to the stream the hook is given. A buffer is loud above 0.01 RMS;
 * speech has ended at the last loud buffer once 250 ms of quiet follow it.
 * Its processing delay is the same in every run, so it cancels out.
 */
const native = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia = async constraints => {
  const stream = await native(constraints);
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const tap = ctx.createScriptProcessor(256, 1, 1);
  let lastLoud = 0;
  let speaking = false;
  tap.onaudioprocess = e => {
    const now = performance.now();
    const samples = e.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    if (Math.sqrt(sum / samples.length) > 0.01) {
      lastLoud = now;
      speaking = true;
    } else if (speaking && now - lastLoud > 250) {
      speaking = false;
      speechEnds.push(lastLoud);
    }
  };
  source.connect(tap);
  tap.connect(ctx.destination);
  return stream;
};

const transcriber = streamingTranscriber(({ endTurn, sampleRate }) => {
  let speech = 0;
  let quiet = 0;
  let ended = false;
  return {
    push(frame) {
      let sum = 0;
      for (const v of frame) sum += v * v;
      if (Math.sqrt(sum / frame.length) > 0.01) {
        speech += frame.length;
        quiet = 0;
      } else if (speech > 0) {
        quiet += frame.length;
      }
      if (!ended && speech > 0.5 * sampleRate && quiet >= (PROVIDER.sttEndpointMs / 1000) * sampleRate) {
        ended = true;
        setTimeout(() => endTurn('What is the capital of France?'), PROVIDER.sttNetworkMs);
      }
    },
    finish: async () => 'What is the capital of France?',
  };
});

/** Audio as a provider streams it: first chunk after a delay, then faster than real time. */
async function* chunks(seconds: number, firstMs: number, text?: string) {
  await wait(firstMs);
  const piece = 0.25;
  for (let at = 0; at < seconds; at += piece) {
    if (at > 0) await wait((piece * 1000) / PROVIDER.ttsSpeed);
    yield { audio: tone(Math.min(piece, seconds - at)), sampleRate: 24000, text: at === 0 ? text : undefined };
  }
}

const App: React.FC = () => {
  const voice = useAiVoiceAvatar({
    onInferenceStart: () => {
      current = { decided: performance.now() };
      turns.push(current);
    },
    onTranscriptUpdate: (_text, speaker) => {
      if (speaker === 'user' && current && !current.transcript) current.transcript = performance.now();
    },
    onSpeechStart: () => {
      if (!current || current.audio) return;
      current.audio = performance.now();
      current.speechEnd = speechEnds.filter(t => t < current!.audio!).at(-1);
    },
    onTranscribe: stt === 'stream'
      ? transcriber
      : async () => {
          await wait(PROVIDER.sttBatchMs);
          return 'What is the capital of France?';
        },
    onSubmit: async () => {
      const turn = current;
      if (replyMode === 'speech') {
        return speechReply((async function* () {
          let first = true;
          for (const sentence of REPLY.match(/[^.]+\./g)!.map(s => s.trim())) {
            yield* chunks(secondsFor(sentence), first ? PROVIDER.speechFirstAudioMs : 0, sentence);
            first = false;
          }
        })());
      }
      return (async function* () {
        await wait(PROVIDER.llmFirstTokenMs);
        for (const word of REPLY.split(' ')) {
          yield word + ' ';
          if (turn && !turn.firstSentence && word.endsWith('.')) turn.firstSentence = performance.now();
          await wait(PROVIDER.llmMsPerWord);
        }
      })();
    },
    onSynthesize: async text => {
      const turn = current;
      if (turn && !turn.synthAsked) turn.synthAsked = performance.now();
      const seconds = secondsFor(text);
      if (voiceMode === 'stream') {
        return (async function* () {
          for await (const chunk of chunks(seconds, PROVIDER.ttsFirstAudioMs)) {
            if (turn && !turn.synthAudio) turn.synthAudio = performance.now();
            yield chunk;
          }
        })();
      }
      await wait(PROVIDER.ttsFirstAudioMs + (seconds * 1000) / PROVIDER.ttsSpeed);
      if (turn && !turn.synthAudio) turn.synthAudio = performance.now();
      return { audio: tone(seconds), sampleRate: 24000 };
    },
  });

  Object.assign(window, { __status: voice.status, __start: () => voice.startListening() });
  return <p id="status">{voice.status}</p>;
};

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
