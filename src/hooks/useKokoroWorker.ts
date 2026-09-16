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
  /**
   * Language to speak. Selects the voice when none is named, and decides how
   * text is turned into phonemes. See src/lib/hindiG2P.ts for why Hindi takes a
   * different route through the engine than English does.
   */
  language?: string;
  onSpeechOutput?: (audio: Float32Array, sampleRate: number, text: string, phonemes: string, isLast?: boolean) => void;
  onSpeechEnd?: () => void;
  onReady?: () => void;
  onError?: (stage: string, message: string) => void;
  loadingProgress?: (pct: number, label: string) => void;
  workerBaseUrl?: string;
}

export function useKokoroWorker(config: UseKokoroWorkerConfig) {
  const workerRef = useRef<Worker | null>(null);
  const [isReady, setIsReady] = useState(false);
  const configRef = useRef(config);
  const recreateAttemptsRef = useRef(0);
  /**
   * Which attempt to spawn a worker is the current one.
   *
   * Spawning is asynchronous — the worker's code is imported before the Worker
   * exists — so an effect can be cleaned up while its worker is still on the
   * way. The cleanup then has nothing to terminate, and the abandoned attempt
   * arrives afterwards and claims `workerRef`. Comparing this counter is how a
   * late arrival finds out it is no longer wanted.
   */
  const spawnTokenRef = useRef(0);

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
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const token = ++spawnTokenRef.current;

    const spawnWorker = async (useFallback = false) => {
      if (!isMounted || !config.enabled) return;
      try {
        let kokoroWorkerInst: Worker | null = null;
        let usedBlob = false;
        let pendingBlobUrl: string | null = null;

        if (!useFallback) {
          try {
            const { kokoroWorkerCode } = await import('../workers/generated/kokoroTts.worker.code');
            pendingBlobUrl = URL.createObjectURL(new Blob([kokoroWorkerCode], { type: 'application/javascript' }));
            kokoroWorkerInst = new Worker(pendingBlobUrl, { type: 'module' });
            // Do NOT revoke yet — module workers fetch the blob asynchronously
            usedBlob = true;
          } catch (blobErr: any) {
            if (pendingBlobUrl) URL.revokeObjectURL(pendingBlobUrl);
            console.warn('[Kokoro Worker] Sync fallback triggered.', blobErr);
            return spawnWorker(true);
          }
        } else {
          if (configRef.current.workerBaseUrl) {
            const baseUrl = configRef.current.workerBaseUrl.endsWith('/') ? configRef.current.workerBaseUrl : configRef.current.workerBaseUrl + '/';
            kokoroWorkerInst = new Worker(baseUrl + 'kokoroTts.worker.js', { type: 'module' });
          } else {
            console.error('[Kokoro Worker] Blob worker failed and no workerBaseUrl fallback configured. If your deployment uses COEP headers, either remove them or provide a workerBaseUrl prop.');
            configRef.current.onError?.('kokoro-worker', 'Blob worker failed. Remove COEP headers or provide workerBaseUrl.');
            return;
          }
        }

        // This attempt was abandoned while its code was being imported. Under
        // StrictMode that is every first mount, and without this the orphan
        // went on loading an 80MB model, finished, and then took ownership of
        // workerRef — leaving the hook posting work to a worker whose replies
        // its own handlers had already been told to ignore. The request
        // vanished, and the avatar waited for audio that was never coming.
        if (!isMounted || token !== spawnTokenRef.current) {
          try { kokoroWorkerInst.terminate(); } catch (e) { /* never started */ }
          if (pendingBlobUrl) URL.revokeObjectURL(pendingBlobUrl);
          return;
        }

        kokoroWorker = kokoroWorkerInst;
        workerRef.current = kokoroWorker;
        let hasReceivedMessage = false;

        kokoroWorker.onerror = (err) => {
          if (usedBlob && !hasReceivedMessage) {
            console.warn('[Kokoro Worker] Async init error. Retrying without blob...', err);
            if (pendingBlobUrl) { URL.revokeObjectURL(pendingBlobUrl); pendingBlobUrl = null; }
            kokoroWorker?.terminate();
            spawnWorker(true);
            return;
          }
          console.error('[Kokoro Worker] Runtime initialization or compilation error:', err);
          // @ts-ignore
          configRef.current.onError?.('kokoro-worker', err.message || 'Failed to initialize Kokoro TTS worker thread.');
        };

        kokoroWorker.onmessageerror = (err) => {
          console.error('[Kokoro Worker] Message deserialization error:', err);
          configRef.current.onError?.('kokoro-message', 'Failed to deserialize message from Kokoro TTS worker.');
        };

        kokoroWorker.postMessage({
          type: 'init',
          payload: {
            // Left undefined when unset so the worker can pick the default
            // voice for the language, rather than defaulting to English here
            // and having the worker override it a moment later.
            voice: configRef.current.voice,
            language: configRef.current.language || 'en-US',
          },
        });

        kokoroWorker.onmessage = (e: MessageEvent) => {
          if (!isMounted) return;
          if (!hasReceivedMessage) {
            hasReceivedMessage = true;
            // Module has loaded; safe to revoke the blob URL now
            if (pendingBlobUrl) { URL.revokeObjectURL(pendingBlobUrl); pendingBlobUrl = null; }
          }
          const { type, payload } = e.data;

          if (type === 'ready') {
            recreateAttemptsRef.current = 0;
            setIsReady(true);
            configRef.current.onReady?.();
          } else if (type === 'loadingProgress') {
            configRef.current.loadingProgress?.(payload.pct, payload.model);
          } else if (type === 'recreate_required') {
            setIsReady(false);
            console.warn(`[Kokoro Worker] Re-creation required: ${payload?.message || 'Espeak C memory uninitialized'}`);
            try {
              kokoroWorker?.terminate();
            } catch (termErr) {
              console.warn('Error terminating worker for clean re-creation:', termErr);
            }
            workerRef.current = null;

            if (recreateAttemptsRef.current < 10) {
              recreateAttemptsRef.current += 1;
              const delay = Math.min(400 * recreateAttemptsRef.current, 2000);
              console.log(`[Kokoro Worker] Spawning fresh worker instance to reset C memory (attempt ${recreateAttemptsRef.current}/10 in ${delay}ms)...`);
              retryTimer = setTimeout(() => spawnWorker(), delay);
            } else {
              console.error('[Kokoro Worker] Initialization timed out after 10 clean worker re-creation attempts.');
              configRef.current.onError?.('kokoro-init', payload?.message || 'Initialization timed out after 10 worker re-creations.');
            }
          } else if (type === 'speechOutput') {
            configRef.current.onSpeechOutput?.(
              payload.audio,
              payload.sampleRate,
              payload.text,
              payload.phonemes,
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
      }
    };

    recreateAttemptsRef.current = 0;
    spawnWorker();

    return () => {
      isMounted = false;
      if (retryTimer) clearTimeout(retryTimer);
      if (kokoroWorker) {
        kokoroWorker.terminate();
      }
      workerRef.current = null;
      setIsReady(false);
    };
  }, [config.enabled]);

  // Forward voice and language changes.
  useEffect(() => {
    if (!workerRef.current || !isReady) return;
    if (!config.voice && !config.language) return;
    workerRef.current.postMessage({
      type: 'setVoice',
      payload: { voice: config.voice, language: config.language },
    });
  }, [config.voice, config.language, isReady]);

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

  const interrupt = useCallback(() => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({ type: 'interrupt' });
  }, []);

  return { isReady, synthesize, speechEnd, interrupt };
}
