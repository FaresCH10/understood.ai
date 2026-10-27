import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {WORKER_LANGUAGE_CODES} from '../server/languages.mjs';
import {checkedWorkerSubmissions} from '../src/worker-submissions.ts';
import {checkedWorkerHelpHistory} from '../src/worker-help-history.ts';
import {checkedWorkerReceiptSnapshot} from '../src/worker-submission-receipt.ts';
import {fetchOfflineBriefing} from '../src/worker-offline.ts';
import {artifactSpeechUrls,artifactVoiceLanguage,languageArtifacts} from '../src/language-artifacts.ts';
import {pendingRegenerationContent} from '../src/regeneration-recovery.ts';

const context='a'.repeat(64),requestId=randomUUID(),time=Date.parse('2026-10-26T00:00:00.000Z');
test('Punjabi device preview preserves the selected script and Filipino recognizes its browser voice alias',()=>{
  assert.equal(artifactVoiceLanguage('pa-IN','pa-Guru'),true);assert.equal(artifactVoiceLanguage('pa-PK','pa-Guru'),false);
  assert.equal(artifactVoiceLanguage('pa-PK','pa-Arab'),true);assert.equal(artifactVoiceLanguage('pa-IN','pa-Arab'),false);
  assert.equal(artifactVoiceLanguage('tl-PH','fil'),true);
});
test('every worker locale can read answer history, help history, exact receipts and artifact audio without losing its scope',()=>{
  for(const language of WORKER_LANGUAGE_CODES){
    const scope={assignmentId:'assignment',version:1,language},assignment={id:'assignment',version:1,language,state:'published'};
    const receipt={id:requestId,kind:'typed',receivedAt:'2026-10-26T00:00:00.000Z',isLatest:true,answerText:'a'.repeat(32),outcome:'matched',recordingId:null,audioStatus:null};
    assert.equal(checkedWorkerSubmissions({assignment,receipts:[receipt],total:1,page:1,pageSize:5,clientContext:context},scope,1,context).assignment.language,language);
    assert.equal(checkedWorkerHelpHistory({assignment,cases:[],total:0,page:1,pageSize:5,clientContext:context},scope,1,context).assignment.language,language);
    assert.equal(checkedWorkerReceiptSnapshot({assignment,receipt:{...receipt,durationSeconds:null},clientContext:context},{...scope,requestId,kind:'typed'},context).assignment.language,language);
    const body=`/api/briefings/brief/artifacts/draft/1/${language}/body`,question=body.replace(/body$/,'question');
    assert.deepEqual(artifactSpeechUrls({[language]:{body,question}},'brief','draft',1,language),{body,question});
    assert.equal(languageArtifacts(null,'Synthetic source',language).supported,true);
    assert.equal(pendingRegenerationContent({requestId,briefingId:'brief',body:{revision:1,language,kind:'audio',confirmed:true}}).language,language);
    assert.throws(()=>checkedWorkerSubmissions({assignment:{...assignment,language:'xx'},receipts:[receipt],total:1,page:1,pageSize:5,clientContext:context},scope,1,context));
  }
});

test('multiple-choice instructions in every locale can be captured offline without fetching an unrelated recording consent',async()=>{
  for(const language of WORKER_LANGUAGE_CODES){
    const session={authenticated:true,role:'worker',workerId:'worker',language,mode:'synthetic-credential',clientContext:context,expiresAt:'2026-10-27T00:00:00.000Z'};
    const scope={assignmentId:'assignment',publicationId:'publication',version:1,language};
    const choices=Array.from({length:4},(_,index)=>({id:String(index).repeat(32),text:'Synthetic option '+index}));
    const detail={id:'assignment',publicationId:'publication',version:1,language,state:'published',dueAt:null,
      content:{title:'Synthetic title',text:'Synthetic instruction text',question:'Synthetic question?',questionType:'multiple-choice',choices}};
    const paths=[];
    const item=await fetchOfflineBriefing(async path=>{paths.push(path);if(path==='/api/session')return Response.json(session);assert.equal(path,'/api/worker/briefings/assignment');return Response.json(detail);},session,scope,()=>true,()=>time);
    assert.equal(item.scope.language,language);assert.equal(item.canRecord,false);assert.equal(item.questionType,'multiple-choice');assert.deepEqual(item.choices,choices);
    assert.ok(!paths.some(path=>path.includes('recording-notice')));
  }
});
