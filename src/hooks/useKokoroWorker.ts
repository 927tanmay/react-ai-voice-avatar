import { useEffect, useRef, useState, useCallback } from 'react';
// @ts-ignore
import KokoroWorker from '../workers/kokoroTts.worker?worker';

/**
 * useKokoroWorker — manages a dedicated Kokoro-82M TTS worker.
 * 
 * This worker is loaded lazily (only when ttsEngine === 'kokoro')
 * and runs in a SEPARATE worker thread from the main ML pipeline,
 * preventing kokoro-js's ~80MB dependency tree from bloating the
 * inline ML pipeline worker bundle.
 */

export interface UseKokoroWorkerConfig {
  enabled: boolean;
  voice?: string;
  onSpeechOutput?: (audio: Float32Array, sampleRate: number, text: string, isLast?: boolean) => void;
  onSpeechEnd?: () => void;
  onReady?: () => void;
  onError?: (stage: string, message: string) => void;
  loadingProgress?: (pct: number, label: string) => void;
}

export function useKokoroWorker(config: UseKokoroWorkerConfig) {
  const workerRef = useRef<Worker | null>(null);
  const [isReady, setIsReady] = useState(false);

  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // Create / destroy the worker based on `enabled`
  useEffect(() => {
    if (!config.enabled) {
      // Tear down if disabled
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
        setIsReady(false);
      }
      return;
    }

    let isMounted = true;
    // Lazy-load the Kokoro worker (managed by Vite as a separate chunk, NOT inlined)
    const kokoroWorker = new KokoroWorker();
    workerRef.current = kokoroWorker;

    kokoroWorker.postMessage({
      type: 'init',
      payload: { voice: configRef.current.voice || 'af_heart' },
    });

    kokoroWorker.onmessage = (e: MessageEvent) => {
      if (!isMounted) return;
      const { type, payload } = e.data;

      if (type === 'ready') {
        setIsReady(true);
        configRef.current.onReady?.();
      } else if (type === 'loadingProgress') {
        configRef.current.loadingProgress?.(payload.pct, payload.model);
      } else if (type === 'speechOutput') {
        configRef.current.onSpeechOutput?.(
          payload.audio,
          payload.sampleRate,
          payload.text,
          payload.isLast
        );
      } else if (type === 'speechEnd') {
        configRef.current.onSpeechEnd?.();
      } else if (type === 'error') {
        console.error(`[Kokoro Worker] Error: ${payload.stage} — ${payload.message}`);
        configRef.current.onError?.(payload.stage, payload.message);
      }
    };

    return () => {
      isMounted = false;
      kokoroWorker.terminate();
      workerRef.current = null;
      setIsReady(false);
    };
  }, [config.enabled]);

  // Forward voice changes
  useEffect(() => {
    if (workerRef.current && isReady && config.voice) {
      workerRef.current.postMessage({
        type: 'setVoice',
        payload: { voice: config.voice },
      });
    }
  }, [config.voice, isReady]);

  const synthesize = useCallback((text: string, isLast: boolean = true) => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({
      type: 'synthesize',
      payload: { text, isLast },
    });
  }, []);

  const speechEnd = useCallback(() => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({ type: 'speechEnd' });
  }, []);

  return { isReady, synthesize, speechEnd };
}
