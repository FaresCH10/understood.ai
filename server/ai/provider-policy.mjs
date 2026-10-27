export const APPROVED_GEMINI_ADAPTER='gemini-approved-v1';
export function providerDataClass(value){return value?.dataClass==='synthetic'||value?.dataClass==='real'&&value.adapter===APPROVED_GEMINI_ADAPTER;}
export function integrationDataClass(mode){if(mode==='synthetic')return 'synthetic';if(mode==='live')return 'real';throw Error('Invalid integration mode');}
export function assertProviderMode(adapter,mode){const dataClass=integrationDataClass(mode);if(!providerDataClass(adapter?.provenance)||adapter.provenance.dataClass!==dataClass||typeof adapter.withJournal!=='function')throw Error('Provider integration does not match runtime');return dataClass;}
