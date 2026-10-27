import {transaction,NOW} from './db.mjs';
import {briefingAuthority,briefingAudit,assertBriefingActive} from './preparation.mjs';
import {getDraftLanguageSelection} from './settings.mjs';
import {draftLanguagesInput,sameDraftLanguages} from './draft-languages-input.mjs';
import {reviewRequestId} from './briefing-input.mjs';
import {randomUUID} from 'node:crypto';

export function saveDraftLanguages(db,session,id,input) {
  const content=draftLanguagesInput(input);
  return transaction(db,()=>{
    briefingAuthority(db,session);
    const row=db.prepare('SELECT revision FROM briefings WHERE id=? AND org_id=? AND site_id=?').get(id,session.org_id,session.site_id);
    if(!row)throw Error('Briefing unavailable');
    const old=db.prepare('SELECT * FROM briefing_language_requests WHERE request_id=? AND org_id=? AND site_id=?').get(input.requestId,session.org_id,session.site_id);
    if(old){if(old.briefing_id!==id || old.requested_by!==session.principal_id || !sameDraftLanguages(JSON.parse(old.request_json),content))throw Error('Draft languages request conflict');return {id,revision:old.accepted_revision,duplicate:true};}
    assertBriefingActive(db,session,id);
    if(row.revision!==content.revision)throw Error('Draft revision changed');
    if(JSON.stringify(getDraftLanguageSelection(db,session.org_id,session.site_id,id))===JSON.stringify(content.generationLanguages))throw Error('Draft languages unchanged');
    const revision=row.revision+1,now=NOW();
    db.prepare("UPDATE jobs SET status='failed',lease_until=NULL,error='Obsolete draft revision' WHERE briefing_id=? AND org_id=? AND site_id=? AND kind='prepare' AND status IN ('queued','processing')").run(id,session.org_id,session.site_id);
    db.prepare("UPDATE briefings SET revision=?,state='processing',prepared_json=NULL,updated_at=? WHERE id=? AND org_id=? AND site_id=?").run(revision,now,id,session.org_id,session.site_id);
    const review=db.prepare('SELECT content_json FROM draft_reviews WHERE briefing_id=? AND org_id=? AND site_id=?').get(id,session.org_id,session.site_id);
    if(review)db.prepare('UPDATE draft_reviews SET content_json=? WHERE briefing_id=? AND org_id=? AND site_id=?').run(JSON.stringify({...JSON.parse(review.content_json),revision}),id,session.org_id,session.site_id);
    db.prepare("INSERT INTO jobs VALUES(?,?,?,?,?,'prepare','queued',0,?,NULL,NULL,?)").run(randomUUID(),session.org_id,session.site_id,id,revision,now,now);
    try{db.prepare('INSERT INTO briefing_language_requests VALUES(?,?,?,?,?,?,?,?)').run(input.requestId,session.org_id,session.site_id,id,revision,JSON.stringify(content),session.principal_id,now);}
    catch(error){if(/CHECK constraint failed|Invalid generation languages/.test(String(error?.message||'')))throw Error('Invalid generation languages');throw error;}
    briefingAudit(db,session,'briefing.languages_updated',id);
    return {id,revision,duplicate:false};
  });
}
export function draftLanguagesReceipt(db,session,requestId) {
  reviewRequestId(requestId);
  return transaction(db,()=>{briefingAuthority(db,session);
    const row=db.prepare('SELECT briefing_id,accepted_revision,request_json FROM briefing_language_requests WHERE request_id=? AND org_id=? AND site_id=? AND requested_by=?').get(requestId,session.org_id,session.site_id,session.principal_id);
    return row ? {found:true,id:row.briefing_id,revision:row.accepted_revision,request:JSON.parse(row.request_json)} : {found:false};});
}
