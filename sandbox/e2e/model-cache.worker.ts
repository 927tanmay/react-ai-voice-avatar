import { createModelCache, isModelCacheSupported } from 'react-ai-voice-avatar/model-cache';

/**
 * What a host's own model worker does with the cache: keep a file, and get it
 * back as it would on the next visit. Reports to sandbox/e2e/model-cache.html.
 */
const run = async () => {
  if (!isModelCacheSupported()) return { supported: false };
  const cache = createModelCache({ directoryName: 'e2e-model-cache' });
  const key = 'https://example.test/model.onnx';
  const bytes = new Uint8Array(4 * 1024 * 1024).map((_, i) => i % 251);

  const before = await cache.match(key);
  await cache.put(key, new Response(bytes, { headers: { 'content-length': String(bytes.length) } }));
  const kept = await cache.match(key);
  const back = new Uint8Array(await kept!.arrayBuffer());
  const same = back.length === bytes.length && back.every((b, i) => b === bytes[i]);
  await cache.delete(key);

  return { supported: true, missBefore: before === undefined, size: back.length, same, gone: (await cache.match(key)) === undefined };
};

run().then(r => self.postMessage(r), err => self.postMessage({ error: String(err) }));
