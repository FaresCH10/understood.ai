const COMPANY_LOCATOR = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;
const WORKER_LOGIN = /^[\p{L}\p{N}][\p{L}\p{N} ._'-]{1,79}$/u;
const SETUP_CODE = /^[A-Za-z0-9_-]{43}$/;

function exactKeys(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some((key) => !allowed.includes(key))) throw new Error('Invalid input');
}

export function companyLocator(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!COMPANY_LOCATOR.test(text)) throw new Error('Company not found');
  return text;
}

export function normalizeWorkerLogin(value) {
  const text = typeof value === 'string' ? value.trim().normalize('NFKC') : '';
  if (!WORKER_LOGIN.test(text)) throw new Error('Invalid worker ID');
  return text.toUpperCase();
}

export function workerPassword(value, { login = '', company = '' } = {}) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128 || value.trim() !== value) {
    throw new Error('Invalid password');
  }
  const lower = value.toLowerCase();
  if (lower === login.toLowerCase() || lower === company.toLowerCase()) throw new Error('Invalid password');
  return value;
}

export function workerLoginInput(input) {
  exactKeys(input, ['company', 'workerId', 'password']);
  const company = companyLocator(input.company);
  const login = normalizeWorkerLogin(input.workerId);
  return { company, login, password: workerPassword(input.password, { login, company }) };
}

export function workerSetupClaimInput(input) {
  exactKeys(input, ['company', 'workerId', 'code', 'password']);
  if (typeof input.code !== 'string' || !SETUP_CODE.test(input.code)) throw new Error('Invalid setup credential');
  const company = companyLocator(input.company);
  const login = normalizeWorkerLogin(input.workerId);
  return { company, login, code: input.code, password: workerPassword(input.password, { login, company }) };
}

export function credentialSetupInput(input) {
  exactKeys(input, ['expectedCode', 'confirmed', 'expiresInMinutes']);
  if (input.confirmed !== true) throw new Error('Confirmation required');
  const expectedCode = normalizeWorkerLogin(input.expectedCode);
  const minutes = input.expiresInMinutes === undefined ? 60 : input.expiresInMinutes;
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) throw new Error('Invalid setup expiry');
  return { expectedCode, expiresInMinutes: minutes };
}

export function setupCode(value) {
  if (typeof value !== 'string' || !SETUP_CODE.test(value)) throw new Error('Invalid setup credential');
  return value;
}
