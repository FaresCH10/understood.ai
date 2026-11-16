import {ArrowLeft} from 'lucide-react';
import {HelpCenter} from './HelpCenter';
import {ContactPage} from './PublicContact';
import {LandingDemo} from './LandingDemo';
import {isHelpView} from './public-navigation';
import './landing-page.css';
import './landing-sections.css';
import './dashboard-help.css';

export default function DashboardHelp({view,language}:{view:string;language:'en'|'ar'}){
  return <div className="marketing-site dashboard-help" lang={language} dir={language==='ar'?'rtl':'ltr'}>
    {isHelpView(view)?<HelpCenter key={view} view={view} locale={language} workspaceHref="#overview"/>:
      view==='contact'?<ContactPage locale={language} embedded/>:
      <section className="dashboard-walkthrough"><a className="landing-text-link" href="#overview"><ArrowLeft size={17} aria-hidden="true"/>{language==='ar'?'العودة إلى مساحة العمل':'Return to workspace'}</a><header className="page-header"><div><h1>{language==='ar'?'جولة تفاعلية':'Interactive walkthrough'}</h1><p>{language==='ar'?'جرّب إرسال التعليمات والرد عليها باستخدام مثال توضيحي.':'Explore instructions and responses with a sample workflow.'}</p></div></header><LandingDemo locale={language}/></section>}
  </div>;
}
