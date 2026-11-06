import {useId,type ReactNode,type RefObject} from 'react';
import {Clock3,CloudOff,ShieldAlert,WifiOff} from 'lucide-react';
import {BrandLogo} from './BrandLogo';
import {workerUiDirection,type WorkerUiLanguage} from './worker-ui-language';
import './session-recovery.css';

export function SessionRecoveryScreen({language,title,kind='connection',headingRef,children}:{language:WorkerUiLanguage;title:string;kind?:'connection'|'unavailable'|'locked'|'pending';headingRef?:RefObject<HTMLHeadingElement|null>;children:ReactNode}){
  const id=useId(),Icon=kind==='pending'?Clock3:kind==='locked'?ShieldAlert:kind==='unavailable'?CloudOff:WifiOff;
  return <main className="session-recovery-page" lang={language} dir={workerUiDirection(language)}>
    <div className="session-recovery-wrap"><div className="session-recovery-brand"><BrandLogo/></div>
      <section className={`session-recovery-card session-recovery-card--${kind}`} aria-labelledby={id} role={kind==='pending'?undefined:'alert'}>
        <div className="session-recovery-symbol" aria-hidden="true"><Icon size={29} strokeWidth={1.5}/></div>
        <h1 id={id} ref={headingRef} tabIndex={headingRef?-1:undefined}>{title}</h1>
        <div className="session-recovery-content">{children}</div>
      </section>
    </div>
  </main>;
}
