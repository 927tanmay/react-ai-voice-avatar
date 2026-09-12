/**
 * True when the page is being served from a local development host.
 *
 * Avatars are normally streamed from a CDN pinned to this repository's main
 * branch, which means a locally modified GLB can never be seen until it is
 * committed, merged and the CDN cache expires. That makes working on an avatar
 * effectively impossible. Probing for a local copy first while developing fixes
 * that, and costs production nothing because this is false there.
 */
function isLocalDevHost(): boolean {
  if (typeof window === 'undefined' || !window.location) return false;
  const { hostname, protocol } = window.location;
  if (protocol === 'file:') return true;
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local')
  );
}

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
  // Stream high-resolution GLB mesh over global edge CDN directly from GitHub releases (zero NPM bundle weight!)
  const cdnUrl = `https://cdn.jsdelivr.net/gh/927tanmay/react-ai-voice-avatar@main/assets/avatars/${fileName}`;

  let resolvedUrl = cdnUrl;

  // Explicit opt-in wins; otherwise probe locally while developing, where a
  // 404 in the console is a fair price for being able to see your own changes.
  const shouldProbeLocal = enableLocalAssetProbe ?? isLocalDevHost();

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
