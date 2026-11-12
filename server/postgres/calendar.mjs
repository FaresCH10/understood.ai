import { domainTransaction, requirePrincipal } from './domain.mjs';
import { postgresResponseColumns as responseColumns } from '../recordings.mjs';
import { metricsFromResponses } from '../domain.mjs';
import { calendarMonthBounds, calendarMonthInput, timeZoneCivilDate } from '../calendar.mjs';

const CALENDAR_ROLES = ['owner', 'supervisor', 'auditor'];
const MAX_ROWS = 5000;
const EDIT_ACTIONS = ['briefing.created', 'briefing.edited', 'briefing.archived'];

function iso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function json(value, fallback) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function capped(rows, label) {
  if (rows.length > MAX_ROWS) throw new Error(`Calendar ${label} exceeds the monthly limit; narrow the month`);
  return rows;
}

function eventBase(row, timeZone) {
  const at = iso(row.at);
  return { at, date: timeZoneCivilDate(at, timeZone) };
}

export async function listCalendar(pool, session, input = {}, { schema = 'public' } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid calendar request');
  const requested = calendarMonthInput(input.month);
  if (Object.keys(input).some((key) => key !== 'month')) throw new Error('Invalid calendar request');
  return domainTransaction(pool, schema, async (client) => {
    await requirePrincipal(client, session, 'staff', CALENDAR_ROLES);
    const site = (await client.query('SELECT timezone FROM sites WHERE id=$1 AND org_id=$2',
      [session.site_id, session.org_id])).rows[0];
    if (!site) throw new Error('Forbidden');
    const timeZone = site.timezone;
    const today = timeZoneCivilDate(new Date(), timeZone);
    const month = requested ?? today.slice(0, 7);
    const { start, end } = calendarMonthBounds(month, timeZone);
    const scope = [session.org_id, session.site_id, start, end];

    const publications = capped((await client.query(`SELECT p.id,p.briefing_id,p.version,p.published_at,p.state,
      p.snapshot_json->>'title' AS title FROM publications p
      WHERE p.org_id=$1 AND p.site_id=$2 AND p.published_at>=$3 AND p.published_at<$4
      ORDER BY p.published_at,p.id LIMIT 5001`, scope)).rows, 'publication history');

    const schedules = capped((await client.query(`SELECT s.id,s.briefing_id,s.publish_at,s.request_json,s.recipients_json,b.title
      FROM publication_schedules s JOIN briefings b ON b.id=s.briefing_id AND b.org_id=s.org_id AND b.site_id=s.site_id
      WHERE s.org_id=$1 AND s.site_id=$2 AND s.state='queued' AND s.publish_at>=$3 AND s.publish_at<$4
      ORDER BY s.publish_at,s.id LIMIT 5001`, scope)).rows, 'scheduled instructions');

    const metricsByPublication = new Map();
    const openByPublication = new Map();
    if (publications.length) {
      const publicationIds = publications.map((row) => row.id);
      const responseRows = capped((await client.query(`SELECT a.publication_id,${responseColumns} FROM assignments a
        WHERE a.org_id=$1 AND a.site_id=$2 AND a.publication_id=ANY($3::text[])`,
      [session.org_id, session.site_id, publicationIds])).rows, 'assignments');
      for (const row of responseRows) {
        const group = metricsByPublication.get(row.publication_id) ?? [];
        group.push(row);
        metricsByPublication.set(row.publication_id, group);
      }
      const openRows = (await client.query(`SELECT a.publication_id AS publication_id,COUNT(*)::int AS n FROM clarifications c
        JOIN assignments a ON a.id=c.assignment_id AND a.org_id=c.org_id
        WHERE c.org_id=$1 AND a.site_id=$2 AND c.status='open' AND a.publication_id=ANY($3::text[])
        GROUP BY a.publication_id`,
      [session.org_id, session.site_id, publicationIds])).rows;
      for (const row of openRows) openByPublication.set(row.publication_id, Number(row.n));
    }

    const instructions = publications.map((row) => {
      const responses = metricsByPublication.get(row.id) ?? [];
      const metrics = responses.length ? metricsFromResponses(responses) : { assigned: 0, responses: 0, matches: 0, clarifications: 0, unassessed: 0, pending: 0, completion: 0 };
      return {
        id: row.id, kind: 'publication', date: timeZoneCivilDate(iso(row.published_at), timeZone), at: iso(row.published_at),
        briefingId: row.briefing_id, title: row.title || 'Instruction', version: Number(row.version), state: row.state,
        audience: metrics.assigned, metrics, openClarifications: openByPublication.get(row.id) ?? 0,
      };
    }).concat(schedules.map((row) => {
      const request = json(row.request_json, {});
      const recipients = json(row.recipients_json, []);
      const audience = Array.isArray(recipients) ? recipients.length : Number(request.workerIds?.length ?? 0);
      return {
        id: `schedule:${row.id}`, kind: 'scheduled', date: timeZoneCivilDate(iso(row.publish_at), timeZone), at: iso(row.publish_at),
        briefingId: row.briefing_id, title: row.title || 'Instruction', version: Number(request.nextVersion ?? 1), state: 'scheduled',
        audience, metrics: { assigned: audience, responses: 0, matches: 0, clarifications: 0, unassessed: 0, pending: audience, completion: 0 },
        openClarifications: 0,
      };
    })).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));

    const events = [];
    const addEvent = (row) => events.push({ ...row, ...eventBase(row, timeZone) });

    const attempts = capped((await client.query(`SELECT t.id,t.received_at AS at,t.outcome,p.id AS publication_id,p.briefing_id,p.version,
      b.title,w.code AS worker,w.name AS worker_name
      FROM attempts t JOIN assignments a ON a.id=t.assignment_id AND a.org_id=t.org_id
      JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      JOIN briefings b ON b.id=p.briefing_id AND b.org_id=p.org_id
      JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id
      WHERE t.org_id=$1 AND a.site_id=$2 AND t.received_at>=$3 AND t.received_at<$4
      ORDER BY t.received_at,t.id LIMIT 5001`, scope)).rows, 'responses');
    for (const row of attempts) addEvent({ id: `response:${row.id}`, kind: 'response', at: row.at, outcome: row.outcome,
      publicationId: row.publication_id, briefingId: row.briefing_id, title: row.title, version: Number(row.version),
      worker: row.worker, workerName: row.worker_name });

    const recordings = capped((await client.query(`SELECT r.id,r.received_at AS at,r.status,p.id AS publication_id,p.briefing_id,p.version,
      b.title,w.code AS worker,w.name AS worker_name
      FROM recordings r JOIN assignments a ON a.id=r.assignment_id AND a.org_id=r.org_id AND a.site_id=r.site_id
      JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      JOIN briefings b ON b.id=p.briefing_id AND b.org_id=p.org_id
      JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id
      WHERE r.org_id=$1 AND a.site_id=$2 AND r.received_at IS NOT NULL AND r.received_at>=$3 AND r.received_at<$4
      ORDER BY r.received_at,r.id LIMIT 5001`, scope)).rows, 'audio responses');
    for (const row of recordings) addEvent({ id: `audio:${row.id}`, kind: 'audio', at: row.at, status: row.status,
      publicationId: row.publication_id, briefingId: row.briefing_id, title: row.title, version: Number(row.version),
      worker: row.worker, workerName: row.worker_name });

    const acknowledgments = capped((await client.query(`SELECT ak.request_id AS id,ak.received_at AS at,p.id AS publication_id,p.briefing_id,p.version,
      b.title,w.code AS worker,w.name AS worker_name
      FROM acknowledgments ak JOIN assignments a ON a.id=ak.assignment_id AND a.org_id=ak.org_id AND a.site_id=ak.site_id
      JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      JOIN briefings b ON b.id=p.briefing_id AND b.org_id=p.org_id
      JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id
      WHERE ak.org_id=$1 AND ak.site_id=$2 AND ak.received_at>=$3 AND ak.received_at<$4
      ORDER BY ak.received_at,ak.request_id LIMIT 5001`, scope)).rows, 'acknowledgments');
    for (const row of acknowledgments) addEvent({ id: `acknowledgment:${row.id}`, kind: 'acknowledgment', at: row.at,
      publicationId: row.publication_id, briefingId: row.briefing_id, title: row.title, version: Number(row.version),
      worker: row.worker, workerName: row.worker_name });

    const clarifications = capped((await client.query(`SELECT c.id,c.created_at AS at,c.reason,c.status,p.id AS publication_id,p.briefing_id,p.version,
      b.title,w.code AS worker,w.name AS worker_name
      FROM clarifications c JOIN assignments a ON a.id=c.assignment_id AND a.org_id=c.org_id
      JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      JOIN briefings b ON b.id=p.briefing_id AND b.org_id=p.org_id
      JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id
      WHERE c.org_id=$1 AND a.site_id=$2 AND c.created_at>=$3 AND c.created_at<$4
      ORDER BY c.created_at,c.id LIMIT 5001`, scope)).rows, 'clarifications');
    for (const row of clarifications) addEvent({ id: `clarification:${row.id}`, kind: 'clarification', at: row.at,
      reason: row.reason, status: row.status, publicationId: row.publication_id, briefingId: row.briefing_id,
      title: row.title, version: Number(row.version), worker: row.worker, workerName: row.worker_name });

    const resolved = capped((await client.query(`SELECT au.id,au.occurred_at AS at,c.id AS clarification_id,p.id AS publication_id,p.briefing_id,p.version,
      b.title,w.code AS worker,w.name AS worker_name
      FROM audit au JOIN clarifications c ON c.id=au.object_id AND c.org_id=au.org_id
      JOIN assignments a ON a.id=c.assignment_id AND a.org_id=c.org_id
      JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      JOIN briefings b ON b.id=p.briefing_id AND b.org_id=p.org_id
      JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id
      WHERE au.org_id=$1 AND au.site_id=$2 AND au.action='clarification.resolved' AND au.occurred_at>=$3 AND au.occurred_at<$4
      ORDER BY au.occurred_at,au.id LIMIT 5001`, scope)).rows, 'resolved clarifications');
    for (const row of resolved) addEvent({ id: `clarification-resolved:${row.id}`, kind: 'clarification_resolved', at: row.at,
      publicationId: row.publication_id, briefingId: row.briefing_id, title: row.title, version: Number(row.version),
      worker: row.worker, workerName: row.worker_name });

    const completions = capped((await client.query(`SELECT ac.assignment_id AS id,ac.completed_at AS at,p.id AS publication_id,p.briefing_id,p.version,
      b.title,w.code AS worker,w.name AS worker_name
      FROM assignment_completions ac JOIN assignments a ON a.id=ac.assignment_id AND a.org_id=ac.org_id AND a.site_id=ac.site_id
      JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      JOIN briefings b ON b.id=p.briefing_id AND b.org_id=p.org_id
      JOIN workers w ON w.id=ac.worker_id AND w.org_id=ac.org_id
      WHERE ac.org_id=$1 AND ac.site_id=$2 AND ac.completed_at>=$3 AND ac.completed_at<$4
      ORDER BY ac.completed_at,ac.assignment_id LIMIT 5001`, scope)).rows, 'completions');
    for (const row of completions) addEvent({ id: `completion:${row.id}`, kind: 'completion', at: row.at,
      publicationId: row.publication_id, briefingId: row.briefing_id, title: row.title, version: Number(row.version),
      worker: row.worker, workerName: row.worker_name });

    const edits = capped((await client.query(`SELECT au.id,au.occurred_at AS at,au.action,b.id AS briefing_id,b.title
      FROM audit au JOIN briefings b ON b.id=au.object_id AND b.org_id=au.org_id AND b.site_id=au.site_id
      WHERE au.org_id=$1 AND au.site_id=$2 AND au.occurred_at>=$3 AND au.occurred_at<$4
        AND au.action=ANY($5::text[])
      ORDER BY au.occurred_at,au.id LIMIT 5001`, [...scope, EDIT_ACTIONS])).rows, 'instruction edits');
    for (const row of edits) addEvent({ id: `edit:${row.id}`, kind: 'edit', at: row.at, action: row.action,
      briefingId: row.briefing_id, title: row.title });

    const withdrawals = capped((await client.query(`SELECT au.id,au.occurred_at AS at,p.id AS publication_id,p.briefing_id,p.version,b.title
      FROM audit au JOIN publications p ON p.id=au.object_id AND p.org_id=au.org_id AND p.site_id=au.site_id
      JOIN briefings b ON b.id=p.briefing_id AND b.org_id=p.org_id
      WHERE au.org_id=$1 AND au.site_id=$2 AND au.occurred_at>=$3 AND au.occurred_at<$4
        AND au.action='briefing.withdrawn'
      ORDER BY au.occurred_at,au.id LIMIT 5001`, scope)).rows, 'withdrawals');
    for (const row of withdrawals) addEvent({ id: `withdrawal:${row.id}`, kind: 'edit', at: row.at, action: 'briefing.withdrawn',
      publicationId: row.publication_id, briefingId: row.briefing_id, title: row.title, version: Number(row.version) });

    events.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    return { month, timezone: timeZone, today, asOf: iso(new Date()), instructions, events };
  });
}
