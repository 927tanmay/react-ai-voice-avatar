export async function resolveAvatarUrl(
  preset: 'ananya' | 'aarav' | 'default' | 'kiosk' = 'ananya',
  onProgress?: (pct: number, label: string) => void
): Promise<string> {
  const fileMap: Record<string, string> = {
    ananya: 'ananya.glb',
    aarav: 'aarav.glb',
    default: 'default.glb',
    kiosk: 'default.glb',
  };

  const fileName = fileMap[preset] || fileMap.ananya;
  const localPath = `/${fileName}`;
  // Stream high-resolution GLB mesh over global edge CDN directly from GitHub releases (zero NPM bundle weight!)
  const cdnUrl = `https://cdn.jsdelivr.net/gh/927tanmay/react-ai-voice-avatar@main/assets/avatars/${fileName}`;

  let resolvedUrl = cdnUrl;

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
