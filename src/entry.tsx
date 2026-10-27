import {createRoot} from 'react-dom/client';
import App from './main';
import {registerPublicShell} from './pwa';
import './ui-refresh.css';

createRoot(document.getElementById('root')!).render(<App/>);
void registerPublicShell();
