import { DEFAULT_AUDIO_ROOT, receiveRecording, getRecording, getRecordingAudio } from './recordings.mjs';
import {clientSessionContext} from './session-context.mjs';
import {sendPrivateWav} from './audio-response.mjs';

async function readWav(req) {
  if (req.headers['content-type'] !== 'audio/wav') throw new Error('Expected WAV audio');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_880_044) throw new Error('Recording is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  res.end(JSON.stringify(body));
}

export async function handleRecordingRoute(req, res, db, session, path, audioRoot = DEFAULT_AUDIO_ROOT) {
  const upload = path.match(/^\/api\/worker\/briefings\/([^/]+)\/audio$/);
  if (upload && req.method === 'POST') {
    const {clientContext}=clientSessionContext(session);
    const bytes = await readWav(req);
    const header = req.headers['x-presentation-id'];
    if (Array.isArray(header)) throw new Error('Presentation unavailable');
    const presentationId = typeof header === 'string' && header ? header : null;
    const result = await receiveRecording(db, session, upload[1], req.headers['x-submission-id'], bytes, audioRoot, presentationId);
    json(res, result.duplicate ? 200 : 201, {...result,assignmentId:upload[1],requestId:req.headers['x-submission-id'],clientContext});
    return true;
  }
  const recording = path.match(/^\/api\/recordings\/([^/]+)(?:\/(audio))?$/);
  if (recording && req.method === 'GET') {
    const [, id, audio] = recording;
    if (audio) {
      const bytes = await getRecordingAudio(db, session, id, audioRoot);
      sendPrivateWav(req,res,bytes);
    } else {
      const row = getRecording(db, session, id);
      if (!row) throw new Error('Recording unavailable');
      json(res, 200, { id: row.id, status: row.status, receivedAt: row.created_at,
        aiStatus: row.status === 'transcribed' ? 'transcribed' : row.status === 'failed' || row.status === 'blocked' ? row.status : 'pending' });
    }
    return true;
  }
  return false;
}
