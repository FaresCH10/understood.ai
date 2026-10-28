import {ArrowRight,AudioLines,Check,ChevronRight,Clock3,FileText,Globe2,MessageCircle,ShieldCheck,Users} from 'lucide-react';
import {landingCopy,type LandingLocale} from './landing-content';

const sampleWorkers=[
  {code:'014',language:'العربية',state:'clarification'},
  {code:'021',language:'English',state:'matched'},
  {code:'028',language:'اردو',state:'matched'},
  {code:'032',language:'English',state:'matched'},
  {code:'035',language:'العربية',state:'waiting'},
] as const;

export function SupervisorPreview({locale}:{locale:LandingLocale}){
  const t=landingCopy[locale],answered=sampleWorkers.filter(row=>row.state!=='waiting').length,followUp=sampleWorkers.filter(row=>row.state==='clarification').length;
  return <figure className="landing-supervisor-preview" aria-label={t.supervisorTitle}>
    <div className="landing-preview-top"><span><AudioLines size={20} aria-hidden="true"/>Understood</span><span>{t.supervisor}</span></div>
    <div className="landing-preview-content"><div className="landing-preview-heading"><div><span className="landing-mini-label">{t.published} · v1</span><h3>{t.briefing}</h3></div><FileText size={20} aria-hidden="true"/></div>
      <dl className="landing-preview-metrics"><div><dt>{t.assigned}</dt><dd>{sampleWorkers.length}</dd></div><div><dt>{t.answered}</dt><dd>{answered}</dd></div><div><dt>{t.followUp}</dt><dd>{followUp}</dd></div></dl>
      <div className="landing-preview-attention"><MessageCircle size={18} aria-hidden="true"/><span>{t.workerLabel} 014 · {t.clarification}</span><ChevronRight size={16} className="landing-forward" aria-hidden="true"/></div>
      <table><thead><tr><th>{t.workerLabel}</th><th>{t.languageLabel}</th><th>{t.responseLabel}</th></tr></thead><tbody>{sampleWorkers.map(row=><tr key={row.code}><td><span className="landing-worker-initial" aria-hidden="true">{row.code.slice(-2)}</span><bdi>{row.code}</bdi></td><td><bdi>{row.language}</bdi></td><td><span className={`landing-preview-status is-${row.state}`}>{row.state==='matched'?<Check size={12} aria-hidden="true"/>:row.state==='waiting'?<Clock3 size={12} aria-hidden="true"/>:<MessageCircle size={12} aria-hidden="true"/>}{row.state==='matched'?t.matched:row.state==='waiting'?t.waiting:t.clarification}</span></td></tr>)}</tbody></table>
    </div><figcaption>{t.sample}</figcaption>
  </figure>;
}

export function WorkerPreview({locale}:{locale:LandingLocale}){
  const t=landingCopy[locale];
  return <figure className="landing-worker-preview"><div className="landing-phone"><div className="landing-phone-top"><span>Understood<AudioLines size={18} aria-hidden="true"/></span><Globe2 size={16} aria-hidden="true"/></div><div className="landing-phone-content"><span className="landing-mini-label">{t.myInstructions}</span><h3>{t.briefing}</h3><span className="landing-phone-version">v1 · {locale==='ar'?'AR':'EN'}</span><div className="landing-phone-paper"><strong>{t.readInstruction}</strong><p>{locale==='ar'?t.heroArabic:t.heroOriginal}</p><div className="landing-phone-wave" aria-hidden="true"><AudioLines size={21}/><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/></div></div><p className="landing-phone-question">{t.phoneQuestion}</p><div className="landing-phone-answer"><Check size={16} aria-hidden="true"/>{t.phoneAnswer}</div><p className="landing-phone-help"><MessageCircle size={14} aria-hidden="true"/>{t.phoneHelp}</p></div></div><figcaption>{t.sample}</figcaption></figure>;
}

export function CompanyPreview({locale}:{locale:LandingLocale}){
  const t=landingCopy[locale];
  return <div className="landing-company-preview"><div className="landing-company-preview-title"><Users size={21} aria-hidden="true"/><strong>{t.controlTitle}</strong><ShieldCheck size={19} aria-hidden="true"/></div><dl><div><dt>{t.controlWorker}</dt><dd>{t.controlValue}</dd></div><div><dt>{t.controlLanguages}</dt><dd>{t.controlApproval}</dd></div><div><dt>{t.controlHistory}</dt><dd>{t.controlVersion}</dd></div></dl><span className="landing-illustration-caption">{t.sample}</span></div>;
}
