import { useEffect, useRef, useState, useCallback } from 'react';
// @ts-ignore
import MLWorker from '../workers/mlPipeline.worker?worker&inline';
import { IndicAvatarCapabilities } from '../components/IndicAvatar';

export interface UseMLWorkerConfig {
  llmModel?: string;
  asrModel?: string;
  ttsLanguage?: string;
  ttsEngine?: 'kokoro' | 'mms';
  ttsVoice?: string;
  fallbackMode?: 'wasm' | 'disable' | 'error';
  lowMemoryMode?: boolean;
  systemPrompt?: string;
  loadLlm?: boolean;
  onTranscriptUpdate?: (text: string, speaker: 'user' | 'avatar') => void;
  onCapabilityDetected?: (caps: IndicAvatarCapabilities) => void;
  loadingProgress?: (pct: number, label: string) => void;
  onSpeechOutput?: (audio: Float32Array | null, sampleRate: number, text: string, isLast?: boolean) => void;
  onStreamWord?: (word: string, fullText: string) => void;
  onSpeechEnd?: () => void;
  onError?: (stage: string, message: string) => void;
}

export function useMLWorker(config: UseMLWorkerConfig) {
  const workerRef = useRef<Worker | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Keep latest config in ref for callbacks
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    let isMounted = true;
    let worker: Worker | null = null;

    const timer = setTimeout(() => {
      if (!isMounted) return;
      const newWorker = new MLWorker();
      worker = newWorker;
      workerRef.current = newWorker;

      newWorker.postMessage({
        type: 'init',
        payload: {
          llmModel: configRef.current.llmModel,
          asrModel: configRef.current.asrModel,
          ttsLanguage: configRef.current.ttsLanguage,
          ttsEngine: configRef.current.ttsEngine,
          ttsVoice: configRef.current.ttsVoice,
          fallbackMode: configRef.current.fallbackMode,
          lowMemoryMode: configRef.current.lowMemoryMode,
          systemPrompt: configRef.current.systemPrompt,
          loadLlm: configRef.current.loadLlm,
        }
      });

      newWorker.onmessage = (e: MessageEvent) => {
        const { type, payload } = e.data;

        if (type === 'ready') {
          setIsReady(true);
        } else if (type === 'capabilities') {
          configRef.current.onCapabilityDetected?.(payload);
        } else if (type === 'loadingProgress') {
          configRef.current.loadingProgress?.(payload.pct, payload.model);
        } else if (type === 'transcript') {
          configRef.current.onTranscriptUpdate?.(payload.text, 'user');
        } else if (type === 'speechOutput') {
          configRef.current.onTranscriptUpdate?.(payload.text, 'avatar');
          // payload.audio is a Float32Array from transformers.js TTS
          configRef.current.onSpeechOutput?.(payload.audio, payload.sampleRate, payload.text, payload.isLast);
        } else if (type === 'streamWord') {
          configRef.current.onStreamWord?.(payload.word, payload.fullText);
        } else if (type === 'speechEnd') {
          configRef.current.onSpeechEnd?.();
        } else if (type === 'error') {
          console.error(`[ML Worker] Error in stage ${payload.stage}:`, payload.message);
          configRef.current.onError?.(payload.stage, payload.message);
        }
      };
    }, 100);

    return () => {
      isMounted = false;
      clearTimeout(timer);
      if (worker) {
        worker.terminate();
      }
      workerRef.current = null;
      setIsReady(false);
    };
  }, []);

  useEffect(() => {
    if (workerRef.current && isReady) {
      workerRef.current.postMessage({
        type: 'switchTts',
        payload: {
          ttsEngine: config.ttsEngine,
          ttsVoice: config.ttsVoice,
          ttsLanguage: config.ttsLanguage
        }
      });
    }
  }, [config.ttsEngine, config.ttsVoice, config.ttsLanguage, isReady]);

  const processAudio = useCallback((audioBlob: Float32Array, language: string, skipLlm: boolean = false) => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({
      type: 'audioInput',
      payload: { blob: audioBlob, language, skipLlm }
    });
  }, []);

  const synthesizeText = useCallback((text: string, isLast: boolean = true) => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({
      type: 'ttsOnly',
      payload: { text, isLast }
    });
  }, []);

  const clearHistory = useCallback(() => {
    workerRef.current?.postMessage({ type: 'clearHistory' });
  }, []);

  return {
    isReady,
    processAudio,
    synthesizeText,
    clearHistory
  };
}
