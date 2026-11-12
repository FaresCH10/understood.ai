export type DraftStep='source'|'recipients'|'publish';
export type DraftFlowState={id?:string;state?:string;source?:string;prepared?:{source?:unknown}|null;archive?:unknown;contentExpired?:boolean};
export function draftSteps(draft:DraftFlowState|null){
  const saved=Boolean(draft?.id),closed=Boolean(draft?.archive || draft?.contentExpired);
  const ready=saved && !closed && draft?.state==='ready' && typeof draft.source==='string' && draft.source.length>0 && draft.prepared?.source===draft.source;
  return [
    {id:'source' as const,label:'Content',status:saved?'Saved':'Not saved',available:!closed},
    {id:'recipients' as const,label:'Recipients',status:ready?'Choose workers':'Not ready yet',available:saved && !closed},
    {id:'publish' as const,label:'Review and send',status:ready?'Ready to send':'Not ready yet',available:ready},
  ];
}
