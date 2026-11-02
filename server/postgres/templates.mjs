import {randomUUID} from 'node:crypto';
import {bindPreparationAuthority} from './preparation-authority.mjs';
import {domainTransaction,domainAudit,requirePrincipal} from './domain.mjs';
import {templateInput,templateSignature,templateContent,templateFilters,templateFavoriteInput,templateHistoryInput,templateRequestId} from '../template-input.mjs';
export async function listTemplates(pool,session,input={}, {schema='public'}={}) {
  const {search,status,favorites,page,pageSize}=templateFilters(input);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',['owner','supervisor','auditor']);
    const row=(await client.query(`WITH filtered AS (SELECT t.id,t.revision,t.status,t.updated_at,v.content_json->>'title' AS title,v.content_json->>'description' AS description,
      EXISTS(SELECT 1 FROM template_favorites f WHERE f.template_id=t.id AND f.staff_id=$7 AND f.org_id=t.org_id AND f.site_id=t.site_id) AS favorite
      FROM templates t JOIN template_versions v ON v.template_id=t.id AND v.revision=t.revision AND v.org_id=t.org_id AND v.site_id=t.site_id
      WHERE t.org_id=$1 AND t.site_id=$2 AND ($3='all' OR t.status=$3) AND ($4='' OR strpos(lower(v.content_json->>'title'),lower($4))>0)
      AND ($8='all' OR EXISTS(SELECT 1 FROM template_favorites f WHERE f.template_id=t.id AND f.staff_id=$7 AND f.org_id=t.org_id AND f.site_id=t.site_id)))
      SELECT (SELECT COUNT(*)::int FROM filtered) AS total,COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.updated_at DESC,r.id) FROM
      (SELECT * FROM filtered ORDER BY updated_at DESC,id LIMIT $5 OFFSET $6) r),'[]'::jsonb) AS items`,[session.org_id,session.site_id,status,search,pageSize,(page-1)*pageSize,session.principal_id,favorites])).rows[0];
    return {...row,page,pageSize};
  });
}
export async function getTemplate(pool,session,id,input={}, {schema='public'}={}) {
  const {page,version}=templateHistoryInput(input);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',['owner','supervisor','auditor']);
    const current=(await client.query('SELECT id,revision,status FROM templates WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR SHARE',[id,session.org_id,session.site_id])).rows[0];
    if(!current) throw new Error('Template unavailable');
    const selected=(await client.query('SELECT revision,status,content_json AS content,created_at FROM template_versions WHERE template_id=$1 AND org_id=$2 AND site_id=$3 AND revision=$4',[id,session.org_id,session.site_id,version ?? current.revision])).rows[0];
    if(!selected) throw new Error('Template unavailable');
    const items=(await client.query('SELECT revision,status,created_at FROM template_versions WHERE template_id=$1 AND org_id=$2 AND site_id=$3 ORDER BY revision DESC LIMIT 20 OFFSET $4',[id,session.org_id,session.site_id,(page-1)*20])).rows;
    const favorite=(await client.query('SELECT 1 FROM template_favorites WHERE template_id=$1 AND staff_id=$2 AND org_id=$3 AND site_id=$4',[id,session.principal_id,session.org_id,session.site_id])).rows.length>0;
    return {...current,favorite,selected:{...selected,created_at:selected.created_at.toISOString()},history:{items:items.map(row=>({...row,created_at:row.created_at.toISOString()})),total:current.revision,page,pageSize:20}};
  });
}
export async function setTemplateFavorite(pool,session,id,input,{schema='public'}={}) {
  const favorite=templateFavoriteInput(input);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',['owner','supervisor','auditor']);
    if(!(await client.query('SELECT id FROM templates WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR SHARE',[id,session.org_id,session.site_id])).rows.length) throw new Error('Template unavailable');
    if(favorite) {
      const inserted=(await client.query('INSERT INTO template_favorites(staff_id,org_id,site_id,template_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING staff_id',[session.principal_id,session.org_id,session.site_id,id])).rows[0];
      if(inserted) await domainAudit(client,session,'template.favorited',id);
    } else {
      const removed=(await client.query('DELETE FROM template_favorites WHERE template_id=$1 AND staff_id=$2 AND org_id=$3 AND site_id=$4 RETURNING staff_id',[id,session.principal_id,session.org_id,session.site_id])).rows[0];
      if(removed) await domainAudit(client,session,'template.unfavorited',id);
    }
    return {id,favorite};
  });
}
export async function templateReceipt(pool,session,requestId,{schema='public'}={}) {
  templateRequestId(requestId);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff');
    const row=(await client.query('SELECT request_json AS request,result_json AS result FROM template_requests WHERE request_id=$1 AND org_id=$2 AND site_id=$3 AND created_by=$4',[requestId,session.org_id,session.site_id,session.principal_id])).rows[0];
    return row ? {found:true,...row} : {found:false};
  });
}
export async function changeTemplate(pool,session,kind,id,input,{schema='public'}={}) {
  const change=templateInput(kind,id,input);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`understood:template:${schema}:${session.org_id}:${session.site_id}:${input.requestId}`]);
    const old=(await client.query('SELECT request_json,result_json,created_by FROM template_requests WHERE request_id=$1 AND org_id=$2 AND site_id=$3',[input.requestId,session.org_id,session.site_id])).rows[0];
    if(old) {if(old.created_by!==session.principal_id || templateSignature(old.request_json)!==templateSignature(change)) throw new Error('Template request conflict');return {...old.result_json,duplicate:true};}
    const current=kind==='create' ? null : (await client.query('SELECT * FROM templates WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE',[id,session.org_id,session.site_id])).rows[0];
    if(kind!=='create' && !current) throw new Error('Template unavailable');
    if(current && current.revision!==change.revision) throw new Error('Template revision changed');
    if(current?.status==='archived' && !['restore','duplicate'].includes(kind)) throw new Error('Template is archived');
    if(kind==='restore' && current.status!=='archived') throw new Error('Template is active');
    const fresh=['create','duplicate'].includes(kind),target=fresh ? input.requestId : id;
    let content=['create','edit'].includes(kind) ? templateContent(change) : (await client.query('SELECT content_json FROM template_versions WHERE template_id=$1 AND org_id=$2 AND site_id=$3 AND revision=$4',[id,session.org_id,session.site_id,current.revision])).rows[0].content_json,result;
    if(kind==='use') {
      if((await client.query('SELECT id FROM briefings WHERE id=$1',[input.requestId])).rows.length) throw new Error('Template request conflict');
      await client.query("INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES($1,$2,$3,$4,$5,'processing')",[input.requestId,session.org_id,session.site_id,change.title,content.source]);
      await client.query('INSERT INTO draft_reviews VALUES($1,$2,$3,$4)',[input.requestId,session.org_id,session.site_id,JSON.stringify({revision:1,question:content.question,facts:content.facts,askedFacts:content.askedFacts})]);
      const jobId=randomUUID();
      await client.query("INSERT INTO jobs(id,org_id,site_id,briefing_id,revision,kind,status,due_at) VALUES($1,$2,$3,$4,1,'prepare','queued',clock_timestamp())",[jobId,session.org_id,session.site_id,input.requestId]);
      await bindPreparationAuthority(client,session,jobId);
      result={id:input.requestId,revision:1,state:'processing'};
    } else {
      if(kind==='duplicate') content={...content,title:change.title};
      const revision=fresh ? 1 : current.revision+1,status=kind==='archive' ? 'archived' : 'active';
      if(fresh) {
        if((await client.query('SELECT id FROM templates WHERE id=$1',[target])).rows.length) throw new Error('Template request conflict');
        await client.query('INSERT INTO templates(id,org_id,site_id,revision,status) VALUES($1,$2,$3,$4,$5)',[target,session.org_id,session.site_id,revision,status]);
      } else await client.query('UPDATE templates SET revision=$4,status=$5,updated_at=clock_timestamp() WHERE id=$1 AND org_id=$2 AND site_id=$3',[target,session.org_id,session.site_id,revision,status]);
      await client.query('INSERT INTO template_versions(template_id,org_id,site_id,revision,status,content_json,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[target,session.org_id,session.site_id,revision,status,JSON.stringify(content),session.principal_id]);
      result={id:target,revision,status};
    }
    await client.query('INSERT INTO template_requests(request_id,org_id,site_id,template_id,briefing_id,request_json,result_json,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[input.requestId,session.org_id,session.site_id,target,kind==='use' ? input.requestId : null,JSON.stringify(change),JSON.stringify(result),session.principal_id]);
    await domainAudit(client,session,`template.${kind}`,result.id);
    return {...result,duplicate:false};
  });
}
