import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {listCalendar,timeZoneCivilDate,timeZoneDayStart,calendarMonthBounds,calendarMonthInput,nextCalendarMonth} from '../server/calendar.mjs';
import {checkedCalendar,calendarMonthGrid,calendarAddDays,calendarMoveMonth,calendarTodayForZone,calendarMonthForZone} from '../src/calendar-data.ts';
import {CANONICAL_SOURCE,syntheticPrepare} from '../server/domain.mjs';
import {createAppServer} from '../server/index.mjs';
import {provisionStaffCredential} from '../server/auth.mjs';

const beirutOwner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const calendarPayload=(extra={})=>({month:'2026-10',timezone:'Asia/Beirut',today:'2026-10-30',asOf:'2026-10-30T12:00:00.000Z',
  instructions:[{id:'p1',kind:'publication',date:'2026-10-02',at:'2026-10-02T05:15:00.000Z',briefingId:'b1',title:'Shelf handover',version:1,
    state:'published',audience:18,metrics:{assigned:18,responses:16,matches:13,clarifications:2,unassessed:1,pending:2,completion:78},openClarifications:1}],
  events:[{id:'response:t1',kind:'response',date:'2026-10-02',at:'2026-10-02T06:10:00.000Z',title:'Shelf handover',version:1,worker:'Worker 001',workerName:'Rana Khoury',outcome:'matched'}],...extra});

test('calendar civil dates follow the site time zone across the Beirut DST change',()=>{
  assert.equal(timeZoneCivilDate('2026-10-31T21:30:00.000Z','Asia/Beirut'),'2026-10-31');
  assert.equal(timeZoneCivilDate('2026-10-31T22:30:00.000Z','Asia/Beirut'),'2026-11-01');
  assert.equal(timeZoneDayStart('2026-10-01','Asia/Beirut'),'2026-09-30T21:00:00.000Z');
  assert.equal(timeZoneDayStart('2026-10-25','Asia/Beirut'),'2026-10-24T22:00:00.000Z');
  assert.equal(timeZoneDayStart('2026-03-29','Asia/Beirut'),'2026-03-28T22:00:00.000Z');
  assert.deepEqual(calendarMonthBounds('2026-10','Asia/Beirut'),{start:'2026-09-30T21:00:00.000Z',end:'2026-10-31T22:00:00.000Z'});
  assert.deepEqual(calendarMonthBounds('2026-11','Asia/Beirut'),{start:'2026-10-31T22:00:00.000Z',end:'2026-11-30T22:00:00.000Z'});
  assert.equal(nextCalendarMonth('2026-12'),'2027-01');
  assert.equal(calendarMonthInput(undefined),null);
  assert.equal(calendarMonthInput('2026-10'),'2026-10');
  assert.equal(calendarMonthInput('2000-01'),'2000-01');
  assert.equal(calendarMonthInput('2100-12'),'2100-12');
  for(const value of ['2026-00','2026-13','1999-12','2101-01','2026-1','26-01','2026-10-01',202610])
    assert.throws(()=>calendarMonthInput(value),/Invalid calendar month/);
});

test('calendar browser validation rejects forged payloads and grids weeks from Monday',()=>{
  const months=calendarMonthGrid('2026-10');
  assert.equal(months.length%7,0);
  assert.deepEqual(months.slice(0,3),[null,null,null]);
  assert.equal(months[3],'2026-10-01');
  assert.equal(months.filter(Boolean).at(-1),'2026-10-31');
  const leap=calendarMonthGrid('2028-02');
  assert.equal(leap.filter(Boolean).length,29);
  assert.equal(calendarAddDays('2026-12-31',1),'2027-01-01');
  assert.equal(calendarAddDays('2026-03-01',-1),'2026-02-28');
  assert.equal(calendarMoveMonth('2026-01',-1),'2025-12');
  assert.equal(calendarMoveMonth('2026-12',1),'2027-01');
  assert.equal(calendarTodayForZone('Asia/Beirut',new Date('2026-10-31T22:30:00.000Z')),'2026-11-01');
  assert.equal(calendarMonthForZone('Asia/Beirut',new Date('2026-10-31T21:30:00.000Z')),'2026-10');
  assert.equal(calendarTodayForZone('Not/AZone',new Date('2026-10-31T12:00:00.000Z')),'2026-10-31');
  assert.equal(checkedCalendar(calendarPayload(),'2026-10').instructions[0].metrics.completion,78);
  for(const mutate of [
    value=>{value.month='2026-11';},
    value=>{value.instructions[0].kind='draft';},
    value=>{value.instructions[0].date='2026-02-30';},
    value=>{value.instructions[0].title='';},
    value=>{value.instructions[0].metrics.assigned=-1;},
    value=>{value.events[0].kind='deleted';},
    value=>{value.events[0].date='31-10-2026';},
    value=>{value.events[0].workerName=42;},
    value=>{value.instructions=Array(5001).fill(value.instructions[0]);},
  ]) {const value=calendarPayload();mutate(value);assert.throws(()=>checkedCalendar(value,'2026-10'),/Calendar/);}
});

