import {useStaffText as useStaffStaticText} from './staff-language';
import {CheckCircle2,Clock3,TriangleAlert} from 'lucide-react';
import './provider-stage-tests.css';

export type StageTest={stage:'translation'|'speech';language:'en'|'ar'|'ur';maxRequests:1|2;state:string;createdAt?:string;finishedAt?:string|null;diagnosticCode?:string|null;evidence?:{model:string;checks:string[];requestCount:number;durationSeconds?:number}|null};
const languages={en:'English',ar:'Arabic',ur:'Urdu'};
const diagnostics:Record<string,string>={invalid_output:'Output or request evidence did not pass.',transport_uncertain:'An external response was not confirmed.',authority_changed:'Operator access or dispatch permission changed.',test_interrupted:'The test deadline elapsed.'};
export function ProviderStageTests({tests}:{tests:StageTest[]}) {
  const staffT=useStaffStaticText();
  return <div className="provider-stage-tests">{tests.map(test=>{
    const Icon=test.state==='verified'?CheckCircle2:['failed','uncertain','interrupted'].includes(test.state)?TriangleAlert:Clock3;
    return <div className="provider-stage-test" key={`${test.stage}:${test.language}`}>
      <div><strong>{staffT.language(test.language)} {(test.stage==='translation'?staffT("translation"):staffT("speech"))}</strong><small>{test.maxRequests} {staffT("request")} {(test.maxRequests===1?staffT("slot"):staffT("slots"))}</small></div>
      <span className="provider-test-state"><Icon size={17}/>{(test.state==='verified'?staffT("Technical test passed"):staffT.state(test.state))}</span>
      <div className="provider-test-evidence">{test.evidence && <><span>{test.evidence.model}</span><span>{test.evidence.checks.map(check=>staffT.technical(check)).join(' · ')}</span>{test.evidence.durationSeconds!==undefined && <span>{test.evidence.durationSeconds.toFixed(2)} {staffT("seconds")}</span>}</>}{test.diagnosticCode && <span>{((Object.hasOwn(diagnostics,test.diagnosticCode)?staffT(diagnostics[test.diagnosticCode]):'')||(staffT("Test evidence is unavailable.")))}</span>}{test.createdAt && <time dateTime={test.createdAt}>{staffT.date(test.finishedAt || test.createdAt)}</time>}</div>
    </div>;
  })}</div>;
}
