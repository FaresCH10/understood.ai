import assert from 'node:assert/strict';
import {WORKER_LOCALES} from '../../server/languages.mjs';

// Worker UI copy is keyed by every selectable locale; Latin-script locales have no
// distinct range, so only non-Latin locales get a script assertion.
const nativeScript={
  ar:/[\u0600-\u06ff]/,ur:/[\u0600-\u06ff]/,'pa-Arab':/[\u0600-\u06ff]/,
  hi:/[\u0900-\u097f]/,ne:/[\u0900-\u097f]/,bn:/[\u0980-\u09ff]/,ml:/[\u0d00-\u0d7f]/,
  ta:/[\u0b80-\u0bff]/,te:/[\u0c00-\u0c7f]/,si:/[\u0d80-\u0dff]/,ru:/[\u0400-\u04ff]/,'pa-Guru':/[\u0a00-\u0a7f]/,
};
export const workerLocaleCodes=Object.freeze(WORKER_LOCALES.map(locale=>locale.code));
export const rtlWorkerLocaleCodes=Object.freeze(WORKER_LOCALES.filter(locale=>locale.direction==='rtl').map(locale=>locale.code));

function assertText(value,label,code){
  assert.equal(typeof value,'string',`${label} must be text`);
  assert.ok(value.trim(),`${label} must not be empty`);
  if(nativeScript[code])assert.match(value,nativeScript[code],`${label} must use the ${code} script`);
}
export function assertWorkerDictionary(dictionary,name){
  assert.ok(dictionary&&typeof dictionary==='object',`${name} must be a locale dictionary`);
  assert.deepEqual(Object.keys(dictionary).sort(),[...workerLocaleCodes].sort(),`${name} must cover every worker UI locale exactly`);
  const keys=Object.keys(dictionary.en).sort();
  assert.ok(keys.length,`${name}.en must declare copy`);
  for(const {code} of WORKER_LOCALES){
    assert.deepEqual(Object.keys(dictionary[code]).sort(),keys,`${name}.${code} must have the English key set`);
    for(const [key,value] of Object.entries(dictionary[code]))assertText(value,`${name}.${code}.${key}`,code);
  }
}
export function assertWorkerStrings(dictionary,name){
  assert.ok(dictionary&&typeof dictionary==='object',`${name} must be a locale dictionary`);
  assert.deepEqual(Object.keys(dictionary).sort(),[...workerLocaleCodes].sort(),`${name} must cover every worker UI locale exactly`);
  for(const {code} of WORKER_LOCALES)assertText(dictionary[code],`${name}.${code}`,code);
}
