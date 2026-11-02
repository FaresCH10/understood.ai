const PREFIX = /^[A-Z0-9]{2,6}$/;

export function suggestWorkerPrefix(companyName) {
  const characters = String(companyName ?? '').normalize('NFKC').toUpperCase().match(/[A-Z0-9]/g) ?? [];
  return characters.length >= 2 ? characters.slice(0, 2).join('') : 'WK';
}

export function normalizeWorkerPrefix(value) {
  const prefix = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!PREFIX.test(prefix)) throw new Error('Invalid worker ID prefix');
  return prefix;
}

export function workerIdFormat(prefix) {
  return `${normalizeWorkerPrefix(prefix)}-001`;
}

export function nextWorkerId(prefix, codes) {
  const value = normalizeWorkerPrefix(prefix);
  const pattern = new RegExp(`^${value}-(\\d{1,9})$`);
  let maximum = 0;
  for (const code of codes ?? []) {
    const match = pattern.exec(String(code).trim().toUpperCase());
    if (match) maximum = Math.max(maximum, Number(match[1]));
  }
  return `${value}-${String(maximum + 1).padStart(3, '0')}`;
}
