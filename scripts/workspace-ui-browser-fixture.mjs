// Disposable UI verification against understood.ai's actual API and domain logic.
// No .env is read, no persistent database is opened, and no external services run.
import {spawn} from 'node:child_process';
import {openDatabase} from '../server/db.mjs';
import {sqliteApp} from '../tests/helpers/sqlite-app.mjs';

const db=openDatabase(':memory:');
const server=sqliteApp(db,{publicOrigin:'http://127.0.0.1:3036',registrationVerification:{available:true,key:Buffer.alloc(32,7),publicOrigin:'http://127.0.0.1:3036'}});
await new Promise(resolve=>server.listen(3037,'127.0.0.1',resolve));
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js'],{
  stdio:'inherit',
  env:{...process.env,UNDERSTOOD_WEB_PORT:'3036',UNDERSTOOD_API_PORT:'3037'},
});
function stop(){vite.kill();server.close(()=>db.close());}
process.once('SIGINT',stop);
process.once('SIGTERM',stop);
vite.once('error',error=>{console.error(error.message);stop();process.exitCode=1;});
console.log('Disposable workspace UI at http://127.0.0.1:3036/#sign-in');
