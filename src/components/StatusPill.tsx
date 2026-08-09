import { useEffect, useRef } from 'react';

export interface StatusPillProps {
  status: 'loading' | 'idle' | 'listening' | 'thinking' | 'speaking';
  accentColor?: string;
  analyser?: AnalyserNode; // For the waveform
  onPillClick?: () => void;
  onStopClick?: () => void;
  micError?: string | null;
  engineWarning?: string | null;
  loadingLabel?: string;
  loadingPct?: number;
  style?: React.CSSProperties;
}

export function StatusPill({ status, accentColor = '#3b82f6', analyser, onPillClick, onStopClick, micError, engineWarning, loadingLabel, loadingPct, style }: StatusPillProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const formatLoadingText = () => {
    if (loadingLabel && loadingPct !== undefined && loadingPct > 0) {
      return `Downloading ${loadingLabel} (${Math.round(loadingPct)}%)...`;
    }
    if (loadingLabel) {
      return `Initializing ${loadingLabel}...`;
    }
    return 'Downloading AI models...';
  };

  // Status text mapping
  const statusLabels = {
    loading: formatLoadingText(),
    idle: 'Tap to start',
    listening: 'Listening...',
    thinking: 'Thinking...',
    speaking: 'Speaking...'
  };

  // Basic waveform drawing
  useEffect(() => {
    if ((status !== 'listening' && status !== 'speaking') || !analyser || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let animationId: number;

    const draw = () => {
      animationId = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 2;
      ctx.strokeStyle = accentColor;
      ctx.beginPath();

      const sliceWidth = canvas.width / dataArray.length;
      let x = 0;

      for (let i = 0; i < dataArray.length; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };

    draw();
    return () => cancelAnimationFrame(animationId);
  }, [status, analyser, accentColor]);

  const handleMainClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (status === 'loading') return;
    if (status === 'idle') {
      onPillClick?.();
    } else {
      onStopClick?.();
    }
  };

  return (
    <div
      onClick={handleMainClick}
      title={status === 'loading' ? 'Initializing AI models in Web Workers...' : status === 'idle' ? 'Start voice session' : 'Click to stop / pause'}
      style={{
        position: 'absolute',
        top: 'auto',
        bottom: '40px',
        left: '48px',
        transform: 'none',
        padding: '12px 24px',
        borderRadius: '9999px',
        backgroundColor: 'rgba(28, 28, 35, 0.75)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: '0 12px 40px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.15)',
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: '#fff',
        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        zIndex: 9999,
        cursor: status === 'loading' ? 'wait' : 'pointer',
        pointerEvents: 'auto',
        opacity: status === 'loading' ? 0.85 : 1,
        ...style,
      }}
    >
      <div
        style={{
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          backgroundColor: micError ? '#ef4444' : status === 'loading' ? '#f59e0b' : status === 'listening' ? '#ef4444' : accentColor,
          boxShadow: micError ? '0 0 12px #ef4444' : status === 'loading' ? '0 0 10px #f59e0b' : status === 'listening' ? '0 0 10px #ef4444' : `0 0 10px ${accentColor}`,
          transition: 'all 0.3s ease'
        }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span style={{ fontWeight: 600, minWidth: '80px', fontSize: '14px', letterSpacing: '0.3px', color: micError ? '#fca5a5' : '#fff' }}>
          {micError ? '🎙️ Microphone Access Denied — Check Permissions' : status === 'loading' && !loadingLabel ? '⏳ Downloading AI models (1st run cached)...' : statusLabels[status]}
        </span>
        {status === 'loading' && loadingPct !== undefined && loadingPct > 0 && (
          <div style={{ width: '100%', height: '3px', background: 'rgba(255,255,255,0.15)', borderRadius: '2px', overflow: 'hidden', marginTop: '2px' }}>
            <div style={{ width: `${Math.min(100, Math.max(5, loadingPct))}%`, height: '100%', background: '#f59e0b', transition: 'width 0.3s ease' }} />
          </div>
        )}
        {engineWarning && (
          <span style={{ fontSize: '11px', color: '#fcd34d', marginTop: '2px' }}>
            ⚠️ {engineWarning}
          </span>
        )}
      </div>

      {(status === 'speaking' || status === 'listening') && (
        <canvas
          ref={canvasRef}
          width={60}
          height={20}
          style={{ marginLeft: '4px' }}
        />
      )}

      {status !== 'idle' && status !== 'loading' && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStopClick?.();
          }}
          style={{
            background: 'rgba(239, 68, 68, 0.25)',
            border: '1px solid rgba(239, 68, 68, 0.6)',
            color: '#fff',
            borderRadius: '14px',
            padding: '4px 10px',
            fontSize: '12px',
            fontWeight: '600',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            transition: 'background 0.2s ease',
            marginLeft: '4px'
          }}
          title="Stop or Pause session"
        >
          <span style={{ fontSize: '10px' }}>⏹</span> Stop
        </button>
      )}
    </div>
  );
}
