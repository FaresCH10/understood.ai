import {activityRow} from './reports.mjs';
import {ensurePeopleSchema} from './people.mjs';
import {WORKER_LANGUAGE_CODES} from './languages.mjs';
export {reportScope} from './report-input.mjs';

export function selectReport(responses,version,filters,timezone,audience=[],options={}) {
  const complete=responses.length>0 && audience.length===responses.length && responses.every(row=>audience.some(member=>member.assignment_id===row.assignment_id));
  if(filters.crewId && !complete)throw Error('Historical crew snapshot unavailable');
  const members=new Map(audience.map(row=>[row.assignment_id,row]));
  const crews=[...new Map(audience.filter(row=>row.crew_id!==null).map(row=>[row.crew_id,{id:row.crew_id,name:row.crew_name}])).values()].sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
  if(filters.crewId && filters.crewId!=='@unassigned' && !crews.some(row=>row.id===filters.crewId))throw Error('Report crew unavailable');
  const assigned=responses.filter(row=>!filters.crewId || (filters.crewId==='@unassigned' ? members.get(row.assignment_id)?.crew_id===null : members.get(row.assignment_id)?.crew_id===filters.crewId));
  const responseMode=options.responseMode || 'legacy',deliveryMode=options.deliveryMode || 'legacy',delivery=options.delivery ?? null;
  const resolvedIds=Array.isArray(options.resolvedAssignmentIds)?new Set(options.resolvedAssignmentIds):null;
  const all=assigned.map(row=>activityRow(row,version,{responseMode,deliveryMode,showResolved:!!resolvedIds,resolved:!!resolvedIds?.has(row.assignment_id)})),windowed=Boolean(filters.responseFrom || filters.responseThrough);
  const formatter=new Intl.DateTimeFormat('en',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'});
  const rows=windowed?all.filter(row=>{
    if(!row[4])return false;
    const parts=formatter.formatToParts(new Date(row[4])),day=['year','month','day'].map(type=>parts.find(part=>part.type===type).value.padStart(type==='year'?4:2,'0')).join('-');
    return (!filters.responseFrom || day>=filters.responseFrom) && (!filters.responseThrough || day<=filters.responseThrough);
  }):all;
  const received=rows.filter(row=>row[2]!=='awaiting_response');
  const acknowledged=received.filter(row=>row[2]==='acknowledged').length;
  const matches=received.filter(row=>row[3]==='matched').length,clarifications=received.filter(row=>['clarification','unassessable'].includes(row[3])).length;
  const resolved=resolvedIds?assigned.filter(row=>resolvedIds.has(row.assignment_id)).length:0;
  const metrics={assigned:assigned.length,responses:received.length,matches,clarifications,unassessed:received.length-matches-clarifications-acknowledged,pending:assigned.length-received.length,completion:assigned.length?Math.round(received.length/assigned.length*100):0};
  if(acknowledged)metrics.acknowledged=acknowledged;
  if(resolved)metrics.resolved=resolved;
  return {filters,crewSnapshotAvailable:complete,availableCrews:complete?crews:[],rows,responseMode,deliveryMode,delivery,metrics,
    languages:WORKER_LANGUAGE_CODES.map(language=>{const count=all.filter(row=>row[1]===language).length,n=received.filter(row=>row[1]===language).length;return {language,assigned:count,received:n,completion:count?Math.round(n/count*100):0};}).filter(row=>row.assigned)};
}

export function ensureReportAudienceSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS publication_report_audience (
    assignment_id TEXT PRIMARY KEY REFERENCES assignments(id),org_id TEXT NOT NULL,site_id TEXT NOT NULL,
    publication_id TEXT NOT NULL REFERENCES publications(id),crew_id TEXT,crew_name TEXT,
    CHECK((crew_id IS NULL)=(crew_name IS NULL))
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS report_audience_scope BEFORE INSERT ON publication_report_audience
    WHEN NOT EXISTS(SELECT 1 FROM assignments a WHERE a.id=NEW.assignment_id AND a.org_id=NEW.org_id AND a.site_id=NEW.site_id AND a.publication_id=NEW.publication_id)
    BEGIN SELECT RAISE(ABORT,'Report audience scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS report_audience_frozen_update BEFORE UPDATE ON publication_report_audience BEGIN SELECT RAISE(ABORT,'Report audience is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS report_audience_frozen_delete BEFORE DELETE ON publication_report_audience BEGIN SELECT RAISE(ABORT,'Report audience is immutable'); END;`);
}

export function captureReportAudience(db,publicationId) {
  ensurePeopleSchema(db);
  ensureReportAudienceSchema(db);
  db.prepare(`INSERT INTO publication_report_audience(assignment_id,org_id,site_id,publication_id,crew_id,crew_name)
    SELECT a.id,a.org_id,a.site_id,a.publication_id,c.id,c.name FROM assignments a
    LEFT JOIN crew_memberships m ON m.worker_id=a.worker_id AND m.org_id=a.org_id AND m.site_id=a.site_id
    LEFT JOIN crews c ON c.id=m.crew_id AND c.org_id=a.org_id AND c.site_id=a.site_id WHERE a.publication_id=?`).run(publicationId);
}
