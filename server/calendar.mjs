import { NOW, transaction } from './db.mjs';
import { ensureWorkspaceSchema } from './workspace-schema.mjs';
import { ensureRecordingSchema, responseColumns } from './recordings.mjs';
import { metricsFromResponses } from './domain.mjs';

const CALENDAR_ROLES = ['owner', 'supervisor', 'auditor'];
const MAX_ROWS = 5000;
const EDIT_ACTIONS = ['briefing.created', 'briefing.edited', 'briefing.archived'];

function civilParts(formatter, value) {
  const result = {};
  for (const part of formatter.formatToParts(new Date(value))) if (part.type !== 'literal') result[part.type] = part.value;
  return result;
}

export function timeZoneCivilDate(value, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = civilParts(formatter, value);
  return `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`;
}

export function timeZoneDayStart(date, timeZone) {
  const [year, month, day] = date.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = civilParts(formatter, guess);
    const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const delta = target - shown;
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess).toISOString();
}

export function nextCalendarMonth(month) {
  const [year, value] = month.split('-').map(Number);
  return value === 12 ? `${year + 1}-01` : `${year}-${String(value + 1).padStart(2, '0')}`;
}

export function calendarMonthBounds(month, timeZone) {
  return {
    start: timeZoneDayStart(`${month}-01`, timeZone),
    end: timeZoneDayStart(`${nextCalendarMonth(month)}-01`, timeZone),
  };
}

export function calendarMonthInput(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('Invalid calendar month');
  const year = Number(value.slice(0, 4));
  if (year < 2000 || year > 2100) throw new Error('Invalid calendar month');
  return value;
}

function calendarSite(db, session) {
  if (session?.principal_type !== 'staff' || !CALENDAR_ROLES.includes(session.role)) throw new Error('Forbidden');
  const site = db.prepare(`SELECT st.timezone FROM staff s JOIN sites st ON st.id=s.site_id AND st.org_id=s.org_id
    WHERE s.id=? AND s.org_id=? AND s.site_id=? AND s.role=? AND s.active=1`)
    .get(session.principal_id, session.org_id, session.site_id, session.role);
  if (!site) throw new Error('Forbidden');
  if (session.token_hash !== undefined && !db.prepare(`SELECT 1 FROM sessions WHERE token_hash=? AND principal_type='staff'
    AND principal_id=? AND org_id=? AND site_id=? AND revoked_at IS NULL AND expires_at>?`)
    .get(session.token_hash, session.principal_id, session.org_id, session.site_id, NOW())) throw new Error('Sign in required');
  return site;
}

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

