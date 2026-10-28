export const PUBLIC_SECTIONS=[
  {id:'platform',en:'Platform',ar:'المنصة'},
  {id:'how-it-works',en:'How it works',ar:'كيف تعمل'},
  {id:'languages',en:'Languages',ar:'اللغات'},
  {id:'companies',en:'For companies',ar:'للشركات'},
  {id:'plans',en:'Plans',ar:'الخطط'},
] as const;

export function isPublicLandingView(view:string){
  return view==='home'||view==='platform/worker'||view==='platform/supervisor'||view==='company-controls'||PUBLIC_SECTIONS.some(section=>section.id===view);
}

export function publicLandingTarget(view:string){
  if(view==='platform/worker'||view==='platform/supervisor')return 'platform';
  if(view==='company-controls')return 'company-controls';
  return PUBLIC_SECTIONS.some(section=>section.id===view)?view:'landing-top';
}
