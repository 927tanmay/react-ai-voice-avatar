import { useEffect, useRef } from 'react';

export interface StatusPillProps {
  status: 'loading' | 'idle' | 'listening' | 'thinking' | 'speaking';
  accentColor?: string;
  analyser?: AnalyserNode; // For the waveform
  onPillClick?: () => void;
  onStopClick?: () => void;
  style?: React.CSSProperties;
}

export function StatusPill({ status, accentColor = '#3b82f6', analyser, onPillClick, onStopClick, style }: StatusPillProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Status text mapping
  const statusLabels = {
    loading: 'Loading models...',
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
          backgroundColor: status === 'loading' ? '#f59e0b' : status === 'listening' ? '#ef4444' : accentColor,
          boxShadow: status === 'loading' ? '0 0 10px #f59e0b' : status === 'listening' ? '0 0 10px #ef4444' : `0 0 10px ${accentColor}`,
          transition: 'all 0.3s ease'
        }}
      />
      
      <span style={{ fontWeight: 600, minWidth: '80px', fontSize: '15px', letterSpacing: '0.3px' }}>
        {statusLabels[status]}
      </span>

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
