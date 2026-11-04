import {useId} from 'react';

// A stationary rim with a seamless map moving inside it, rather than a rotating icon.
export function LanguageGlobe(){
  const clip=useId();
  const continents='M1 5 3 3 7 4 8 7 6 9 5 12 3 11 2 8Z M6 13 9 14 10 17 8 21 6 19 5 16Z M12 5 14 3 18 4 20 3 23 6 22 9 19 10 17 8 15 9 14 7Z M13 10 17 11 18 14 16 18 14 17 12 13Z M20 17 23 16 24 19 21 20Z';
  return <svg className="language-globe" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <defs><clipPath id={clip}><circle cx="12" cy="12" r="9.2"/></clipPath></defs>
    <g clipPath={`url(#${clip})`}><g className="language-globe-map">
      <path d={continents}/><path d={continents} transform="translate(24 0)"/>
    </g></g>
    <circle className="language-globe-rim" cx="12" cy="12" r="10"/>
  </svg>;
}
