import { lazy, Suspense, forwardRef } from 'react';
import type { AiVoiceAvatarProps, AiVoiceAvatarHandle } from './AiVoiceAvatar';
import { AiVoiceAvatarSkeleton } from './AiVoiceAvatarSkeleton';

// Dynamically import the heavy AiVoiceAvatar component.
// This defers loading ML models, 3D assets, and workers until the component is actually rendered.
const AiVoiceAvatarImpl = lazy(() => 
  import('./AiVoiceAvatar').then(mod => ({ default: mod.AiVoiceAvatar }))
);

export const AiVoiceAvatarLazy = forwardRef<AiVoiceAvatarHandle, AiVoiceAvatarProps>((props, ref) => {
  return (
    <Suspense fallback={<AiVoiceAvatarSkeleton />}>
      <AiVoiceAvatarImpl ref={ref} {...props} />
    </Suspense>
  );
});
