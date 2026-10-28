# GSAP animations

GSAP and its official React integration are installed as pinned project
dependencies. Import the configured instance from `src/gsap.ts` in components
that need animation. The setup does not start animations or add GSAP to the
application entry point; Vite loads it when an animated component imports it.

## React example

This example lives beside `src/gsap.ts`. It animates on mount only when the
visitor permits motion. Content remains visible when motion is reduced.
`useGSAP` scopes animations to the component and cleans up on unmount, including
React Strict Mode's development remount. The media-query listener is also removed.

```tsx
import { useRef, type ReactNode } from 'react';
import { gsap, useGSAP } from './gsap';

export function AnimatedPanel({ children }: { children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const element = container.current;
    if (!element) return;

    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from(element, {
        y: 8,
        opacity: 0,
        duration: 0.25,
        ease: 'power2.out',
        clearProps: 'transform,opacity',
      });
    });

    return () => media.revert();
  }, { scope: container });

  return <div ref={container}>{children}</div>;
}
```

For animations that depend on props, set `dependencies` and `revertOnUpdate: true`
in the hook's configuration. Wrap later event callbacks with the hook's
`contextSafe` function so their animations are cleaned up too. Check motion
preferences for those callbacks as well.

## Optional plugins

Plugins are included in the `gsap` package. Import and register only the plugins
an animated component uses. For example, a component that needs scroll triggers
can add:

```tsx
import { gsap, useGSAP } from './gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);
```

Create the ScrollTriggers inside `useGSAP` or its `contextSafe` callbacks, with
component refs or scoped selectors. This keeps them tied to the component's
lifecycle. Prefer transforms and opacity for motion. Keep essential content and
controls usable with reduced motion and avoid global animation defaults.

## Agent skills

The eight official skills from `greensock/gsap-skills` are installed in the local
Codex skills directory: core, timelines, ScrollTrigger, plugins, utilities, React,
performance, and other frameworks. They are available to Codex on the next turn.

References: [GSAP with React](https://gsap.com/resources/React/),
[official GSAP skills](https://github.com/greensock/gsap-skills).
