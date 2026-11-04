const landing=new Set(['home','platform','platform/worker','platform/supervisor','how-it-works','languages','companies','company-controls','plans']);
export function loadingRoute(hash:string){const route=hash.replace(/^#/,'')||'overview';return landing.has(route)?'landing':route;}
export function tracksPageRequest(url:string,method:string,origin:string){
  try{const parsed=new URL(url,origin);return method.toUpperCase()==='GET'&&parsed.origin===origin&&parsed.pathname.startsWith('/api/')&&!/\/(?:notifications|realtime|health)(?:\/|$)/.test(parsed.pathname);}catch{return false;}
}
export class PageLoadState{
  active=true;
  private generation=0;
  private pending=new Set<symbol>();
  private listeners=new Set<()=>void>();
  get size(){return this.pending.size;}
  subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
  private notify(){this.listeners.forEach(listener=>listener());}
  start(){this.generation++;this.pending.clear();this.active=true;this.notify();}
  finish(){this.active=false;}
  begin(){
    if(!this.active)return()=>{};
    const generation=this.generation,id=Symbol();this.pending.add(id);this.notify();
    return()=>{if(generation===this.generation&&this.pending.delete(id))this.notify();};
  }
}
export const pageLoads=new PageLoadState();
let installed=false;
// Observe only page GETs. Requests, responses, credentials and error handling remain untouched.
export function installPageLoadTracking(){
  if(installed)return;installed=true;
  const original=window.fetch.bind(window);
  window.fetch=async(input,init)=>{
    const url=input instanceof Request?input.url:String(input),method=init?.method||(input instanceof Request?input.method:'GET');
    const end=tracksPageRequest(url,method,location.origin)?pageLoads.begin():()=>{};
    try{
      const response=await original(input,init);
      if(tracksPageRequest(url,method,location.origin)){
        // Fetch resolves at headers; JSON/text can still be streaming afterwards.
        // Observe consumption without cloning or retaining private response bodies.
        for(const key of ['json','text','blob','arrayBuffer'] as const){
          const read=response[key].bind(response);
          Object.defineProperty(response,key,{configurable:true,value:async()=>{
            const consumed=pageLoads.begin();
            try{return await read();}finally{consumed();}
          }});
        }
      }
      return response;
    }finally{end();}
  };
}
