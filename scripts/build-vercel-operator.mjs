import {copyFile,mkdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {operatorFiles} from '../server/public-build.mjs';

const output='dist-operator';
for(const file of await operatorFiles('dist')) {
  const target=join(output,file==='operator.html'?'index.html':file);
  await mkdir(dirname(target),{recursive:true});
  await copyFile(join('dist',file),target);
}
console.log('Built the standalone operator interface.');
