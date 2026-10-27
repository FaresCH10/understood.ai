export type WorkerResponse = {
  outcome?: string | null;
  audioStatus?: string | null;
  assessmentStatus?: string | null;
  responseMode?: string | null;
  deliveryMode?: string | null;
  acknowledgedAt?: string | null;
  state: string;
  contentExpired?: boolean;
  dueAt?: string | null;
  repeatRequest?: {id:string;caseId:string;dueAt:string}|null;
};

export function workerResponseState(item: WorkerResponse, now = Date.now()) {
  const failedAudio = (item.audioStatus === 'failed' || item.audioStatus === 'blocked');
  const repeat=!!item.repeatRequest && Date.parse(item.repeatRequest.dueAt)>now;
  const acknowledged=!!item.acknowledgedAt;
  const pending = !repeat && !item.outcome && !failedAudio && (item.assessmentStatus === 'pending' || !!item.audioStatus);
  const closed = item.contentExpired === true || item.state !== 'published' || (!repeat && !!item.dueAt && Date.parse(item.dueAt) <= now);
  return {
    received: !repeat && (!!item.outcome || !!item.audioStatus || item.assessmentStatus === 'pending' || acknowledged),
    pending,
    closed,
    canRespond: !closed && !acknowledged && (item.responseMode === 'acknowledge' || repeat || !item.outcome && !pending),
    canHelp: item.state==='published' && item.contentExpired!==true,
  };
}
