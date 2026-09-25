/**
 * modelCache.ts
 *
 * Keeps downloaded model files in the Origin Private File System, so a
 * returning visitor does not download them again.
 *
 * WHY THIS EXISTS
 *
 * transformers.js stores what it downloads in the Cache API by default, and
 * Chrome's Cache API refuses any single entry of 256 MiB or more. Bisected with
 * synthetic responses on Chrome 152: 255 MiB stores, 256 MiB fails with
 * `UnknownError: Unexpected internal error`, on an origin with 3.4 GB of quota
 * free. It is a per-entry limit, not a quota.
 *
 * transformers.js catches that failure, logs one warning and carries on, so
 * nothing looks broken. But the Kokoro voice is a single ~310 MB file and the
 * local language model a single ~750 MB one, so neither was ever kept: every
 * visit downloaded them again. Whisper survived only because it arrives as two
 * files that each happen to fit.
 *
 * OPFS stores files rather than cache entries and has no such limit, only the
 * origin's overall quota. transformers.js accepts any object with `match` and
 * `put` in place of the Cache API (`env.useCustomCache`), so this is that
 * object, and nothing in the library is patched.
 *
 * HOW A FILE IS KEPT
 *
 * Each file is written under a name derived from its URL, and only once it is
 * complete is a small marker written beside it recording its size. `match`
 * trusts nothing without that marker, and nothing whose size disagrees with it.
 * A visitor who closes the tab halfway through a 750 MB download therefore
 * leaves a partial file that is simply never served, rather than a truncated
 * model that fails to load on every visit after.
 *
 * Failures never throw into transformers.js. A file that cannot be kept is
 * reported through `onStoreFailed` and the model still loads from the bytes
 * already in memory — the worst case is today's behaviour, downloading again
 * next time, now with a reason attached.
 */

/** The subset of the Web Cache API that transformers.js calls. */
export interface ModelCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
  delete(key: string): Promise<boolean>;
}

export interface ModelCacheOptions {
  /** Directory inside OPFS that holds the model files. */
  directoryName?: string;
  /**
   * Called when a file could not be kept, with a reason fit for a developer.
   * The model still loads; it will be downloaded again on the next visit.
   */
  onStoreFailed?: (key: string, reason: string) => void;
  /** The OPFS root. Injectable so the logic can be tested without a browser. */
  getRoot?: () => Promise<FileSystemDirectoryHandle>;
  /**
   * Where files were kept before this existed, read on a miss so a returning
   * visitor does not download again what the Cache API did manage to keep.
   */
  getLegacyCache?: () => Promise<Pick<Cache, 'match'> | undefined>;
  /** Free space in bytes, or undefined when the browser will not say. */
  getFreeBytes?: () => Promise<number | undefined>;
}

const DEFAULT_DIRECTORY = 'react-ai-voice-avatar-models';

/** Whether this environment can keep model files in OPFS at all. */
export function isModelCacheSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function' &&
    typeof crypto !== 'undefined' &&
    typeof crypto.subtle?.digest === 'function'
  );
}

/**
 * `onnx-community/Qwen2.5-0.5B-Instruct onnx/model_q4.onnx` from a Hugging Face
 * URL, for a message a developer will read. Anything else comes back as is.
 */
export function modelFileLabel(url: string): string {
  const match = url.match(/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/[^/]+\/(.+)$/);
  return match ? `${match[1]} ${match[2]}` : url;
}

/**
 * A file name for a URL.
 *
 * URLs contain slashes, which OPFS names cannot. Hashing gives a fixed-length
 * name with no character to escape and no collision in practice.
 */
