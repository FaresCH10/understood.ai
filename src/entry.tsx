import {createRoot} from 'react-dom/client';
import App from './main';
import {registerPublicShell} from './pwa';
import './ui-refresh.css';
import './dashboard-navigation.css';
import './instruction-detail.css';
import './team-workflow.css';

createRoot(document.getElementById('root')!).render(<App/>);
void registerPublicShell();
