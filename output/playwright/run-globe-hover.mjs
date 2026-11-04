import {readdirSync,existsSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const cache='C:/Users/Fares/AppData/Local/npm-cache/_npx';
const cli=readdirSync(cache).map(name=>`${cache}/${name}/node_modules/@playwright/cli/playwright-cli.js`).find(existsSync);
const result=spawnSync(process.execPath,[cli,'-s=globe-hover','run-code',readFileSync('output/playwright/globe-hover.js','utf8')],{stdio:'inherit'});
process.exitCode=result.status??1;

