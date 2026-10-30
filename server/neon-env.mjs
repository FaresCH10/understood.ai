// CLI-managed values stay server-side. Explicit Understood overrides take precedence.
export function neonEnvironment(env={}) {
  const result={...env};
  const aliases={UNDERSTOOD_NEON_AUTH_URL:'NEON_AUTH_BASE_URL',UNDERSTOOD_NEON_STORAGE_ENDPOINT:'AWS_ENDPOINT_URL_S3',
    UNDERSTOOD_NEON_STORAGE_REGION:'AWS_REGION',UNDERSTOOD_NEON_STORAGE_ACCESS_KEY_ID:'AWS_ACCESS_KEY_ID',
    UNDERSTOOD_NEON_STORAGE_SECRET_ACCESS_KEY:'AWS_SECRET_ACCESS_KEY'};
  for(const [target,source] of Object.entries(aliases))if(!result[target]&&result[source])result[target]=result[source];
  if(!result.UNDERSTOOD_NEON_STORAGE_BUCKET&&result.AWS_ENDPOINT_URL_S3)result.UNDERSTOOD_NEON_STORAGE_BUCKET='assets';
  return result;
}
