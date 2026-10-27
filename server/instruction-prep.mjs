import {withMultipleChoice} from './multiple-choice.mjs';
import {CANONICAL_SOURCE,syntheticPrepare} from './domain.mjs';

const STOPWORDS=new Set(`the a an and or but to of in on at for with without your you our we this that these those is are be been being was were
from by as it its into onto if then than so please make sure must should can will would could need needs all any each every before after when while
work worker workers team item items thing things instruction instructions following`.split(/\s+/));

const tableExists=(db,name)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);

export function instructionSendForBriefing(db,briefingId,orgId,siteId) {
  if(!tableExists(db,'instruction_sends')) return null;
  return db.prepare('SELECT * FROM instruction_sends WHERE briefing_id=? AND org_id=? AND site_id=?')
    .get(briefingId,orgId,siteId) || null;
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
  const question=action?`Where must you ${action[1].toLowerCase()} ${action[2]}${timing?', and when':''}?`
    :/\bkeep\b.*\bclear\b/i.test(text)?'What must you keep clear?'
    :facts.length>1?'Which actions does this instruction require?':'What action does this instruction require?';
  return withMultipleChoice({
    responseMode:send.response_mode,
    title:briefing.title,
    source:text,
    facts:instructionFacts(text),
    ...(questionMode ? {question,rubric:{mode:'keywords',askedFacts:groups.map((group)=>`Mention ${group[0]}`),keywordGroups:groups}} : {}),
    languages:{en:{title:briefing.title,text,...(questionMode ? {question} : {}),speech:'device-synthesis-demo'}},
    provenance:{adapter:'synthetic-instruction-v1',live:false},
  });
}
