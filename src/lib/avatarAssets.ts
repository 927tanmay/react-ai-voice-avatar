export async function resolveAvatarUrl(
  preset: 'ananya' | 'aarav' | 'default' | 'kiosk' = 'ananya',
  onProgress?: (pct: number, label: string) => void
): Promise<string> {
  // In a real production package, this would point to a CDN like jsDelivr or GitHub Releases.
  // For now, we point to the public path where the sandbox hosts it.
  const urlMap: Record<string, string> = {
    ananya: '/ananya.glb',
    aarav: '/aarav.glb',
    default: '/default.glb',
    kiosk: '/default.glb',
  };

  const targetUrl = urlMap[preset] || urlMap.ananya;

  // We simulate fetching it with progress if the callback is provided
  if (onProgress) {
    try {
      const response = await fetch(targetUrl);
      if (!response.ok) throw new Error('Failed to fetch avatar');
      
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
      console.error('Failed to fetch avatar with progress', e);
    }
  }

  return targetUrl;
}
