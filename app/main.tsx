import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {installLocalApi,preloadLocalApi} from '@/lib/local-api';
import {watchForStaleBuild} from '@/lib/stale-build';
import {preloadReadingPanels} from '@/components/reading-panels';
import {UpdateNotice} from '@/components/update-notice';
import Home from './page';
import './globals.css';

// The Lab is a static site: its former server routes now run in the browser.
installLocalApi();
watchForStaleBuild();
createRoot(document.getElementById('root')!).render(<StrictMode><Home/><UpdateNotice/></StrictMode>);
// Once the workspace has started, fetch the small on-demand parts that every
// visit may need. Heavy tools (PDF, Excel, charts) still load only when used.
const warm=()=>{preloadLocalApi();preloadReadingPanels();};
if('requestIdleCallback' in window)requestIdleCallback(warm,{timeout:5000});else setTimeout(warm,2000);
