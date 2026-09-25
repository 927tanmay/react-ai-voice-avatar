/**
 * test-model-cache.mjs
 *
 * The OPFS model cache, against an in-memory stand-in for the file system.
 *
 * What matters here is what it refuses to serve. A cache that hands back a
 * half-written 750 MB model fails to load on every visit after, which is worse
 * than the re-download it exists to prevent. So most of these are about
 * interrupted writes, sizes that disagree, and running out of room.
 *
 * What these cannot show is the thing the module is for: that a real browser
 * keeps a file above 256 MiB in OPFS where the Cache API would not. That is
 * verified in Chrome, by loading the demo twice and watching the network.
 *
 * Run: node --experimental-strip-types scripts/test-model-cache.mjs
 */

const { createModelCache } = await import('../src/lib/modelCache.ts');

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ── An in-memory OPFS ────────────────────────────────────────────────────────

class NotFoundError extends Error {
  constructor(name) {
    super(`${name} not found`);
    this.name = 'NotFoundError';
  }
}

const concat = chunks => {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
};

/**
 * A directory tree whose files commit only when their writer closes, as
 * Chrome's `createWritable` does. `writable: false` removes `createWritable`,
 * leaving only the synchronous access handle Safari's workers offer.
 */
function fakeRoot({ writable = true } = {}) {
  const dirs = new Map();

  const fileHandle = (files, name) => {
    const handle = {
      async getFile() {
        return new File([files.get(name)], name);
      },
    };
    if (writable) {
      handle.createWritable = async () => {
        const chunks = [];
        return new WritableStream({
          write(chunk) {
            chunks.push(chunk);
          },
          close() {
            files.set(name, concat(chunks));
          },
          abort() {
            // A swap file that is thrown away: the original is untouched.
          },
        });
      };
    } else {
      handle.createSyncAccessHandle = async () => {
        let buf = files.get(name);
        return {
          truncate(n) {
            buf = buf.slice(0, n);
          },
          write(value, { at }) {
            const next = new Uint8Array(Math.max(buf.byteLength, at + value.byteLength));
            next.set(buf);
            next.set(value, at);
            buf = next;
            return value.byteLength;
          },
          flush() {
            files.set(name, buf);
          },
          close() {
            files.set(name, buf);
          },
        };
      };
    }
    return handle;
  };

  const makeDir = () => {
    const files = new Map();
    return {
      files,
      async getFileHandle(name, { create } = {}) {
        if (!files.has(name)) {
          if (!create) throw new NotFoundError(name);
          files.set(name, new Uint8Array(0));
        }
        return fileHandle(files, name);
      },
      async removeEntry(name) {
        if (!files.delete(name)) throw new NotFoundError(name);
      },
    };
  };

  return {
    dirs,
    async getDirectoryHandle(name, { create } = {}) {
      if (!dirs.has(name)) {
        if (!create) throw new NotFoundError(name);
        dirs.set(name, makeDir());
      }
      return dirs.get(name);
    },
  };
}

const bytes = (n, seed = 7) => Uint8Array.from({ length: n }, (_, i) => (i * seed) & 255);

const responseOf = (data, { declared = data.byteLength } = {}) =>
  new Response(data, { headers: declared === null ? {} : { 'content-length': String(declared) } });

/** A response whose body fails partway, as a dropped connection or closed tab would. */
const brokenResponse = (data, failAfter) =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(data.slice(0, failAfter));
        controller.error(new Error('connection reset'));
      },
    }),
    { headers: { 'content-length': String(data.byteLength) } }
  );

function setup(overrides = {}) {
  const root = fakeRoot(overrides.fs);
  const failures = [];
  const cache = createModelCache({
    getRoot: async () => root,
    getLegacyCache: overrides.legacy ?? (async () => undefined),
    getFreeBytes: overrides.freeBytes ?? (async () => undefined),
    onStoreFailed: (key, reason) => failures.push({ key, reason }),
  });
  return { root, cache, failures, files: () => root.dirs.get('react-ai-voice-avatar-models')?.files };
}

