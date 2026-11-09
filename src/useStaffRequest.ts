import {useEffect,useMemo,useRef} from 'react';
import {createStaffRequest,staffRequestBinding,type StaffRequestMethod,type StaffRequestFormat} from './staff-request';
import {validStaffSession,type PageSession} from './session-state';

export type StaffRequestAuthority={session:PageSession;isCurrent:()=>boolean;canMutate:()=>boolean;onSessionLost:()=>void};

export function useStaffRequest(authority:StaffRequestAuthority) {
  const binding=staffRequestBinding(authority.session),active=useRef(binding),latest=useRef(authority);
  active.current=binding;latest.current=authority;
  const lifetime=useRef({live:true,controller:new AbortController()});
  useEffect(()=>{
    const generation={live:true,controller:new AbortController()};lifetime.current=generation;
    return()=>{generation.live=false;generation.controller.abort();};
  },[binding]);
  return useMemo(()=>{
    const expected=Object.freeze({...authority.session});
    const current=()=>lifetime.current.live && active.current===binding && validStaffSession(expected) && latest.current.isCurrent();
    return {current,request:<T,>(path:string,body?:unknown,signal?:AbortSignal,method?:StaffRequestMethod,format?:StaffRequestFormat,waitForVerification?:()=>Promise<void>)=>{
      // Every call retains its own mount generation, including across Strict Mode cleanup.
      const generation=lifetime.current;
      return createStaffRequest(expected,()=>current() && generation.live && lifetime.current===generation,
        (url,options)=>fetch(url,{...options,signal:AbortSignal.any([options!.signal!,generation.controller.signal])}),Date.now,
        ()=>latest.current.canMutate(),()=>latest.current.onSessionLost())<T>(path,body,signal,method,format,waitForVerification);
    }};
  },[binding]);
}