test('calendar groups seeded instructions, progress and activity by site civil date and enforces staff scope',t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-30T12:00:00.000Z')});
  const db=openDatabase(':memory:');seed(db);
  try {
    const payload=listCalendar(db,beirutOwner);
    assert.deepEqual(Object.keys(payload),['month','timezone','today','asOf','instructions','events']);
    assert.equal(payload.month,'2026-10');assert.equal(payload.timezone,'Asia/Beirut');assert.equal(payload.today,'2026-10-30');
    assert.equal(payload.instructions.length,1);
    const [shelf]=payload.instructions;
    assert.equal(shelf.briefingId,'shelf');assert.equal(shelf.kind,'publication');assert.equal(shelf.date,'2026-10-30');assert.equal(shelf.at,'2026-10-30T12:00:00.000Z');
    assert.equal(shelf.audience,30);assert.equal(shelf.metrics.assigned,30);assert.equal(shelf.metrics.responses,24);
    assert.equal(shelf.metrics.matches,21);assert.equal(shelf.metrics.clarifications,3);assert.equal(shelf.metrics.pending,6);assert.equal(shelf.openClarifications,3);
    const responses=payload.events.filter(event=>event.kind==='response'),clarifications=payload.events.filter(event=>event.kind==='clarification');
    assert.equal(responses.length,24);assert.equal(clarifications.length,3);
    assert.ok(responses.every(event=>event.date==='2026-10-30'&&event.briefingId==='shelf'&&event.version===3&&event.workerName));
    assert.ok(clarifications.some(event=>event.reason==='Unclear audio'&&event.status==='open'));
    assert.equal(payload.events.length,27);
    const verified=checkedCalendar(payload,'2026-10');
    assert.equal(verified.instructions[0].metrics.responses,24);assert.equal(verified.events.length,27);

    for(const role of ['supervisor','auditor']) {
      db.prepare('INSERT INTO staff VALUES(?,?,?,?,?,1)').run(`reader-${role}`,'cedar','beirut',role,role);
      assert.equal(listCalendar(db,{...beirutOwner,principal_id:`reader-${role}`,role},{month:'2026-10'}).instructions.length,1);
    }
    assert.equal(listCalendar(db,{principal_type:'staff',principal_id:'harbor-owner',org_id:'harbor',site_id:'harbor-yard',role:'owner'},{month:'2026-10'}).instructions.length,0);
    for(const session of [{...beirutOwner,role:'administrator'},{...beirutOwner,principal_type:'worker'},{...beirutOwner,site_id:'harbor-yard'}])
      assert.throws(()=>listCalendar(db,session),/Forbidden/);
    for(const input of [null,[],{month:'2026-13'},{month:'2026-10',page:'2'}]) assert.throws(()=>listCalendar(db,beirutOwner,input),/Invalid calendar/);
    assert.equal(listCalendar(db,beirutOwner,{month:'2026-09'}).instructions.length,0);
  } finally {db.close();}
});

test('calendar includes queued schedules on their publish date but not their response or edit activity yet',t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-30T12:00:00.000Z')});
  const db=openDatabase(':memory:');seed(db);
  try {
    db.prepare(`INSERT INTO publication_schedules(id,org_id,site_id,briefing_id,request_json,snapshot_hash,recipients_json,requested_by,authority_json,publish_at,created_at,state)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,'queued')`).run('cal-schedule','cedar','beirut','shelf',
      JSON.stringify({nextVersion:5,workerIds:['worker-1','worker-2']}),'a'.repeat(64),JSON.stringify(['worker-1','worker-2']),'maya','{}',
      '2026-11-04T07:00:00.000Z','2026-10-30T12:00:00.000Z');
    const november=listCalendar(db,beirutOwner,{month:'2026-11'});
    assert.equal(november.instructions.length,1);assert.equal(november.events.length,0);
    const [scheduled]=november.instructions;
    assert.equal(scheduled.id,'schedule:cal-schedule');assert.equal(scheduled.kind,'scheduled');assert.equal(scheduled.state,'scheduled');
    assert.equal(scheduled.date,'2026-11-04');assert.equal(scheduled.at,'2026-11-04T07:00:00.000Z');assert.equal(scheduled.version,5);
    assert.equal(scheduled.audience,2);assert.deepEqual(scheduled.metrics,{assigned:2,responses:0,matches:0,clarifications:0,unassessed:0,pending:2,completion:0});
    assert.equal(listCalendar(db,beirutOwner,{month:'2026-10'}).instructions.length,1);
  } finally {db.close();}
});

