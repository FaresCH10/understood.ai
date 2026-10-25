import test from 'node:test';
import assert from 'node:assert/strict';
import {readCrewOverview,readCrewMembers,readCrewChange} from '../src/crew-overview.ts';
import {crewOverviewResult,crewOverviewHttpError} from '../server/crew-overview.mjs';

const at='2026-10-15T08:30:00.000Z',scope='["cedar","beirut","maya"]',expected={page:1,pageSize:5,scope};
const metrics={assigned:2,responses:1,matches:1,clarifications:0,unassessed:0,pending:1,completion:50};
const crew={id:'crew',name:'فريق QA',active:true,member_count:2,metrics};
const overview={items:[crew],total:1,page:1,pageSize:5,site:{id:'beirut',name:'بيروت',timezone:'Asia/Beirut'},contacts:{primary:{name:'Maya',role:'owner'},deputy:null},
  publication:{id:'pub',briefingId:'brief',version:3,title:'Synthetic',publishedAt:at},metrics,metricScope:'latest_publication_frozen_crew_audience',crewSnapshotAvailable:true,
  activity:[{id:'event',action:'crew.created',actor:'Maya',item:'فريق QA',occurredAt:at}],asOf:at};

test('team view accepts actual bounded evidence and keeps missing legacy snapshot distinct from zero',()=>{
  assert.deepEqual(readCrewOverview(overview,expected),overview);
  const acknowledged={...metrics,matches:0,unassessed:0,acknowledged:1},ackCrew={...crew,metrics:acknowledged},ackOverview={...overview,metrics:acknowledged,items:[ackCrew]};
  assert.doesNotThrow(()=>readCrewOverview(ackOverview,expected));
  assert.doesNotThrow(()=>readCrewOverview({...overview,crewSnapshotAvailable:false,items:[{...crew,metrics:null}]},expected));
  assert.doesNotThrow(()=>readCrewOverview({...overview,publication:null,metrics:null,crewSnapshotAvailable:false,items:[{...crew,metrics:null}]},expected));
  assert.doesNotThrow(()=>readCrewOverview({...overview,items:[],page:2}, {...expected,page:2}));
});

test('team overview rejects forged scope, denominator, snapshot, paging, contacts, private extras and malformed times',()=>{
  const values=[null,{},[],{...overview,secret:'PRIVATE'}, {...overview,total:2},{...overview,page:2},{...overview,pageSize:100},
    {...overview,items:[crew,crew],total:2},{...overview,items:[{...crew,id:'../bad'}]},{...overview,items:[{...crew,metrics:{...metrics,pending:0}}]},
    {...overview,items:[{...crew,id:'one'},{...crew,id:'two'}],total:2},{...overview,crewSnapshotAvailable:false},
    {...overview,publication:null},{...overview,metrics:{...metrics,completion:80}},{...overview,metrics:{...metrics,assigned:6000}},
    {...overview,metrics:{...metrics,acknowledged:1}},{...overview,metrics:{...metrics,matches:0,unassessed:0,acknowledged:2}},
    {...overview,site:{...overview.site,id:'other-site'}},{...overview,site:{...overview.site,timezone:'Not/AZone'}},
    {...overview,contacts:{...overview.contacts,primary:{name:'Bad',role:'administrator'}}},
    {...overview,contacts:{...overview.contacts,primary:{...overview.contacts.primary,email:'private@example.test'}}},
    {...overview,activity:[{...overview.activity[0],action:'private.provider.token'}]}, {...overview,activity:Array(7).fill(overview.activity[0])},
    {...overview,activity:[{...overview.activity[0],occurredAt:'2026-02-30T08:30:00.000Z'}]}, {...overview,asOf:'bad'}];
  for(const value of values)assert.throws(()=>readCrewOverview(value,expected),/cannot be verified/);
  assert.throws(()=>readCrewOverview(overview,{...expected,scope:'bad'}),/cannot be verified/);
});

