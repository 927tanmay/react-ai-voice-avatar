import { useEffect, useRef, useState, useCallback } from 'react';

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
    if (typeof window === 'undefined' || typeof Worker === 'undefined') return; // P4: Next.js SSR Guard
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
    let kokoroWorker: Worker | null = null;

    try {
      // Standard ECMAScript Worker instantiation for cross-bundler compatibility (Vite, Next.js, Webpack)
      kokoroWorker = new Worker(new URL('../workers/kokoroTts.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = kokoroWorker;

      kokoroWorker.onerror = (err) => {
        console.error('[Kokoro Worker] Runtime initialization or compilation error:', err);
        configRef.current.onError?.('kokoro-worker', err.message || 'Failed to initialize Kokoro TTS worker thread.');
      };

      kokoroWorker.onmessageerror = (err) => {
        console.error('[Kokoro Worker] Message deserialization error:', err);
        configRef.current.onError?.('kokoro-message', 'Failed to deserialize message from Kokoro TTS worker.');
      };

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
          if (payload.stage === 'kokoro-init') {
            setIsReady(false);
            try {
              kokoroWorker?.terminate();
              workerRef.current = null;
            } catch (termErr) {
              console.warn('Error terminating failed worker on init failure:', termErr);
            }
          }
          configRef.current.onError?.(payload.stage, payload.message);
        }
      };
    } catch (err: any) {
      console.error('[Kokoro Worker] Failed to construct Web Worker:', err);
      configRef.current.onError?.('kokoro-worker-construct', err?.message || 'Failed to instantiate Kokoro Worker.');
      return;
    }

    return () => {
      isMounted = false;
      if (kokoroWorker) {
        kokoroWorker.terminate();
      }
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
