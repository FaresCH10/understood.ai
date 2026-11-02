import {useStaffText as useStaffStaticText} from './staff-language';
import './provider-stages.css';

export type PipelineStatus={dataClass:string;realDataAllowed:boolean;productionReady:boolean;stages:{id:string;name:string;configuration:string;verification:string;models:string[];declaredLanguages:string[];evidence:string}[]};

export function ProviderStages({pipeline}:{pipeline:PipelineStatus}) {
  const staffT=useStaffStaticText();
  return <div className="provider-stages">{pipeline.stages.map(stage=><section className="provider-stage" key={stage.id} aria-labelledby={`provider-stage-${stage.id}`}><div><h3 id={`provider-stage-${stage.id}`}>{staffT(stage.name)}</h3><span className="provider-stage-config">{stage.configuration==='configured'?staffT("Configured"):staffT("Disabled")}</span></div><dl><div><dt>{staffT("Declared languages")}</dt><dd>{(stage.declaredLanguages.map(code=>code.toUpperCase()).join(', ')||staffT("Not declared"))}</dd></div><div><dt>{staffT("Models")}</dt><dd>{(stage.models.join(', ')||staffT("None enabled"))}</dd></div><div><dt>{staffT("Stage verification")}</dt><dd>{staffT.state(stage.verification)}</dd></div></dl><p className="muted">{staffT(stage.evidence)}</p></section>)}</div>;
}
