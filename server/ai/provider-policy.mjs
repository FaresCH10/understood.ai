export const APPROVED_GEMINI_ADAPTER='gemini-approved-v1';
export const APPROVED_GEMINI_DEEPL_ADAPTER='gemini-deepl-approved-v1';
export function providerDataClass(value){return value?.dataClass==='synthetic'||value?.dataClass==='real'&&[APPROVED_GEMINI_ADAPTER,APPROVED_GEMINI_DEEPL_ADAPTER].includes(value.adapter);}
export function integrationDataClass(mode){if(mode==='synthetic')return 'synthetic';if(mode==='live')return 'real';throw Error('Invalid integration mode');}
export function assertProviderMode(adapter,mode){const dataClass=integrationDataClass(mode);if(!providerDataClass(adapter?.provenance)||adapter.provenance.dataClass!==dataClass||typeof adapter.withJournal!=='function')throw Error('Provider integration does not match runtime');return dataClass;}
