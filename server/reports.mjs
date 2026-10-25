import { ensureRecordingSchema, isCurrentRecording, responseColumns } from "./recordings.mjs";
import {NOW,transaction} from './db.mjs';
import {ensureReportAudienceSchema,reportScope,selectReport} from './report-scope.mjs';
import {reportPublicationFilters} from './report-input.mjs';
import {WORKER_LANGUAGE_CODES} from './languages.mjs';
export {reportPublicationFilters} from './report-input.mjs';

export function publicationDateBounds({from,through}) {
  const bounds={};
  for(const [key,date,days] of [['from',from,-2],['through',through,2]])if(date) {
    const value=new Date(Date.parse(`${date}T00:00:00.000Z`)+days*86400000).toISOString();
    if(/^\d{4}-/.test(value))bounds[key]=value;
  }
  return bounds;
}

export function reportPublicationPage(candidates,filters,timezone) {
  // ponytail: bound native civil-date filtering to 5,000 candidates; use indexed civil-day keys if history outgrows this limit.
  if(candidates.length>5000)throw Error('Report publication history exceeds limit; narrow the search or dates');
  const formatter=new Intl.DateTimeFormat('en',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'});
  const rows=candidates.filter(row=>{
    const parts=formatter.formatToParts(new Date(row.published_at));
    const date=['year','month','day'].map(type=>parts.find(part=>part.type===type).value.padStart(type==='year'?4:2,'0')).join('-');
    return (!filters.from || date>=filters.from) && (!filters.through || date<=filters.through);
  }).map(row=>({id:row.id,title:row.title,version:row.version,state:row.state,publishedAt:row.published_at instanceof Date?row.published_at.toISOString():row.published_at}));
  return {items:rows.slice((filters.page-1)*filters.pageSize,filters.page*filters.pageSize),total:rows.length,page:filters.page,pageSize:filters.pageSize,timezone,asOf:NOW()};
}

export function listReportPublications(db,session,input={}) {
  const filters=reportPublicationFilters(input);
  return transaction(db,()=>{
    if(session?.principal_type!=='staff' || !['owner','supervisor','auditor'].includes(session.role))throw Error('Forbidden');
    const site=db.prepare(`SELECT st.timezone FROM staff s JOIN sites st ON st.id=s.site_id AND st.org_id=s.org_id WHERE s.id=? AND s.org_id=? AND s.site_id=? AND s.role=? AND s.active=1`).get(session.principal_id,session.org_id,session.site_id,session.role);
    if(!site)throw Error('Forbidden');
    if(session.token_hash!==undefined && !db.prepare(`SELECT 1 FROM sessions WHERE token_hash=? AND principal_type='staff' AND principal_id=? AND org_id=? AND site_id=? AND revoked_at IS NULL AND expires_at>?`).get(session.token_hash,session.principal_id,session.org_id,session.site_id,NOW()))throw Error('Sign in required');
    const args=[session.org_id,session.site_id],where=['org_id=?','site_id=?'],bounds=publicationDateBounds(filters);
    if(filters.search){where.push("instr(lower(json_extract(snapshot_json,'$.title')),lower(?))>0");args.push(filters.search);}
    if(bounds.from){where.push('published_at>=?');args.push(bounds.from);}
    if(bounds.through){where.push('published_at<?');args.push(bounds.through);}
    const rows=db.prepare(`SELECT id,version,state,published_at,json_extract(snapshot_json,'$.title') AS title FROM publications WHERE ${where.join(' AND ')} ORDER BY published_at DESC,id DESC LIMIT 5001`).all(...args);
    return reportPublicationPage(rows,filters,site.timezone);
  });
}

export function csvCell(value) {
  const raw = String(value ?? "");
  const safe = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

const present=(db,name)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const json=(value,fallback)=>{if(value&&typeof value==='object')return value;try{return JSON.parse(value);}catch{return fallback;}};

export function publicationModes(snapshot) {
  const value=json(snapshot,{});
  return {
    responseMode:value?.responseMode==='acknowledge'?'acknowledge':value?.responseMode==='question'?'question':'legacy',
    deliveryMode:['text','voice','both'].includes(value?.deliveryMode)?value.deliveryMode:'legacy',
  };
}

export function reportDelivery(send,states=[]) {
  if(!send)return null;
  const counts={preparing:0,available:0,blocked:0,failed:0,withdrawn:0};
  for(const row of states)if(Object.hasOwn(counts,row.state))counts[row.state]+=Number(row.count ?? row.n ?? 1);
  return {requestId:send.request_id,state:send.state,captured:Number(send.audience_count),delivered:Number(send.delivered),
    undelivered:Number(send.undelivered),undeliveredReasons:json(send.undelivered_json,[]),states:counts};
}

export function reportActivity(db,session,publication,input={}) {
  const filters=reportScope(input);
  ensureReportAudienceSchema(db);
  ensureRecordingSchema(db);
  const rows = db
    .prepare(
      `SELECT w.code,a.language,a.id AS assignment_id,${responseColumns}
    FROM assignments a JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
    WHERE a.org_id=? AND a.site_id=? AND a.publication_id=? ORDER BY w.code,a.id LIMIT 5001`,
    )
    .all(session.org_id, session.site_id, publication.id);
  if (rows.length > 5000) throw new Error("Report exceeds export limit");
  const timezone=db.prepare('SELECT timezone FROM sites WHERE id=? AND org_id=?').get(session.site_id,session.org_id)?.timezone;
  if(!timezone)throw Error('Forbidden');
  const audience=db.prepare('SELECT * FROM publication_report_audience WHERE publication_id=? AND org_id=? AND site_id=?').all(publication.id,session.org_id,session.site_id);
  const send=present(db,'instruction_sends')
    ? db.prepare(`SELECT request_id,state,audience_count,delivered,undelivered,undelivered_json FROM instruction_sends
      WHERE publication_id=? AND org_id=? AND site_id=?`).get(publication.id,session.org_id,session.site_id)
    : null;
  const states=send && present(db,'instruction_deliveries')
    ? db.prepare('SELECT state,COUNT(*) AS count FROM instruction_deliveries WHERE request_id=? GROUP BY state').all(send.request_id)
    : [];
  const resolvedAssignmentIds=present(db,'clarifications')
    ? db.prepare(`SELECT DISTINCT c.assignment_id FROM clarifications c JOIN assignments a
      ON a.id=c.assignment_id AND a.org_id=c.org_id WHERE a.org_id=? AND a.site_id=? AND a.publication_id=? AND c.status='resolved'`)
      .all(session.org_id,session.site_id,publication.id).map((row)=>row.assignment_id)
    : [];
  return selectReport(rows,publication.version,filters,timezone,audience,
    {...publicationModes(publication.snapshot_json),delivery:reportDelivery(send,states),resolvedAssignmentIds});
}

export function activityRows(db,session,publication) {
  return reportActivity(db,session,publication).rows;
}

export function activityRow(row, version, modes={}) {
  const currentAudio = isCurrentRecording(row);
  const acknowledgedAt = currentAudio ? null : row.acknowledged_at;
  const receivedAt = currentAudio ? row.audio_at : row.attempt_at || acknowledgedAt;
  const status = currentAudio ? row.audio_status : row.outcome ? 'assessed' : acknowledgedAt ? 'acknowledged' : row.attempt_at ? 'assessment_pending' : 'awaiting_response';
  const cells=[row.code, row.language, status,
    currentAudio || (row.attempt_at && !row.outcome) ? 'unassessed' : row.outcome || '', receivedAt instanceof Date ? receivedAt.toISOString() : receivedAt || '', version,
    modes.responseMode || 'legacy', modes.deliveryMode || 'legacy'];
  if(modes.showResolved)cells.push(modes.resolved?'resolved':'');
  return cells;
}

const activityHeaders=["worker_id","language","response_status","assessment","received_at","briefing_version"];
export function activityColumns(rows) {
  const width=rows.length?rows[0].length:6;
  if(![6,8,9].includes(width) || rows.some((row)=>!Array.isArray(row) || row.length!==width))throw new Error('Invalid activity rows');
  if(width===9)return [...activityHeaders,"response_mode","delivery_mode","follow_up_status"];
  return width===8?[...activityHeaders,"response_mode","delivery_mode"]:activityHeaders;
}

export function activityCsv(rows) {
  const lines = [activityColumns(rows)];
  lines.push(...rows);
  return (
    "\uFEFF" +
    lines.map((line) => line.map(csvCell).join(",")).join("\r\n") +
    "\r\n"
  );
}

export function briefingActivityCsv(db, session, publication) {
  return activityCsv(activityRows(db, session, publication));
}

export function languageBreakdown(rows) {
  return WORKER_LANGUAGE_CODES.map((language) => {
    const group = rows.filter((row) => row[1] === language);
    const assigned = group.length;
    const received = group.filter((row) => row[2] !== 'awaiting_response').length;
    return { language, assigned, received, completion: assigned ? Math.round(received / assigned * 100) : 0 };
  }).filter((row) => row.assigned);
}
