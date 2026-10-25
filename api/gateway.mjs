import { createVercelDemoHandler } from '../server/vercel-demo.mjs';

const { handler } = createVercelDemoHandler();

export default async function gateway(req, res) {
  const url = new URL(req.url || '/api', 'http://internal.invalid');
  const captured = url.searchParams.get('understood_path') ?? '';
  url.searchParams.delete('understood_path');
  const queryStart = captured.indexOf('?');
  const capturedPath = (queryStart === -1 ? captured : captured.slice(0, queryStart)).replace(/^\/+/, '');
  if (url.searchParams.get('path') === capturedPath) url.searchParams.delete('path');
  const params = new URLSearchParams(queryStart === -1 ? '' : captured.slice(queryStart + 1));
  for (const [key, value] of url.searchParams) {
    if (!params.has(key)) params.append(key, value);
  }
  const query = params.toString();
  req.url = `/api${capturedPath ? `/${capturedPath}` : ''}${query ? `?${query}` : ''}`;
  return handler(req, res);
}

export const config = { maxDuration: 30 };
