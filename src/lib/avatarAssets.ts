/**
 * Git tag the bundled avatars are served from.
 *
 * Immutable by design: see the CDN URL below for why a branch is not.
 */
const ASSET_TAG = 'avatars-v1';

export async function resolveAvatarUrl(
  preset: 'ananya' | 'aarav' | 'default' | 'kiosk' = 'ananya',
  onProgress?: (pct: number, label: string) => void,
  enableLocalAssetProbe?: boolean
): Promise<string> {
  // `default` and `kiosk` are aliases rather than separate meshes. They used to
  // point at a default.glb that was byte-identical to ananya.glb, so shipping it
  // cost a duplicate multi-megabyte download for nothing.
  const fileMap: Record<string, string> = {
    ananya: 'ananya.glb',
    aarav: 'aarav.glb',
    default: 'ananya.glb',
    kiosk: 'ananya.glb',
  };

  const fileName = fileMap[preset] || fileMap.ananya;
  const localPath = `/${fileName}`;
  // Stream the GLB from a global edge CDN rather than shipping it in the npm
  // package, which keeps the install small.
  //
  // Pinned to a tag rather than to a branch. On `@main` every merge silently
  // changes what existing installs download, and because jsDelivr caches
  // aggressively, half your users see the old avatar and half the new one for
  // as long as the cache holds. A tag is immutable, so an install keeps the
  // avatar it was built against. Bump ASSET_TAG when a bundled avatar changes.
  const cdnUrl = `https://cdn.jsdelivr.net/gh/927tanmay/react-ai-voice-avatar@${ASSET_TAG}/assets/avatars/${fileName}`;

  let resolvedUrl = cdnUrl;

  // Opt-in only.
  //
  // This briefly defaulted to on for any localhost origin, so that a locally
  // modified GLB could be seen without waiting for a merge and a CDN cache to
  // expire. That was a convenience for developing this package paid for by
  // everyone developing *with* it: the probe 404s when no local copy exists, and
  // every Next.js app running on localhost got that 404 in its console on every
  // avatar load. Confirmed in a real Next.js build before reverting it.
  const shouldProbeLocal = enableLocalAssetProbe === true;

  if (shouldProbeLocal) {
    try {
      // Perform a lightweight HTTP HEAD probe to check if the asset is hosted locally in public/
      const headResponse = await fetch(localPath, { method: 'HEAD' });
      
      // Ensure status is OK (200) AND content-type is not an HTML 404 SPA routing fallback page
      if (headResponse.ok) {
        const contentType = headResponse.headers.get('content-type') || '';
        if (!contentType.toLowerCase().includes('text/html')) {
          resolvedUrl = localPath;
        }
      }
    } catch (e) {
      // Local check failed or offline without local file, seamlessly fall back to global CDN URL
      resolvedUrl = cdnUrl;
    }
  }

  // Stream asset download with real-time progress notifications if callback is attached
  if (onProgress) {
    try {
      const response = await fetch(resolvedUrl);
      if (!response.ok) throw new Error(`Failed to fetch avatar from ${resolvedUrl}`);
      
      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      
      if (total > 0 && response.body) {
        const reader = response.body.getReader();
        let loaded = 0;
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          loaded += value.length;
          onProgress(loaded / total, `avatar-${preset}`);
        }
      }
    } catch (e) {
      console.warn('Failed to stream avatar download with progress, proceeding to direct loader:', e);
    }
  }

  return resolvedUrl;
}
