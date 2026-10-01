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
  'openai/gpt-oss-20b': 'GPT-OSS 20B on Groq',
  'openai/gpt-oss-120b': 'GPT-OSS 120B on Groq',
  'llama-3.3-70b-versatile': 'Llama 3.3 70B on Groq',
  'llama-3.1-8b-instant': 'Llama 3.1 8B on Groq',
};
const hostedModelName = (id: string | null) =>
  id ? HOSTED_MODEL_NAMES[id] || `${id} on Groq` : 'a hosted model on Groq';

const LOCAL_MODEL = 'Qwen2.5-0.5B, in your browser';

/** Where someone can run all of this on their own free key. */
export const OWN_KEY_EXAMPLE = 'https://github.com/927tanmay/react-ai-voice-avatar/tree/main/examples/groq-voice';

/**
 * Why the hosted route refused, as the visitor needs to hear it.
 *
 * `visitor`: this person's hourly share. `site`: Groq's free tier, which the
 * whole demo shares, is used up or busy. `down`: anything else, including no
 * key in local development.
 */
export type HostedRefusal = 'visitor' | 'site' | 'down';

function refusalOf(status: number, error: string | undefined): HostedRefusal {
  if (status === 429 && error === 'per-visitor-limit') return 'visitor';
  if (status === 429 || (status === 503 && error === 'unavailable')) return 'site';
  return 'down';
}

/**
 * What the assistant says instead of a reply.
 *
 * It is a limit or an outage, never a model reply, so it says which plainly
 * rather than inventing an apology, and says what happens next.
 */
function refusalLine(refusal: HostedRefusal, localComing: boolean): string {
  const why = {
    visitor: "That's your twelve free hosted replies for this hour, so everyone else gets a turn.",
    site: "The free hosted model this demo runs on is used up for now. It's shared by everyone trying the demo.",
    down: "The hosted model isn't answering right now.",
  }[refusal];
  return localComing
    ? `${why} I'm downloading a model that runs in your browser instead, with no limit. Give me a minute and ask again.`
    : `${why} You can run all of this on your own free key; the link is on the page.`;
}

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
  /** Why the last hosted request was refused; cleared by the next reply. */
  const [refusal, setRefusal] = useState<HostedRefusal | null>(null);

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
        setRefusal(null);
        historyRef.current = [
          ...historyRef.current,
          { role: 'user' as const, content: text },
          { role: 'assistant' as const, content: reply },
        ].slice(-4);
        return reply;
      }

      const body = await res.json().catch(() => ({}));
      console.warn('[demo] hosted reply unavailable:', res.status, body?.error);
      const why = refusalOf(res.status, body?.error);
      setRefusal(why);
      return refusalLine(why, canRunLocalLlm);
    } catch (err) {
      console.warn('[demo] hosted reply failed:', err);
    }

    setRefusal('down');
    return refusalLine('down', canRunLocalLlm);
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
    /** Why hosted replies are not coming, while the demo is still on them. */
    refusal: brain === 'hosted' ? refusal : null,
  };
}
