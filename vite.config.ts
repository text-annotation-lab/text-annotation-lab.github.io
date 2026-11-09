import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';

export default defineConfig({
 plugins:[react()],
 // The publish date shown on the About page.
 define:{__BUILD_DATE__:JSON.stringify(new Date().toISOString().slice(0,10))},
 resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},
 build:{outDir:'dist/client',manifest:true,emptyOutDir:true},
});
