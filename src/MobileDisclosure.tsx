import {useEffect,useState,type ReactNode} from 'react';
/** Secondary information stays available without dominating a phone screen. */
export function MobileDisclosure({title,children,className=''}:{title:string;children:ReactNode;className?:string}){
 const [open,setOpen]=useState(()=>!window.matchMedia('(max-width:600px)').matches);
 useEffect(()=>{const media=window.matchMedia('(max-width:600px)');const sync=()=>setOpen(!media.matches);media.addEventListener('change',sync);return()=>media.removeEventListener('change',sync);},[]);
 return <details className={`mobile-disclosure ${className}`} open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary>{title}</summary><div>{children}</div></details>;
}
