/**
 * downloadProgress.ts
 *
 * Turns transformers.js download callbacks into one figure per model that only
 * moves forward.
 *
 * WHY THIS EXISTS
 *
 * transformers.js calls back once per file, each carrying that file's own
 * percentage. A model is several files — Whisper is an encoder, a decoder, a
 * tokenizer and some configs — and the workers used to forward each file's
 * percentage under the one model name. The figure lurched between files: 67%
 * for the encoder, then 60% as another file reported. Any progress bar drawn
 * from `loadingProgress` ran backwards during the one wait every new user sits
 * through.
 *
 * WHICH SIGNAL TO TRUST
 *
 * Alongside the per-file events, transformers.js emits `progress_total`. Before
 * downloading anything it asks for the size of every file the model needs, so
 * that event's denominator is complete from the very first callback. That is
 * the figure to report.
 *
 * Summing per-file events ourselves looks equivalent and is not: files are only
 * seen as they start, and a model's configs download before its weights. A
 * finished one-kilobyte config reads as 100% of everything seen so far, and
 * holding the figure at its highest then pins the bar at 99% for the whole
 * multi-hundred-megabyte download that follows. The summation is kept only as a
 * fallback for loaders that never send `progress_total`, where that limitation
 * cannot be avoided because the full file list is simply not known.
 *
 * The figure stops at 99 because only the caller knows when loading is
 * finished: the last byte arriving is not the model being ready to run.
 */

/** The fields transformers.js and kokoro-js pass to `progress_callback`. */
export interface ProgressEvent {
  status?: string;
  file?: string;
  loaded?: number;
  total?: number;
  progress?: number;
}

/**
 * Build a `progress_callback` that reports through `onProgress`, once per
 * genuine advance, as a percentage between 0 and 99.
 */
export function createDownloadProgress(onProgress: (pct: number) => void) {
  const files = new Map<string, { loaded: number; total: number }>();
  let hasTotals = false;
  let reported = 0;

  const report = (pct: number) => {
    const capped = Math.min(99, Math.max(0, pct));
    if (capped <= reported) return;
    reported = capped;
    onProgress(capped);
  };

  return (event: ProgressEvent | null | undefined): void => {
    if (!event) return;

    if (event.status === 'progress_total') {
      if (typeof event.progress === 'number' && !Number.isNaN(event.progress)) {
        hasTotals = true;
        report(event.progress);
      }
      return;
    }

    // Once the loader has shown it sends totals, per-file events carry nothing
    // the total did not already account for.
    if (hasTotals || !event.file) return;

    if (typeof event.total === 'number' && event.total > 0) {
      const loaded = typeof event.loaded === 'number' ? event.loaded : 0;
      files.set(event.file, { loaded: Math.min(loaded, event.total), total: event.total });
    } else if (event.status === 'done') {
      const known = files.get(event.file);
      if (known) known.loaded = known.total;
    }

    let loaded = 0;
    let total = 0;
    for (const file of files.values()) {
      loaded += file.loaded;
      total += file.total;
    }
    if (total > 0) report((loaded / total) * 100);
  };
}
