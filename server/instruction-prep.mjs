import {withMultipleChoice} from './multiple-choice.mjs';
import {CANONICAL_SOURCE,syntheticPrepare} from './domain.mjs';

const STOPWORDS=new Set(`the a an and or but to of in on at for with without your you our we this that these those is are be been being was were
from by as it its into onto if then than so please make sure must should can will would could need needs all any each every before after when while
work worker workers team item items thing things instruction instructions following`.split(/\s+/));

const tableExists=(db,name)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);

export function instructionSendForBriefing(db,briefingId,orgId,siteId) {
  const send=tableExists(db,'instruction_sends')?db.prepare('SELECT * FROM instruction_sends WHERE briefing_id=? AND org_id=? AND site_id=?')
    .get(briefingId,orgId,siteId):null;
  if(send)return send;
  return tableExists(db,'instruction_improvement_drafts')&&db.prepare('SELECT 1 FROM instruction_improvement_drafts WHERE corrective_briefing_id=? AND org_id=? AND site_id=?')
    .get(briefingId,orgId,siteId)?{response_mode:'question',delivery_mode:'both'}:null;
}

export function instructionKeywordGroups(text) {
  const groups=[],seen=new Set();
  for(const match of text.toLowerCase().matchAll(/[a-z][a-z'-]{3,}/g)) {
    const word=match[0].replace(/^'+|'+$/g,'');
    if(word.length<4 || STOPWORDS.has(word) || seen.has(word)) continue;
    seen.add(word);
    const stem=word.replace(/(?:ing|edly|ed|es|s)$/,'');
    groups.push([...new Set([word,...(stem.length>=4 && stem!==word ? [stem] : [])])]);
    if(groups.length===6) break;
  }
  return groups;
}

function instructionFacts(text) {
  const sentences=text.split(/\n+|(?<=[.!?])\s+/).map((sentence)=>sentence.trim()).filter(Boolean)
    .slice(0,8).map((sentence)=>sentence.slice(0,500));
  return sentences.length ? sentences : [text.slice(0,500)];
}

// Only construct a fact-specific demo question when all four answers vary
// that exact fact. Otherwise use the clearly synthetic whole-instruction check.
function actionChoices(facts){
 for(const fact of facts){
  const action=/^(?:please\s+)?(move|put|place|store|take)\s+(.+?)\s+((?:to|on|at|in)\s+.+?)[.!?]?$/i.exec(fact);
  if(!action)continue;
  const answer=action[3].replace(/[.!?]$/,'').trim();
  for(const variants of [['blue','yellow','red','green'],['north','south','east','west'],['before','after','during','until']]){
   const match=new RegExp(`\\b(${variants.join('|')})\\b`,'i').exec(answer);
   if(!match)continue;
   return {fact,question:`Where must you ${action[1].toLowerCase()} ${action[2]}${/\b(before|after|until|during)\b/i.test(answer)?', and when':''}?`,
    choices:[answer,...variants.filter(value=>value!==match[0].toLowerCase()).map(value=>answer.slice(0,match.index)+value+answer.slice(match.index+match[0].length))]};
  }
 }
 return null;
}

export function syntheticInstructionPrepare(briefing,send) {
  const text=briefing.source.trim();
  if(/\p{Script=Arabic}/u.test(text))throw Error('Arabic source requires a configured translation provider.');
  const questionMode=send.response_mode==='question';
  if(text===CANONICAL_SOURCE) {
    const prepared=syntheticPrepare(text);
    return withMultipleChoice({...prepared,responseMode:send.response_mode,title:briefing.title,
      languages:{...prepared.languages,en:{...prepared.languages.en,title:briefing.title}}});
  }
  let groups=questionMode ? instructionKeywordGroups(text) : [];
  if(questionMode && !groups.length) {
    const fallback=text.toLowerCase().split(/\s+/).find(Boolean)?.slice(0,40);
    groups=[[fallback || 'instruction']];
  }
  const action=/^(?:please\s+)?(move|put|place|store|take)\s+(.+?)\s+(?:to|on|at|in|before|after)\b/i.exec(text);
  const timing=/\b(before|after|until|during)\b/i.test(text);
  const facts=instructionFacts(text);
  const concrete=questionMode?actionChoices(facts):null;
  const question=concrete?.question || (action?`Where must you ${action[1].toLowerCase()} ${action[2]}${timing?', and when':''}?`
    :/\bkeep\b.*\bclear\b/i.test(text)?'What must you keep clear?'
    :facts.length>1?'Which actions does this instruction require?':'What action does this instruction require?');
  return withMultipleChoice({
    responseMode:send.response_mode,
    title:briefing.title,
    source:text,
    facts:instructionFacts(text),
    ...(questionMode ? {question,rubric:{mode:'keywords',askedFacts:concrete?[concrete.fact]:groups.map((group)=>`Mention ${group[0]}`),keywordGroups:groups}} : {}),
    languages:{en:{title:briefing.title,text,...(questionMode ? {question,...(concrete?{answerChoices:concrete.choices}:{})} : {}),speech:'device-synthesis-demo'}},
    provenance:{adapter:'synthetic-instruction-v1',live:false},
  },{preserveQuestions:!!concrete});
}
