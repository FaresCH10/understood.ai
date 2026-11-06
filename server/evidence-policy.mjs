// 3 MiB encodes to 4 MiB of base64, leaving room for the JSON envelope.
export const EVIDENCE_MAX_BYTES=3*1024*1024;
export const EVIDENCE_MAX_JSON_BYTES=Math.ceil(EVIDENCE_MAX_BYTES/3)*4+1024;