const URL_A = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model.onnx';
const URL_B = 'https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct/resolve/main/onnx/model_q4.onnx';

// Silence the module's own warnings; the assertions check what it reported.
const warn = console.warn;
console.warn = () => {};

// ── Tests ────────────────────────────────────────────────────────────────────

console.log('\nKeeping a file');
{
  const { cache, failures } = setup();
  check('an unknown file is a miss', (await cache.match(URL_A)) === undefined);

  const data = bytes(4096);
  await cache.put(URL_A, responseOf(data));
  const hit = await cache.match(URL_A);
  const back = hit && new Uint8Array(await hit.arrayBuffer());

  check('a kept file is served back', hit !== undefined);
  check('byte for byte', back && back.byteLength === data.byteLength && back.every((b, i) => b === data[i]));
  check('with its length declared, as the library reads it', hit?.headers.get('content-length') === '4096');
  check('and nothing was reported as failing', failures.length === 0, JSON.stringify(failures));
}
{
  const { cache } = setup();
  await cache.put(URL_A, responseOf(bytes(100, 3)));
  await cache.put(URL_B, responseOf(bytes(200, 5)));
  const a = await cache.match(URL_A);
  const b = await cache.match(URL_B);
  check('two files do not overwrite each other', (await a.arrayBuffer()).byteLength === 100 && (await b.arrayBuffer()).byteLength === 200);
}
{
  const { cache, files } = setup();
  await cache.put(URL_A, responseOf(bytes(64)));
  const before = files().size;
  await cache.put(URL_A, responseOf(bytes(64)));
  check('keeping the same file twice writes nothing new', files().size === before);
}

console.log('\nWhat it refuses to serve');
{
  const { cache, failures, files } = setup();
  await cache.put(URL_A, brokenResponse(bytes(10000), 3000));
  check('a download cut off partway is never served', (await cache.match(URL_A)) === undefined);
  check('and leaves nothing behind', [...files().keys()].length === 0, [...files().keys()].join(', '));
  check('and says why', failures.length === 1 && /connection reset/.test(failures[0].reason), JSON.stringify(failures));
}
{
  const { cache, failures } = setup();
  // The server said 5000 bytes and sent 3000 without an error: a silent short read.
  await cache.put(URL_A, responseOf(bytes(3000), { declared: 5000 }));
  check('a file shorter than it claimed is not kept', (await cache.match(URL_A)) === undefined);
  check('and the mismatch is reported', failures.length === 1 && /3000 bytes where 5000/.test(failures[0].reason), JSON.stringify(failures));
}
{
  const { cache, files } = setup();
  await cache.put(URL_A, responseOf(bytes(2048)));
  // Something outside this module truncated the file after it was kept.
  const [binName] = [...files().keys()].filter(n => n.endsWith('.bin'));
  files().set(binName, bytes(1000));
  check('a kept file that no longer matches its size is a miss', (await cache.match(URL_A)) === undefined);
}
{
  const { cache, files } = setup();
  await cache.put(URL_A, responseOf(bytes(2048)));
  const [okName] = [...files().keys()].filter(n => n.endsWith('.ok'));
  files().delete(okName);
  check('a file with no completion marker is never trusted', (await cache.match(URL_A)) === undefined);
}
{
  const { cache, files } = setup();
  await cache.put(URL_A, responseOf(bytes(2048)));
  // The kept file is damaged, so it no longer counts as complete and the next
  // load writes it again — and that write dies partway. The old marker still
  // says 2048 bytes. If it survived, a later write that happened to reach 2048
  // bytes of the wrong content would be served as good.
  const [binName] = [...files().keys()].filter(n => n.endsWith('.bin'));
  files().set(binName, bytes(10));
  await cache.put(URL_A, brokenResponse(bytes(2048), 500));
  check('an interrupted rewrite does not leave the old marker behind', ![...files().keys()].some(n => n.endsWith('.ok')), [...files().keys()].join(', '));
  check('or any file at all', files().size === 0, [...files().keys()].join(', '));
  check('and is a miss', (await cache.match(URL_A)) === undefined);
}
{
  // The case that matters most, and the one no error handler can cover: the
  // tab closes during the write. Nothing runs afterwards, so whatever is on disk
  // at that instant is what the next visit finds. Modelled by a download that
  // never finishes, inspected while it is still in flight.
  const { cache, files } = setup({ fs: { writable: false } });
  await cache.put(URL_A, responseOf(bytes(2048)));
  const [binName] = [...files().keys()].filter(n => n.endsWith('.bin'));
  files().set(binName, bytes(10));

  const neverEnds = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes(2048).slice(0, 700));
      },
    }),
    { headers: { 'content-length': '2048' } }
  );
  cache.put(URL_A, neverEnds); // deliberately not awaited: the tab is about to close
  await new Promise(r => setTimeout(r, 20));

  check(
    'a tab closed mid-write leaves no marker for the next visit to trust',
    ![...files().keys()].some(n => n.endsWith('.ok')),
    [...files().keys()].join(', ')
  );
}

