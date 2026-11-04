export type ReportCounts={assigned:number;responses:number;matches:number;clarifications:number;unassessed:number;pending:number;completion:number;acknowledged?:number;resolved?:number};
export function responseFacts(counts:ReportCounts){
  const assessed=counts.matches+counts.clarifications;
  // Follow-up resolutions overlap outcomes and never enter this partition.
  const segments=[{key:'matched',count:counts.matches},{key:'clarification',count:counts.clarifications},{key:'assessment',count:counts.unassessed},{key:'acknowledged',count:counts.acknowledged??0},{key:'pending',count:counts.pending}];
  return {assessed,understanding:assessed?Math.round(counts.matches/assessed*100):null,
    segments:segments.map(segment=>({...segment,percent:counts.assigned?segment.count/counts.assigned*100:0}))};
}