test('calendar HTTP requires a current page session context and allows owner, supervisor and auditor only',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-30T12:00:00.000Z')});
  const db=openDatabase(':memory:');seed(db);
  try {
    for(const [id,role] of [['reader','auditor'],['rami','supervisor'],['admin','administrator']])
      db.prepare('INSERT INTO staff VALUES(?,?,?,?,?,1)').run(id,'cedar','beirut',id,role);
    for(const [id,email] of [['maya','maya@calendar.test'],['reader','reader@calendar.test'],['rami','rami@calendar.test'],['admin','admin@calendar.test']])
      provisionStaffCredential(db,id,email,'Synthetic-calendar-password');
    db.prepare(`INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,published_at,state) VALUES(?,?,?,?,?,?,?,?)`)
      .run('calendar-http','cedar','beirut','shelf',77,JSON.stringify(syntheticPrepare(CANONICAL_SOURCE)),'2026-10-15T08:00:00.000Z','published');
    const server=createAppServer(db,{tier:'local',aiMode:'synthetic',accessMode:'credential',dataClass:'synthetic',publicOrigin:'http://127.0.0.1:3020'});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}/api`;
    const login=async email=>{
      const response=await fetch(`${base}/auth/staff/login`,{method:'POST',headers:{origin:'http://127.0.0.1:3020','content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-calendar-password'})});
      assert.equal(response.status,200);
      const cookie=response.headers.get('set-cookie').split(';')[0];
      const session=await (await fetch(`${base}/session`,{headers:{cookie}})).json();
      assert.match(session.clientContext,/^[a-f0-9]{64}$/);
      return {cookie,context:session.clientContext};
    };
    try {
      const owner=await login('maya@calendar.test'),auditor=await login('reader@calendar.test'),supervisor=await login('rami@calendar.test'),admin=await login('admin@calendar.test');
      const call=(account,query='?month=2026-10',context=account?.context)=>fetch(`${base}/calendar${query}`,{headers:account?{cookie:account.cookie,...(context?{'x-client-session-context':context}:{})}:{}});
      assert.equal((await call(owner,'?month=2026-10',null)).status,409);
      assert.equal((await call(owner,'?month=2026-10','0'.repeat(64))).status,409);
      for(const account of [owner,supervisor,auditor]) {
        const response=await call(account);assert.equal(response.status,200);
        const payload=await response.json();
        assert.equal(payload.month,'2026-10');assert.ok(payload.instructions.some(instruction=>instruction.id==='calendar-http'));
        assert.doesNotMatch(JSON.stringify(payload),/org_id|site_id|snapshot|token|password/i);
        const verified=checkedCalendar(payload,'2026-10');
        assert.equal(verified.month,'2026-10');assert.equal(verified.instructions.length,payload.instructions.length);assert.equal(verified.events.length,payload.events.length);
        assert.ok(payload.events.length>0&&payload.events.every(event=>event.briefingId));
      }
      const supervisorCalendar=await (await call(supervisor)).json();
      const linkedBriefing=supervisorCalendar.events[0].briefingId;
      const instruction=await fetch(`${base}/briefings/${encodeURIComponent(linkedBriefing)}`,{headers:{cookie:supervisor.cookie,'x-client-session-context':supervisor.context}});
      assert.equal(instruction.status,200);assert.equal((await instruction.json()).id,linkedBriefing);
      assert.equal((await call(admin)).status,403);
      assert.equal((await call(owner,'?month=2026-13')).status,400);
      assert.equal((await call(owner,'?month=2026-10&extra=1')).status,400);
      assert.equal((await call(null)).status,401);
    } finally {await new Promise(resolve=>server.close(resolve));}
  } finally {db.close();}
});
