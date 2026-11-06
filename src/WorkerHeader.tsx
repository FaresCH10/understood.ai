import type {ReactNode} from 'react';
import {MapPin} from 'lucide-react';
import {BrandLogo} from './BrandLogo';
import type {PageSession} from './session-state';

export function WorkerHeader({session, language, children}: {
  session: Pick<PageSession, 'organization' | 'site' | 'name'>;
  language: string;
  children: ReactNode;
}) {
  return (
    <header className="worker-header">
      <div className="worker-brand"><BrandLogo/></div>
      <div className="worker-header-context">
        <div className="worker-header-site">
          <MapPin size={15} aria-hidden="true"/>
          <span className="worker-site-label">
            <strong><bdi>{session.organization}</bdi></strong><span className="worker-header-site-separator"> · </span><bdi>{session.site}</bdi>
          </span>
        </div>
        <div className="worker-person">
          <strong><bdi>{session.name}</bdi></strong>
          <span className="worker-header-locale" dir="ltr">{language.toUpperCase()}</span>
        </div>
      </div>
      <div className="worker-header-actions">{children}</div>
    </header>
  );
}
