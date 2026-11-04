import {SignOutConfirmationProvider} from './SignOutConfirmation';
import {createRoot} from 'react-dom/client';
import Operations from './Operations';
import {PageLoadingBoundary} from './PageLoadingBoundary';
import {installPageLoadTracking} from './page-load-state';
import './styles.css';
import './ui-refresh.css';

installPageLoadTracking();
createRoot(document.getElementById('root')!).render(<SignOutConfirmationProvider><PageLoadingBoundary><Operations dedicated/></PageLoadingBoundary></SignOutConfirmationProvider>);
