import {SignOutConfirmationProvider} from './SignOutConfirmation';
import {createRoot} from 'react-dom/client';
import App from './main';
import {registerPublicShell} from './pwa';
import {PageLoadingBoundary} from './PageLoadingBoundary';
import {installPageLoadTracking} from './page-load-state';
import './ui-refresh.css';
import './dashboard-navigation.css';
import './instruction-detail.css';
import './team-workflow.css';
import './worker-workspace.css';
import './dashboard-header.css';
import './supervisor-responsive.css';

installPageLoadTracking();
createRoot(document.getElementById('root')!).render(<SignOutConfirmationProvider><PageLoadingBoundary><App/></PageLoadingBoundary></SignOutConfirmationProvider>);
void registerPublicShell();
