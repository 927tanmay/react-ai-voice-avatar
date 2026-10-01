import React, { useState } from 'react';

/**
 * Type instead of talking.
 *
 * Plenty of people will not open a microphone for a page they found a minute
 * ago: at work, on a train, or simply wary. Without this they could look at
 * the demo but never hear it answer. The reply is spoken all the same.
 *
 * Shared by the homepage, /voice and the scenario pages, and free of three.js
 * like everything the voice page imports.
 */
export const TypeBox: React.FC<{
  onSend: (text: string) => void;
  disabled?: boolean;
  accent: string;
  /** Text colour on the accent. Dark by default; white on darker accents. */
  accentText?: string;
  placeholder?: string;
  style?: React.CSSProperties;
}> = ({ onSend, disabled = false, accent, accentText = '#0B1220', placeholder = 'Or type a message…', style }) => {
  const [text, setText] = useState('');
  const ready = !disabled && text.trim().length > 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    onSend(text.trim());
    setText('');
  };

  return (
    <form
      onSubmit={submit}
      style={{
        display: 'flex', width: '100%', maxWidth: '400px', boxSizing: 'border-box',
        background: 'rgba(20, 22, 28, 0.85)', backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '9999px',
        padding: '6px 6px 6px 20px', boxShadow: '0 12px 40px rgba(0, 0, 0, 0.4)',
        ...style,
      }}
    >
      <input
        type="text"
        aria-label="Type a message"
        value={text}
        onChange={e => setText(e.target.value)}
        disabled={disabled}
        placeholder={disabled ? 'Warming up…' : placeholder}
        style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', color: '#FFFFFF', fontSize: '15px', outline: 'none', opacity: disabled ? 0.5 : 1 }}
      />
      <button
        type="submit"
        disabled={!ready}
        style={{
          background: ready ? accent : 'rgba(255, 255, 255, 0.1)',
          color: ready ? accentText : '#64748B',
          border: 'none', borderRadius: '9999px', padding: '10px 18px', fontSize: '14px',
          fontWeight: 700, cursor: ready ? 'pointer' : 'not-allowed', transition: 'all 0.2s ease',
          minHeight: '40px',
        }}
      >
        Send
      </button>
    </form>
  );
};
