import { createVercelDemoHandler } from '../server/vercel-demo.mjs';
import {createVercelNeonHandler} from '../server/vercel-neon.mjs';

let runtime;
function getRuntime() {
  if(!runtime)runtime=(process.env.DATABASE_URL?createVercelNeonHandler():Promise.resolve(createVercelDemoHandler()))
    .catch(error=>{runtime=undefined;throw error;});
  return runtime;
}

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
  try {
    const {handler}=await getRuntime();
    return await handler(req,res);
  }catch {
    res.statusCode=503;
    res.setHeader('content-type','application/json');
    res.setHeader('cache-control','no-store');
    res.end(JSON.stringify({error:'Service configuration unavailable. Check Neon database, Auth URL and registration encryption key.'}));
  }
}

export const config = { maxDuration: 30 };
