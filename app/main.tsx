import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {installLocalApi} from '@/lib/local-api';
import Home from './page';
import './globals.css';

// The Lab is a static site: its former server routes now run in the browser.
installLocalApi();
createRoot(document.getElementById('root')!).render(<StrictMode><Home/></StrictMode>);
