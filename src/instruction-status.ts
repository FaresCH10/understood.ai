export type InstructionRowState = {
  state: string;
  publication_state?: string | null;
  schedule_state?: string | null;
  scheduled_for?: string | null;
  metrics?: { assigned: number; responses: number } | null;
};

export function instructionSendState(item: InstructionRowState): string {
  if (item.publication_state) return item.publication_state;
  if (item.schedule_state === 'queued' && item.scheduled_for) return 'scheduled';
  if (item.state === 'processing') return 'processing';
  if (item.state === 'failed') return 'failed';
  return 'draft';
}

export function instructionResponseCounts(item: InstructionRowState): { responses: number; assigned: number } | null {
  const assigned = item.metrics?.assigned ?? 0;
  return assigned > 0 ? { responses: item.metrics!.responses, assigned } : null;
}
