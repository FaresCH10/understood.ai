import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';

// Import from this module in animated components so the React hook uses the
// same GSAP instance. Components own their scoped animations and cleanup.
gsap.registerPlugin(useGSAP);

export { gsap, useGSAP };