test('selected current members must match the exact crew and site, with no extra private data',()=>{
  const worker={id:'worker',org_id:'cedar',site_id:'beirut',code:'عامل QA-1',name:'Rana',language:'ar',language_selection_required:false,language_selected:true,
    language_selected_at:null,language_selected_by:null,active:true,crew_id:'crew',crew_name:'فريق QA',pending_language_request:null};
  const page={items:[worker],total:1,page:1,pageSize:5},selection={...expected,crewId:'crew'};
  assert.deepEqual(readCrewMembers(page,selection),page);
  for(const value of [{...page,items:[{...worker,crew_id:'other'}]}, {...page,items:[{...worker,site_id:'other'}]},
    {...page,items:[{...worker,active:false}]},{...page,items:[{...worker,grant:'PRIVATE'}]},
    {...page,items:[{...worker,language:'xx'}]},{...page,items:[{...worker,language_selected:false}]},
    {...page,items:[{...worker,name:'\n'}]},{...page,items:[{...worker,pending_language_request:{id:'r',currentLanguage:'ar',requestedLanguage:'ar',reason:'',requestedAt:at}}]},
    {...page,items:[{...worker,pending_language_request:{id:'r',currentLanguage:'ar',requestedLanguage:'ur',reason:'',requestedAt:at,private:'x'}}]},
    {...page,items:[worker,worker],total:2},{...page,total:0}])assert.throws(()=>readCrewMembers(value,selection),/cannot be verified/);
  const request={id:'r',currentLanguage:'ar',requestedLanguage:'ur',reason:'Need Urdu',requestedAt:at};
  assert.doesNotThrow(()=>readCrewMembers({...page,items:[{...worker,pending_language_request:request}]},selection));
});

test('crew mutation validation cannot report a different crew, actor scope or malformed outcome as confirmed',()=>{
  const row={id:'crew',org_id:'cedar',site_id:'beirut',name:'فريق QA',active:true,member_count:2};
  assert.deepEqual(readCrewChange(row,scope,'crew'),row);assert.equal(readCrewChange({...row,duplicate:true},scope,'crew').duplicate,true);
  for(const value of [{...row,id:'other'},{...row,org_id:'harbor'},{...row,site_id:'tripoli'},{...row,active:1},{...row,member_count:-1},{...row,duplicate:'yes'},{...row,secret:'PRIVATE'}])
    assert.throws(()=>readCrewChange(value,scope,'crew'),/cannot be verified/);
});

test('server projection uses frozen assignment IDs, excludes future page internals and counts newer audio as unassessed',()=>{
  const input={page:{items:[{id:'crew',name:'QA',active:true,member_count:9,private:'PRIVATE'}],total:1,page:1,pageSize:5,private:'PRIVATE'},site:overview.site,contacts:overview.contacts,publication:overview.publication,
    responses:[{assignment_id:'a',outcome:'matched',attempt_at:at,attempt_order:1,audio_status:'received',audio_order:2,audio_at:at,attempt_submission:'typed',audio_submission:'audio'},{assignment_id:'b',outcome:null}],
    audience:[{assignment_id:'a',crew_id:'crew'},{assignment_id:'b',crew_id:null}],activity:[],asOf:at};
  const result=crewOverviewResult(input);assert.equal(result.items[0].member_count,9);assert.equal(result.items[0].metrics.assigned,1);
  assert.equal(result.items[0].metrics.matches,0);assert.equal(result.items[0].metrics.unassessed,1);assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.equal(crewOverviewResult({...input,audience:[]}).items[0].metrics,null);
  assert.throws(()=>crewOverviewResult({...input,responses:Array(5001).fill({assignment_id:'bad'})}),/limit exceeded/);
  assert.deepEqual(crewOverviewHttpError(new Error('PRIVATE DATABASE ERROR')),{status:503,message:'Crew overview unavailable'});
});
