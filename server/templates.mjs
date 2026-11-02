import {randomUUID} from 'node:crypto';
import {NOW,transaction} from './db.mjs';
import {briefingAuthority,briefingAudit} from './preparation.mjs';
import {templateInput,templateSignature,templateContent,templateFilters,templateFavoriteInput,templateHistoryInput,templateRequestId} from './template-input.mjs';
export function ensureTemplateSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),
    revision INTEGER NOT NULL CHECK(revision>0),status TEXT NOT NULL CHECK(status IN ('active','archived')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS template_versions (
    template_id TEXT NOT NULL REFERENCES templates(id),org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),
    revision INTEGER NOT NULL CHECK(revision>0),status TEXT NOT NULL CHECK(status IN ('active','archived')),content_json TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES staff(id),created_at TEXT NOT NULL,PRIMARY KEY(template_id,revision)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS template_requests (
    request_id TEXT NOT NULL,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),
    template_id TEXT NOT NULL REFERENCES templates(id),briefing_id TEXT REFERENCES briefings(id),request_json TEXT NOT NULL,result_json TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES staff(id),created_at TEXT NOT NULL,PRIMARY KEY(org_id,site_id,request_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS template_favorites (
    staff_id TEXT NOT NULL REFERENCES staff(id),org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),
    template_id TEXT NOT NULL REFERENCES templates(id),created_at TEXT NOT NULL,PRIMARY KEY(staff_id,template_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_template_favorites_scope ON template_favorites(org_id,site_id,staff_id);
  CREATE TRIGGER IF NOT EXISTS template_scope BEFORE INSERT ON templates WHEN
    NOT EXISTS(SELECT 1 FROM sites WHERE id=NEW.site_id AND org_id=NEW.org_id) BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS template_identity BEFORE UPDATE ON templates WHEN NEW.id IS NOT OLD.id OR NEW.org_id IS NOT OLD.org_id OR NEW.site_id IS NOT OLD.site_id OR NEW.created_at IS NOT OLD.created_at
    BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS template_version_scope BEFORE INSERT ON template_versions WHEN
    NOT EXISTS(SELECT 1 FROM templates WHERE id=NEW.template_id AND org_id=NEW.org_id AND site_id=NEW.site_id)
    OR NOT EXISTS(SELECT 1 FROM staff WHERE id=NEW.created_by AND org_id=NEW.org_id AND site_id=NEW.site_id)
    BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS template_request_scope BEFORE INSERT ON template_requests WHEN
    NOT EXISTS(SELECT 1 FROM templates WHERE id=NEW.template_id AND org_id=NEW.org_id AND site_id=NEW.site_id)
    OR NOT EXISTS(SELECT 1 FROM staff WHERE id=NEW.created_by AND org_id=NEW.org_id AND site_id=NEW.site_id)
    OR (NEW.briefing_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM briefings WHERE id=NEW.briefing_id AND org_id=NEW.org_id AND site_id=NEW.site_id))
    BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS template_favorite_scope BEFORE INSERT ON template_favorites WHEN
    NOT EXISTS(SELECT 1 FROM staff WHERE id=NEW.staff_id AND org_id=NEW.org_id AND site_id=NEW.site_id)
    OR NOT EXISTS(SELECT 1 FROM templates WHERE id=NEW.template_id AND org_id=NEW.org_id AND site_id=NEW.site_id)
    BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;`);
  for(const table of ['template_versions','template_requests']) for(const action of ['UPDATE','DELETE']) db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'Template evidence is immutable'); END;`);
}
function authority(db,session) {
  if(session?.principal_type!=='staff' || !['owner','supervisor','auditor'].includes(session.role)
    || !db.prepare('SELECT id FROM staff WHERE id=? AND org_id=? AND site_id=? AND role=? AND active=1').get(session.principal_id,session.org_id,session.site_id,session.role)) throw new Error('Forbidden');
}
export function listTemplates(db,session,input={}) {
  const {search,status,favorites,page,pageSize}=templateFilters(input);authority(db,session);
  const row=db.prepare(`WITH filtered AS (SELECT t.id,t.revision,t.status,t.updated_at,json_extract(v.content_json,'$.title') AS title,json_extract(v.content_json,'$.description') AS description,
    EXISTS(SELECT 1 FROM template_favorites f WHERE f.template_id=t.id AND f.staff_id=? AND f.org_id=t.org_id AND f.site_id=t.site_id) AS favorite
    FROM templates t JOIN template_versions v ON v.template_id=t.id AND v.revision=t.revision AND v.org_id=t.org_id AND v.site_id=t.site_id
    WHERE t.org_id=? AND t.site_id=? AND (?='all' OR t.status=?) AND (?='' OR instr(lower(json_extract(v.content_json,'$.title')),lower(?))>0)
    AND (?='all' OR EXISTS(SELECT 1 FROM template_favorites f WHERE f.template_id=t.id AND f.staff_id=? AND f.org_id=t.org_id AND f.site_id=t.site_id)))
    SELECT (SELECT COUNT(*) FROM filtered) AS total,(SELECT json_group_array(json_object('id',id,'revision',revision,'status',status,'title',title,'description',description,'updated_at',updated_at,'favorite',favorite))
    FROM (SELECT * FROM filtered ORDER BY updated_at DESC,id LIMIT ? OFFSET ?)) AS items`).get(session.principal_id,session.org_id,session.site_id,status,status,search,search,favorites,session.principal_id,pageSize,(page-1)*pageSize);
  return {items:JSON.parse(row.items).map(item=>({...item,favorite:!!item.favorite})),total:row.total,page,pageSize};
}
export function getTemplate(db,session,id,input={}) {
  const {page,version}=templateHistoryInput(input);
  return transaction(db,()=>{
    authority(db,session);
    const current=db.prepare('SELECT id,revision,status FROM templates WHERE id=? AND org_id=? AND site_id=?').get(id,session.org_id,session.site_id);
    if(!current) throw new Error('Template unavailable');
    const selected=db.prepare('SELECT revision,status,content_json,created_at FROM template_versions WHERE template_id=? AND org_id=? AND site_id=? AND revision=?').get(id,session.org_id,session.site_id,version ?? current.revision);
    if(!selected) throw new Error('Template unavailable');
    const items=db.prepare('SELECT revision,status,created_at FROM template_versions WHERE template_id=? AND org_id=? AND site_id=? ORDER BY revision DESC LIMIT 20 OFFSET ?').all(id,session.org_id,session.site_id,(page-1)*20);
    const favorite=!!db.prepare('SELECT 1 FROM template_favorites WHERE template_id=? AND staff_id=? AND org_id=? AND site_id=?').get(id,session.principal_id,session.org_id,session.site_id);
    return {...current,favorite,selected:{revision:selected.revision,status:selected.status,content:JSON.parse(selected.content_json),created_at:selected.created_at},history:{items,total:current.revision,page,pageSize:20}};
  });
}
export function setTemplateFavorite(db,session,id,input) {
  const favorite=templateFavoriteInput(input);
  return transaction(db,()=>{
    authority(db,session);
    if(!db.prepare('SELECT 1 FROM templates WHERE id=? AND org_id=? AND site_id=?').get(id,session.org_id,session.site_id)) throw new Error('Template unavailable');
    const existing=!!db.prepare('SELECT 1 FROM template_favorites WHERE template_id=? AND staff_id=? AND org_id=? AND site_id=?').get(id,session.principal_id,session.org_id,session.site_id);
    if(favorite && !existing) {
      db.prepare('INSERT INTO template_favorites VALUES(?,?,?,?,?)').run(session.principal_id,session.org_id,session.site_id,id,NOW());
      briefingAudit(db,session,'template.favorited',id);
    } else if(!favorite && existing) {
      db.prepare('DELETE FROM template_favorites WHERE template_id=? AND staff_id=? AND org_id=? AND site_id=?').run(id,session.principal_id,session.org_id,session.site_id);
      briefingAudit(db,session,'template.unfavorited',id);
    }
    return {id,favorite};
  });
}
export function templateReceipt(db,session,requestId) {
  templateRequestId(requestId);briefingAuthority(db,session);
  const row=db.prepare('SELECT request_json,result_json FROM template_requests WHERE request_id=? AND org_id=? AND site_id=? AND created_by=?').get(requestId,session.org_id,session.site_id,session.principal_id);
  return row ? {found:true,request:JSON.parse(row.request_json),result:JSON.parse(row.result_json)} : {found:false};
}
export function changeTemplate(db,session,kind,id,input) {
  const change=templateInput(kind,id,input);
  return transaction(db,()=>{
    briefingAuthority(db,session);
    const old=db.prepare('SELECT request_json,result_json,created_by FROM template_requests WHERE request_id=? AND org_id=? AND site_id=?').get(input.requestId,session.org_id,session.site_id);
    if(old) {if(old.created_by!==session.principal_id || templateSignature(JSON.parse(old.request_json))!==templateSignature(change)) throw new Error('Template request conflict');return {...JSON.parse(old.result_json),duplicate:true};}
    const current=kind==='create' ? null : db.prepare('SELECT t.*,v.content_json FROM templates t JOIN template_versions v ON v.template_id=t.id AND v.revision=t.revision WHERE t.id=? AND t.org_id=? AND t.site_id=?').get(id,session.org_id,session.site_id);
    if(kind!=='create' && !current) throw new Error('Template unavailable');
    if(current && current.revision!==change.revision) throw new Error('Template revision changed');
    if(current?.status==='archived' && !['restore','duplicate'].includes(kind)) throw new Error('Template is archived');
    if(kind==='restore' && current.status!=='archived') throw new Error('Template is active');
    const now=NOW(),fresh=['create','duplicate'].includes(kind),target=fresh ? input.requestId : id;
    let content=kind==='create' || kind==='edit' ? templateContent(change) : JSON.parse(current.content_json);
    let result;
    if(kind==='use') {
      if(db.prepare('SELECT id FROM briefings WHERE id=?').get(input.requestId)) throw new Error('Template request conflict');
      db.prepare('INSERT INTO briefings(id,org_id,site_id,title,source,revision,next_version,state,prepared_json,created_at,updated_at) VALUES(?,?,?,?,?,1,1,\'processing\',NULL,?,?)').run(input.requestId,session.org_id,session.site_id,change.title,content.source,now,now);
      db.prepare('INSERT INTO draft_reviews VALUES(?,?,?,?)').run(input.requestId,session.org_id,session.site_id,JSON.stringify({revision:1,question:content.question,facts:content.facts,askedFacts:content.askedFacts}));
      db.prepare("INSERT INTO jobs VALUES(?,?,?,?,1,'prepare','queued',0,?,NULL,NULL,?)").run(randomUUID(),session.org_id,session.site_id,input.requestId,now,now);
      result={id:input.requestId,revision:1,state:'processing'};
    } else {
      if(kind==='duplicate') content={...content,title:change.title};
      const revision=fresh ? 1 : current.revision+1,status=kind==='archive' ? 'archived' : 'active';
      if(fresh) {
        if(db.prepare('SELECT id FROM templates WHERE id=?').get(target)) throw new Error('Template request conflict');
        db.prepare('INSERT INTO templates VALUES(?,?,?,?,?,?,?)').run(target,session.org_id,session.site_id,revision,status,now,now);
      } else db.prepare('UPDATE templates SET revision=?,status=?,updated_at=? WHERE id=? AND org_id=? AND site_id=?').run(revision,status,now,target,session.org_id,session.site_id);
      db.prepare('INSERT INTO template_versions VALUES(?,?,?,?,?,?,?,?)').run(target,session.org_id,session.site_id,revision,status,JSON.stringify(content),session.principal_id,now);
      result={id:target,revision,status};
    }
    db.prepare('INSERT INTO template_requests VALUES(?,?,?,?,?,?,?,?,?)').run(input.requestId,session.org_id,session.site_id,target,kind==='use' ? input.requestId : null,JSON.stringify(change),JSON.stringify(result),session.principal_id,now);
    briefingAudit(db,session,`template.${kind}`,result.id);
    return {...result,duplicate:false};
  });
}
