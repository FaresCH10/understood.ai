import type {ReactNode} from 'react';
import {ChevronDown,Info,SlidersHorizontal} from 'lucide-react';

export function WorkerDeviceDisclosure({label,description,children}: {label:string;description?:string;children:ReactNode}) {
  const Icon=description?SlidersHorizontal:Info;
  return <details className={description?'device-disclosure device-advanced':'device-disclosure'}>
    <summary>
      <Icon size={description?20:16} aria-hidden="true"/>
      <span><strong>{label}</strong>{description&&<small>{description}</small>}</span>
      <ChevronDown className="device-disclosure-chevron" size={18} aria-hidden="true"/>
    </summary>
    <div className="device-disclosure-content">{children}</div>
  </details>;
}