async function nameFor(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

function isNotFound(err: unknown): boolean {
  return (err as { name?: string })?.name === 'NotFoundError';
}

export function createModelCache(options: ModelCacheOptions = {}): ModelCache {
  const {
    directoryName = DEFAULT_DIRECTORY,
    onStoreFailed,
    getRoot = () => navigator.storage.getDirectory(),
    getLegacyCache = defaultLegacyCache,
    getFreeBytes = defaultFreeBytes,
  } = options;

  let directory: Promise<FileSystemDirectoryHandle> | null = null;
  const dir = () => {
    directory ??= getRoot().then(root => root.getDirectoryHandle(directoryName, { create: true }));
    // A failed attempt should not be remembered, or one transient error would
    // disable storage for the rest of the session.
    directory.catch(() => {
      directory = null;
    });
    return directory;
  };

  /** A kept file and its recorded size, or undefined if there is no complete one. */
  async function readComplete(name: string): Promise<File | undefined> {
    const folder = await dir();
    let size: number;
    try {
      const marker = await (await folder.getFileHandle(`${name}.ok`)).getFile();
      size = JSON.parse(await marker.text()).size;
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }

    try {
      const file = await (await folder.getFileHandle(`${name}.bin`)).getFile();
      // The marker is only written after the file completes, so a mismatch
      // means something else truncated it. Serving it would fail to load on
      // every visit; treating it as a miss downloads it once more.
      return file.size === size ? file : undefined;
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }

  async function discard(name: string) {
    const folder = await dir();
    for (const entry of [`${name}.ok`, `${name}.bin`]) {
      try {
        await folder.removeEntry(entry);
      } catch {
        // Already gone, which is the goal.
      }
    }
  }

  const fail = (key: string, reason: string) => {
    console.warn(`[AiVoiceAvatar] Could not keep ${key} for next time: ${reason}`);
    onStoreFailed?.(key, reason);
  };

  return {
    async match(key) {
      try {
        const file = await readComplete(await nameFor(key));
        if (file) {
          return new Response(file, {
            headers: { 'content-length': String(file.size) },
          });
        }
      } catch {
        // A storage error on read is a miss, not a reason to stop loading.
      }

      try {
        const legacy = await getLegacyCache();
        return (await legacy?.match(key)) ?? undefined;
      } catch {
        return undefined;
      }
    },

    async put(key, response) {
      let name: string;
      try {
        name = await nameFor(key);
        if (await readComplete(name)) return;
      } catch (err) {
        fail(key, `storage is unavailable (${(err as Error)?.message ?? err})`);
        return;
      }

      const declared = Number(response.headers.get('content-length'));
      const expected = Number.isFinite(declared) && declared > 0 ? declared : undefined;

      if (expected !== undefined) {
        const free = await getFreeBytes().catch(() => undefined);
        if (free !== undefined && free < expected) {
          fail(key, `not enough storage (${mb(expected)} needed, ${mb(free)} free)`);
          return;
        }
      }

      try {
        // Drop any old marker first, so an interrupted rewrite can never leave
        // a valid-looking marker beside a half-written file.
        await discard(name);

        const folder = await dir();
        const handle = await folder.getFileHandle(`${name}.bin`, { create: true });
        const written = await writeBody(handle, response);

        if (expected !== undefined && written !== expected) {
          await discard(name);
          fail(key, `wrote ${written} bytes where ${expected} were expected`);
          return;
        }

        const marker = await folder.getFileHandle(`${name}.ok`, { create: true });
        await writeBody(marker, new Response(JSON.stringify({ size: written, key })));
      } catch (err) {
        await discard(name).catch(() => {});
        fail(key, (err as Error)?.message ?? String(err));
      }
    },

    async delete(key) {
      try {
        const name = await nameFor(key);
        const existed = (await readComplete(name)) !== undefined;
        await discard(name);
        return existed;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Write a response body to a file and return how many bytes went in.
 *
 * `createWritable` streams into a swap file that replaces the original only
 * when closed, so a reader never sees half of it. Safari's workers have long
 * lacked it, so the synchronous access handle — available in every worker
 * that has OPFS — is the fallback.
 */
async function writeBody(handle: FileSystemFileHandle, response: Response): Promise<number> {
  const body = response.body;
  let written = 0;

  if (typeof (handle as any).createWritable === 'function') {
    const writable: FileSystemWritableFileStream = await (handle as any).createWritable();
    if (!body) {
      await writable.close();
      return 0;
    }
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        written += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    await body.pipeThrough(counter).pipeTo(writable);
    return written;
  }

  const access = await (handle as any).createSyncAccessHandle();
  try {
    access.truncate(0);
    if (body) {
      const reader = body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        written += access.write(value, { at: written });
      }
    }
    access.flush();
    return written;
  } finally {
    access.close();
  }
}

async function defaultLegacyCache() {
  if (typeof caches === 'undefined') return undefined;
  return caches.open('transformers-cache');
}

async function defaultFreeBytes() {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return undefined;
  const { quota, usage } = await navigator.storage.estimate();
  return quota !== undefined && usage !== undefined ? quota - usage : undefined;
}

function mb(bytes: number) {
  return `${Math.round(bytes / 1048576)} MB`;
}
