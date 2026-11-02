export type CalendarMetrics = {
  assigned: number;
  responses: number;
  matches: number;
  clarifications: number;
  unassessed: number;
  pending: number;
  completion: number;
  acknowledged?: number;
};

export type CalendarInstruction = {
  id: string;
  kind: 'publication' | 'scheduled';
  date: string;
  at: string;
  briefingId: string;
  title: string;
  version: number;
  state: string;
  audience: number;
  metrics: CalendarMetrics;
  openClarifications: number;
};

export type CalendarEventKind = 'response' | 'audio' | 'acknowledgment' | 'clarification' | 'clarification_resolved' | 'completion' | 'edit';

export type CalendarEvent = {
  id: string;
  kind: CalendarEventKind;
  date: string;
  at: string;
  title: string;
  version?: number;
  briefingId?: string;
  publicationId?: string;
  worker?: string;
  workerName?: string | null;
  outcome?: string;
  status?: string;
  reason?: string;
  action?: string;
};

export type CalendarPayload = {
  month: string;
  timezone: string;
  today: string;
  asOf: string;
  instructions: CalendarInstruction[];
  events: CalendarEvent[];
};

const MAX_ITEMS = 5000;
const KINDS = new Set<CalendarEventKind>(['response', 'audio', 'acknowledgment', 'clarification', 'clarification_resolved', 'completion', 'edit']);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Calendar ${label} could not be verified.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max = 300): string {
  if (typeof value !== 'string' || !value || value.length > max) throw new Error(`Calendar ${label} could not be verified.`);
  return value;
}

function optionalText(value: unknown, label: string, max = 300): string | undefined {
  if (value === undefined || value === null) return undefined;
  return text(value, label, max);
}

function counter(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 1000000) throw new Error(`Calendar ${label} could not be verified.`);
  return number;
}

function dateOnly(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`Calendar ${label} could not be verified.`);
  }
  return value;
}

function stamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 60 || !Number.isFinite(Date.parse(value))) throw new Error(`Calendar ${label} could not be verified.`);
  return value;
}

function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) throw new Error(`Calendar ${label} could not be verified.`);
  return value;
}

function checkedMetrics(value: unknown): CalendarMetrics {
  const item = record(value, 'progress');
  const metrics: CalendarMetrics = {
    assigned: counter(item.assigned, 'progress'),
    responses: counter(item.responses, 'progress'),
    matches: counter(item.matches, 'progress'),
    clarifications: counter(item.clarifications, 'progress'),
    unassessed: counter(item.unassessed, 'progress'),
    pending: counter(item.pending, 'progress'),
    completion: counter(item.completion, 'progress'),
  };
  if (item.acknowledged !== undefined) metrics.acknowledged = counter(item.acknowledged, 'progress');
  return metrics;
}

export function checkedCalendar(value: unknown, month: string): CalendarPayload {
  const payload = record(value, 'response');
  if (payload.month !== month) throw new Error('Calendar month could not be verified.');
  const timezone = text(payload.timezone, 'time zone', 80);
  const today = dateOnly(payload.today, 'today');
  if (!Number.isFinite(Date.parse(timezone)) && !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(timezone)) throw new Error('Calendar time zone could not be verified.');
  const instructions = list(payload.instructions, 'instructions').map((entry): CalendarInstruction => {
    const item = record(entry, 'instruction');
    const kind = item.kind === 'scheduled' ? 'scheduled' : item.kind === 'publication' ? 'publication' : null;
    if (!kind) throw new Error('Calendar instruction could not be verified.');
    return {
      id: text(item.id, 'instruction', 100),
      kind,
      date: dateOnly(item.date, 'instruction date'),
      at: stamp(item.at, 'instruction time'),
      briefingId: text(item.briefingId, 'instruction', 100),
      title: text(item.title, 'instruction title'),
      version: counter(item.version, 'instruction version'),
      state: text(item.state, 'instruction state', 40),
      audience: counter(item.audience, 'instruction audience'),
      metrics: checkedMetrics(item.metrics),
      openClarifications: counter(item.openClarifications, 'instruction clarifications'),
    };
  });
  const events = list(payload.events, 'activity').map((entry): CalendarEvent => {
    const item = record(entry, 'activity');
    const kind = item.kind as CalendarEventKind;
    if (!KINDS.has(kind)) throw new Error('Calendar activity could not be verified.');
    const event: CalendarEvent = {
      id: text(item.id, 'activity', 140),
      kind,
      date: dateOnly(item.date, 'activity date'),
      at: stamp(item.at, 'activity time'),
      title: text(item.title, 'activity title'),
    };
    if (item.version !== undefined) event.version = counter(item.version, 'activity version');
    event.briefingId = optionalText(item.briefingId, 'activity', 100);
    event.publicationId = optionalText(item.publicationId, 'activity', 100);
    event.worker = optionalText(item.worker, 'activity', 80);
    event.workerName = item.workerName === null ? null : optionalText(item.workerName, 'activity', 120);
    event.outcome = optionalText(item.outcome, 'activity', 40);
    event.status = optionalText(item.status, 'activity', 40);
    event.reason = optionalText(item.reason, 'activity', 160);
    event.action = optionalText(item.action, 'activity', 80);
    return event;
  });
  return { month, timezone, today, asOf: stamp(payload.asOf, 'activity time'), instructions, events };
}

export function calendarMonthGrid(month: string): (string | null)[] {
  const [year, value] = month.split('-').map(Number);
  const lead = (new Date(Date.UTC(year, value - 1, 1)).getUTCDay() + 6) % 7;
  const total = new Date(Date.UTC(year, value, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= total; day += 1) cells.push(`${month}-${String(day).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function calendarAddDays(date: string, delta: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toISOString().slice(0, 10);
}

export function calendarMoveMonth(month: string, delta: number): string {
  const [year, value] = month.split('-').map(Number);
  const next = new Date(Date.UTC(year, value - 1 + delta, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function calendarTodayForZone(timeZone: string, now = new Date()): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  }
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : new Date().toISOString().slice(0, 10);
}

export function calendarMonthForZone(timeZone: string, now = new Date()): string {
  return calendarTodayForZone(timeZone, now).slice(0, 7);
}
