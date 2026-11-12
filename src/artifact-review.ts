export const artifactReviewTabs=['text','audio','question','glossary'] as const;
export type ArtifactReviewTab=typeof artifactReviewTabs[number];
export function artifactTabsFor(prepared:{deliveryMode?:unknown;responseMode?:unknown}|null|undefined):readonly ArtifactReviewTab[] {
  const delivery=prepared?.deliveryMode;
  const questionIncluded=prepared?.responseMode!=='acknowledge';
  return artifactReviewTabs.filter(item=>(item!=='audio'||delivery!=='text')&&(item!=='question'||questionIncluded));
}
export function nextArtifactTab(current:ArtifactReviewTab,key:string,tabs:readonly ArtifactReviewTab[]=artifactReviewTabs):ArtifactReviewTab|null {
  const index=tabs.indexOf(current),length=tabs.length;
  if(!length)return null;
  if(key==='Home')return tabs[0];
  if(key==='End')return tabs.at(-1)!;
  if(key==='ArrowRight' || key==='ArrowLeft')return tabs[(index+(key==='ArrowRight'?1:length-1))%length];
  return null;
}
export async function copyArtifactText(value:string,context:string,readSession:()=>Promise<unknown>,writeText:(value:string)=>Promise<void>,current:()=>boolean,now=Date.now) {
  if(typeof value!=='string' || !value.trim() || value.length>5000 || value.includes('\0') || !/^[a-f0-9]{64}$/.test(context) || !current())throw Error('Copy unavailable');
  const session=await readSession() as {authenticated?:boolean;role?:string;staffRole?:string;clientContext?:string;expiresAt?:string};
  if(!current() || !session || typeof session!=='object' || Array.isArray(session) || session.authenticated!==true || session.role!=='staff' || !['owner','supervisor','auditor'].includes(session.staffRole??'')
    || session.clientContext!==context || typeof session.expiresAt!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(session.expiresAt)
    || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt)<=now())throw Error('Copy unavailable');
  await writeText(value);if(!current())throw Error('Copy context changed');
}
export function artifactGlossaryDependency(prepared:unknown) {
  const value=prepared as {dependencies?:{glossaryRevision?:unknown;glossaryHash?:unknown};provenance?:{glossary?:{revision?:unknown;hash?:unknown}}}|null;
  const revision=value?.dependencies?.glossaryRevision??value?.provenance?.glossary?.revision;
  const hash=value?.dependencies?.glossaryHash??value?.provenance?.glossary?.hash;
  return typeof revision==='number' && Number.isSafeInteger(revision) && revision>=0 && typeof hash==='string' && /^[a-f0-9]{64}$/.test(hash)?{revision,hash}:null;
}
