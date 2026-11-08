import {assessAnswer} from '../domain.mjs';
export const syntheticAssessmentAdapter={
  async assess(answer,question,facts) {
    if (facts?.join('|')!=='finished -> blue shelf|unfinished -> yellow shelf' || typeof question!=='string')
      return {outcome:'unassessable',reasons:['unsupported_synthetic_rubric'],evidence:[]};
    const result=assessAnswer(answer);
    if (result.outcome==='matched' && answer.length>300)
      return {outcome:'unassessable',reasons:['synthetic_evidence_limit'],evidence:[]};
    return {...result,evidence:result.outcome==='matched' ? facts.map((_,factIndex) => ({factIndex,quote:answer})) : []};
  },
};