export function listCalendar(db, session, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid calendar request');
  const requested = calendarMonthInput(input.month);
  if (Object.keys(input).some((key) => key !== 'month')) throw new Error('Invalid calendar request');
  return transaction(db, () => {
    const site = calendarSite(db, session);
    const timeZone = site.timezone;
    const today = timeZoneCivilDate(NOW(), timeZone);
    const month = requested ?? today.slice(0, 7);
    const { start, end } = calendarMonthBounds(month, timeZone);
    ensureRecordingSchema(db);
    ensureWorkspaceSchema(db);
    const args = [session.org_id, session.site_id, start, end];

    const publications = capped(db.prepare(`SELECT p.id,p.briefing_id,p.version,p.published_at,p.state,
      json_extract(p.snapshot_json,'$.title') AS title FROM publications p
      WHERE p.org_id=? AND p.site_id=? AND p.published_at>=? AND p.published_at<?
      ORDER BY p.published_at,p.id`).all(...args), 'publication history');

    const schedules = capped(db.prepare(`SELECT s.id,s.briefing_id,s.publish_at,s.request_json,s.recipients_json,b.title
      FROM publication_schedules s JOIN briefings b ON b.id=s.briefing_id AND b.org_id=s.org_id AND b.site_id=s.site_id
      WHERE s.org_id=? AND s.site_id=? AND s.state='queued' AND s.publish_at>=? AND s.publish_at<?
      ORDER BY s.publish_at,s.id`).all(...args), 'scheduled instructions');

    const metricsByPublication = new Map();
    const openByPublication = new Map();
    if (publications.length) {
      const placeholders = publications.map(() => '?').join(',');
      const publicationIds = publications.map((row) => row.id);
      const responseRows = capped(db.prepare(`SELECT a.publication_id,${responseColumns} FROM assignments a
        WHERE a.org_id=? AND a.site_id=? AND a.publication_id IN (${placeholders})`)
        .all(session.org_id, session.site_id, ...publicationIds), 'assignments');
      for (const row of responseRows) {
        const group = metricsByPublication.get(row.publication_id) ?? [];
        group.push(row);
        metricsByPublication.set(row.publication_id, group);
      }
      const openRows = db.prepare(`SELECT a.publication_id AS publication_id,COUNT(*) AS n FROM clarifications c
        JOIN assignments a ON a.id=c.assignment_id AND a.org_id=c.org_id
        WHERE c.org_id=? AND a.site_id=? AND c.status='open' AND a.publication_id IN (${placeholders})
        GROUP BY a.publication_id`).all(session.org_id, session.site_id, ...publicationIds);
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

    const attempts = capped(db.prepare(`SELECT t.id,t.received_at AS at,t.outcome,p.id AS publication_id,p.briefing_id,p.version,
      b.title,w.code AS worker,w.name AS worker_name
      FROM attempts t JOIN assignments a ON a.id=t.assignment_id AND a.org_id=t.org_id
      JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      JOIN briefings b ON b.id=p.briefing_id AND b.org_id=p.org_id
      JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id
      WHERE t.org_id=? AND a.site_id=? AND t.received_at>=? AND t.received_at<?
      ORDER BY t.received_at,t.id`).all(...args), 'responses');
    for (const row of attempts) addEvent({ id: `response:${row.id}`, kind: 'response', at: row.at, outcome: row.outcome,
      publicationId: row.publication_id, briefingId: row.briefing_id, title: row.title, version: Number(row.version),
      worker: row.worker, workerName: row.worker_name });

    const recordings = capped(db.prepare(`SELECT r.id,r.received_at AS at,r.status,p.id AS publication_id,p.briefing_id,p.version,
      b.title,w.code AS worker,w.name AS worker_name
      FROM recordings r JOIN assignments a ON a.id=r.assignment_id AND a.org_id=r.org_id AND a.site_id=r.site_id
      JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      JOIN briefings b ON b.id=p.briefing_id AND b.org_id=p.org_id
      JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id
      WHERE r.org_id=? AND a.site_id=? AND r.received_at IS NOT NULL AND r.received_at>=? AND r.received_at<?
      ORDER BY r.received_at,r.id`).all(...args), 'audio responses');
    for (const row of recordings) addEvent({ id: `audio:${row.id}`, kind: 'audio', at: row.at, status: row.status,
      publicationId: row.publication_id, briefingId: row.briefing_id, title: row.title, version: Number(row.version),
      worker: row.worker, workerName: row.worker_name });

    const acknowledgments = capped(db.prepare(`SELECT ak.request_id AS id,ak.received_at AS at,p.id AS publication_id,p.briefing_id,p.version,
      b.title,w.code AS worker,w.name AS worker_name
      FROM acknowledgments ak JOIN assignments a ON a.id=ak.assignment_id AND a.org_id=ak.org_id AND a.site_id=ak.site_id
      JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      JOIN briefings b ON b.id=p.briefing_id AND b.org_id=p.org_id
      JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id
      WHERE ak.org_id=? AND ak.site_id=? AND ak.received_at>=? AND ak.received_at<?
      ORDER BY ak.received_at,ak.request_id`).all(...args), 'acknowledgments');
    for (const row of acknowledgments) addEvent({ id: `acknowledgment:${row.id}`, kind: 'acknowledgment', at: row.at,
      publicationId: row.publication_id, briefingId: row.briefing_id, title: row.title, version: Number(row.version),
      worker: row.worker, workerName: row.worker_name });

    const clarifications = capped(db.prepare(`SELECT c.id,c.created_at AS at,c.reason,c.status,p.id AS publication_id,p.briefing_id,p.version,
      b.title,w.code AS worker,w.name AS worker_name
      FROM clarifications c JOIN assignments a ON a.id=c.assignment_id AND a.org_id=c.org_id
      JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      JOIN briefings b ON b.id=p.briefing_id AND b.org_id=p.org_id
      JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id
      WHERE c.org_id=? AND a.site_id=? AND c.created_at>=? AND c.created_at<?
      ORDER BY c.created_at,c.id`).all(...args), 'clarifications');
    for (const row of clarifications) addEvent({ id: `clarification:${row.id}`, kind: 'clarification', at: row.at,
      reason: row.reason, status: row.status, publicationId: row.publication_id, briefingId: row.briefing_id,
      title: row.title, version: Number(row.version), worker: row.worker, workerName: row.worker_name });

    const resolved = capped(db.prepare(`SELECT au.id,au.occurred_at AS at,c.id AS clarification_id,p.id AS publication_id,p.briefing_id,p.version,
      b.title,w.code AS worker,w.name AS worker_name
      FROM audit au JOIN clarifications c ON c.id=au.object_id AND c.org_id=au.org_id
      JOIN assignments a ON a.id=c.assignment_id AND a.org_id=c.org_id
      JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      JOIN briefings b ON b.id=p.briefing_id AND b.org_id=p.org_id
      JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id
      WHERE au.org_id=? AND au.site_id=? AND au.action='clarification.resolved' AND au.occurred_at>=? AND au.occurred_at<?
      ORDER BY au.occurred_at,au.id`).all(...args), 'resolved clarifications');
    for (const row of resolved) addEvent({ id: `clarification-resolved:${row.id}`, kind: 'clarification_resolved', at: row.at,
      publicationId: row.publication_id, briefingId: row.briefing_id, title: row.title, version: Number(row.version),
      worker: row.worker, workerName: row.worker_name });

    const completions = capped(db.prepare(`SELECT ac.assignment_id AS id,ac.completed_at AS at,p.id AS publication_id,p.briefing_id,p.version,
      b.title,w.code AS worker,w.name AS worker_name
      FROM assignment_completions ac JOIN assignments a ON a.id=ac.assignment_id AND a.org_id=ac.org_id AND a.site_id=ac.site_id
      JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      JOIN briefings b ON b.id=p.briefing_id AND b.org_id=p.org_id
      JOIN workers w ON w.id=ac.worker_id AND w.org_id=ac.org_id
      WHERE ac.org_id=? AND ac.site_id=? AND ac.completed_at>=? AND ac.completed_at<?
      ORDER BY ac.completed_at,ac.assignment_id`).all(...args), 'completions');
    for (const row of completions) addEvent({ id: `completion:${row.id}`, kind: 'completion', at: row.at,
      publicationId: row.publication_id, briefingId: row.briefing_id, title: row.title, version: Number(row.version),
      worker: row.worker, workerName: row.worker_name });

    const edits = capped(db.prepare(`SELECT au.id,au.occurred_at AS at,au.action,b.id AS briefing_id,b.title
      FROM audit au JOIN briefings b ON b.id=au.object_id AND b.org_id=au.org_id AND b.site_id=au.site_id
      WHERE au.org_id=? AND au.site_id=? AND au.occurred_at>=? AND au.occurred_at<?
        AND au.action IN (${EDIT_ACTIONS.map(() => '?').join(',')})
      ORDER BY au.occurred_at,au.id`).all(...args, ...EDIT_ACTIONS), 'instruction edits');
    for (const row of edits) addEvent({ id: `edit:${row.id}`, kind: 'edit', at: row.at, action: row.action,
      briefingId: row.briefing_id, title: row.title });

    const withdrawals = capped(db.prepare(`SELECT au.id,au.occurred_at AS at,p.id AS publication_id,p.briefing_id,p.version,b.title
      FROM audit au JOIN publications p ON p.id=au.object_id AND p.org_id=au.org_id AND p.site_id=au.site_id
      JOIN briefings b ON b.id=p.briefing_id AND b.org_id=p.org_id
      WHERE au.org_id=? AND au.site_id=? AND au.occurred_at>=? AND au.occurred_at<?
        AND au.action='briefing.withdrawn'
      ORDER BY au.occurred_at,au.id`).all(...args), 'withdrawals');
    for (const row of withdrawals) addEvent({ id: `withdrawal:${row.id}`, kind: 'edit', at: row.at, action: 'briefing.withdrawn',
      publicationId: row.publication_id, briefingId: row.briefing_id, title: row.title, version: Number(row.version) });

    events.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    return { month, timezone: timeZone, today, asOf: NOW(), instructions, events };
  });
}
