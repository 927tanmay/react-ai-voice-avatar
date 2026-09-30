import { useRef, useState } from 'react';

/**
 * The demo's replies: a hosted model first, the in-browser one once it lands.
 *
 * Shared by the homepage and the voice-only page. It lives in its own module,
 * free of three.js, so the voice page can use it without pulling the avatar in.
 */

/**
 * Named in the label, so a visitor knows whose model answered them.
 *
 * Which one it is cannot be hardcoded here: the route tries several candidates
 * and uses the first the account can reach, and the one it reached last week
 * can return `model_not_found` today. So the reply carries its own model id and
 * this only makes it readable.
 */
const HOSTED_MODEL_NAMES: Record<string, string> = {
  'llama-3.3-70b-versatile': 'Llama 3.3 70B on Groq',
  'openai/gpt-oss-20b': 'GPT-OSS 20B on Groq',
  'llama-3.1-8b-instant': 'Llama 3.1 8B on Groq',
};
const hostedModelName = (id: string | null) =>
  id ? HOSTED_MODEL_NAMES[id] || `${id} on Groq` : 'a hosted model on Groq';

const LOCAL_MODEL = 'Qwen2.5-0.5B, in your browser';

/**
 * What the assistant says when the hosted route will not answer.
 *
 * It is a rate limit or a missing key, never a model reply, so it says so
 * plainly rather than inventing an apology in the assistant's voice.
 */
const HOSTED_UNAVAILABLE_LOCAL_COMING =
  "The hosted model isn't answering right now, and I'm still downloading the one that runs in your browser. Give me a minute and ask again.";
const HOSTED_UNAVAILABLE =
  "The hosted model isn't answering right now. On a desktop this runs a model in your browser instead, with no limit at all.";

export const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;

/**
 * Starts hosted, because a 0.5B model in a browser answers "what drinks do you
 * have?" with a question and that is the first thing a visitor sees. On a
 * machine that can run one, the local model downloads during the conversation
 * and takes over — which is the package's actual claim, demonstrated rather
 * than asserted.
 */
export function useHostedBrain(canRunLocalLlm: boolean) {
  const [brain, setBrain] = useState<'hosted' | 'local'>('hosted');
  /** Which hosted model replied, as the route reported it. Null until it does. */
  const [hostedModel, setHostedModel] = useState<string | null>(null);

  /**
   * The conversation so far, sent back to the hosted route so it can follow up.
   *
   * Kept here rather than read from the engine because the hosted route is the
   * thing that needs it, and the engine deliberately does not record turns it
   * did not answer itself.
   */
  const historyRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);

  const askHosted = async (text: string): Promise<string> => {
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, history: historyRef.current }),
      });

      if (res.ok) {
        const data = await res.json();
        const reply: string = data.reply;
        if (data.model) setHostedModel(data.model);
        historyRef.current = [
          ...historyRef.current,
          { role: 'user' as const, content: text },
          { role: 'assistant' as const, content: reply },
        ].slice(-4);
        return reply;
      }

      // Every refusal — no key in local development, a rate limit, an outage —
      // lands here, and the visitor gets the same honest sentence.
      console.warn('[demo] hosted reply unavailable:', res.status);
    } catch (err) {
      console.warn('[demo] hosted reply failed:', err);
    }

    return canRunLocalLlm ? HOSTED_UNAVAILABLE_LOCAL_COMING : HOSTED_UNAVAILABLE;
  };

  return {
    brain,
    /** Pass as `onSubmit`: set while hosted, undefined once the local model answers. */
    onSubmit: brain === 'hosted' ? askHosted : undefined,
    /** Pass as `onLocalLlmReady`. Dropping `onSubmit` is what hands over. */
    switchToLocal: () => setBrain('local'),
    /** Back to hosted, for a fresh engine whose local model has not loaded. */
    reset: () => setBrain('hosted'),
    /** Who answered, for a visitor. */
    answeredBy: brain === 'hosted' ? hostedModelName(hostedModel) : LOCAL_MODEL,
  };
}