console.log('\nRunning out of room');
{
  const { cache, failures, files } = setup({ freeBytes: async () => 1000 });
  await cache.put(URL_A, responseOf(bytes(5000)));
  check('a file larger than the free space is not attempted', (files()?.size ?? 0) === 0);
  check('and the shortfall is reported plainly', failures.length === 1 && /not enough storage/.test(failures[0].reason), JSON.stringify(failures));
}
{
  const { cache, failures } = setup({ freeBytes: async () => undefined });
  await cache.put(URL_A, responseOf(bytes(5000)));
  check('a browser that will not say how much room there is still gets the file kept', (await cache.match(URL_A)) !== undefined && failures.length === 0);
}

console.log('\nFiles the Cache API already kept');
{
  const legacyData = bytes(777);
  const legacy = async () => ({
    match: async key => (key === URL_A ? responseOf(legacyData) : undefined),
  });
  const { cache } = setup({ legacy });
  const hit = await cache.match(URL_A);
  check('are served on a miss, so Whisper is not downloaded again', hit !== undefined && (await hit.arrayBuffer()).byteLength === 777);
  check('without inventing hits for anything else', (await cache.match(URL_B)) === undefined);
}
{
  const legacy = async () => {
    throw new Error('SecurityError: caches unavailable');
  };
  const { cache } = setup({ legacy });
  check('an unavailable Cache API is a miss, not a crash', (await cache.match(URL_A)) === undefined);
}

console.log('\nStorage that fails');
{
  const failures = [];
  const cache = createModelCache({
    getRoot: async () => {
      throw new Error('SecurityError: OPFS is not available in this context');
    },
    getLegacyCache: async () => undefined,
    onStoreFailed: (key, reason) => failures.push({ key, reason }),
  });
  let threw = false;
  try {
    await cache.put(URL_A, responseOf(bytes(100)));
    await cache.match(URL_A);
  } catch {
    threw = true;
  }
  check('never throws into the library loading the model', !threw);
  check('reports that storage is unavailable', failures.length === 1 && /unavailable/.test(failures[0].reason), JSON.stringify(failures));
}

console.log('\nSafari-style workers, with only a synchronous access handle');
{
  const { cache, failures } = setup({ fs: { writable: false } });
  const data = bytes(3333, 11);
  await cache.put(URL_A, responseOf(data));
  const hit = await cache.match(URL_A);
  const back = hit && new Uint8Array(await hit.arrayBuffer());
  check('keep files just the same', back && back.byteLength === 3333 && back.every((b, i) => b === data[i]), JSON.stringify(failures));
}

console.warn = warn;
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
