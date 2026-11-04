import logo from './assets/brand/logo.png?inline';
import lightLogo from './assets/brand/logo-light.png?inline';
import './brand-logo.css';

// Inline assets keep the identity available in the cached offline app shell.
export function BrandLogo(){
  return <span className="brand-logo" role="img" aria-label="Understood"><img className="brand-logo-standard" src={logo} alt="" aria-hidden="true" width="1368" height="236"/><img className="brand-logo-light" src={lightLogo} alt="" aria-hidden="true" width="1368" height="236"/></span>;
}
