import test from 'node:test';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase, NOW } from '../server/db.mjs';
import { sqliteApp, loginPrincipal } from './helpers/sqlite-app.mjs';

test('SQLite overview attention queue groups clarifications, outstanding replies and delivery problems with frozen titles', async () => {
  const db=openDatabase(':memory:'),server=sqliteApp(db);
  await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api`;
  const request=async(path,cookie,body)=>{
    const headers={'content-type':'application/json',...(cookie?{cookie}:{})};
    if(body && path.startsWith('/worker/'))headers['x-client-session-context']=(await (await fetch(`${base}/session`,{headers:{cookie}})).json()).clientContext || '';
    return fetch(`${base}${path}`,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})});
  };
  const login=async principal=>(await loginPrincipal(base,principal)).headers.get('set-cookie').split(';')[0];
  try {
    assert.equal((await request('/overview')).status,401);
    const staff=await login('maya'),worker=await login('worker-30'),worker24=await login('worker-24'),foreign=await login('harbor-owner');
    assert.equal((await request('/overview',worker)).status,403);
    const foreignOverview=await (await request('/overview',foreign)).json();
    assert.deepEqual(foreignOverview.attention,{total:0,needsAttention:{total:0,items:[]},waiting:{total:0,items:[]},delivery:{total:0,items:[]}});

    const overview=await (await request('/overview',staff)).json();
    assert.equal(overview.attention.total,9);
    assert.equal(overview.attention.needsAttention.total,3);
    assert.equal(overview.attention.needsAttention.items.length,3);
    assert.deepEqual(overview.attention.needsAttention.items.map((item)=>item.id).sort(),['clarification-14','clarification-21','clarification-28']);
    assert.equal(overview.attention.waiting.total,6);
    assert.deepEqual(overview.attention.waiting.items.map((item)=>item.assignmentId),['assignment-24','assignment-25','assignment-26','assignment-27','assignment-29']);
    assert.ok(overview.attention.waiting.items.every((item)=>item.title===overview.publication.title && item.briefingId==='shelf'));
    assert.deepEqual(overview.attention.delivery,{total:0,items:[]});

    assert.equal((await request('/overview/attention?group=waiting&page=1&pageSize=2')).status,401);
    assert.equal((await request('/overview/attention?group=waiting&page=1',worker)).status,403);
    for(const query of ['group=clarifications&page=1','group=waiting&page=0','group=waiting&page=abc','group=waiting&pageSize=51','group=waiting&page=1&limit=5'])
      assert.equal((await request(`/overview/attention?${query}`,staff)).status,400,query);
    const waitingFirst=await (await request('/overview/attention?group=waiting&page=1&pageSize=2',staff)).json();
    const waitingSecond=await (await request('/overview/attention?group=waiting&page=2&pageSize=2',staff)).json();
    const waitingThird=await (await request('/overview/attention?group=waiting&page=3&pageSize=2',staff)).json();
    const waitingPast=await (await request('/overview/attention?group=waiting&page=4&pageSize=2',staff)).json();
    assert.equal(waitingFirst.group,'waiting');
    assert.equal(waitingFirst.total,6);
    assert.equal(waitingFirst.items.length,2);
    assert.deepEqual(waitingFirst.items.map((item)=>item.assignmentId),['assignment-24','assignment-25']);
    const paged=[...waitingFirst.items,...waitingSecond.items,...waitingThird.items];
    assert.equal(paged.length,6);
    assert.equal(new Set(paged.map((item)=>item.assignmentId)).size,6);
    assert.deepEqual(paged.slice(0,5).map((item)=>item.assignmentId),overview.attention.waiting.items.map((item)=>item.assignmentId));
    assert.equal(waitingThird.items[0].assignmentId,'assignment-29');
    assert.deepEqual(waitingPast.items,[]);
    assert.equal(waitingPast.total,6);
    assert.ok(paged.every((item)=>item.title===overview.publication.title&&item.briefingId==='shelf'));
    const emptyDelivery=await (await request('/overview/attention?group=delivery&page=1',staff)).json();
    assert.equal(emptyDelivery.total,0);
    assert.deepEqual(emptyDelivery.items,[]);
    const foreignWaiting=await (await request('/overview/attention?group=waiting&page=1',foreign)).json();
    assert.equal(foreignWaiting.total,0);
    assert.deepEqual(foreignWaiting.items,[]);

    const now=NOW(),sendId=randomUUID();
    db.prepare(`INSERT INTO instruction_sends(request_id,org_id,site_id,briefing_id,publication_request_id,audience_json,
      response_mode,delivery_mode,evidence_mode,state,publication_id,audience_count,delivered,undelivered,undelivered_json,
      error,request_json,requested_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      sendId,'cedar','beirut','shelf',randomUUID(),JSON.stringify({allWorkers:true}),'question','text','none','published','shelf-v3',
      30,24,6,JSON.stringify([{reason:'language_unavailable',language:'ur',count:4},{reason:'worker_inactive',language:null,count:2}]),
      'internal provider detail',JSON.stringify({briefingId:'shelf'}),'maya',now,now);

    const frozenTitle=overview.publication.title;
    db.prepare("UPDATE briefings SET title='Renamed shelf draft' WHERE id='shelf'").run();
    const withDelivery=await (await request('/overview',staff)).json();
    assert.equal(withDelivery.attention.total,10);
    assert.equal(withDelivery.attention.delivery.total,1);
    const problem=withDelivery.attention.delivery.items[0];
    assert.equal(problem.requestId,sendId);
    assert.equal(problem.briefingId,'shelf');
    assert.equal(problem.title,frozenTitle);
    assert.equal(problem.state,'published');
    assert.equal(problem.undelivered,6);
    assert.deepEqual(problem.reasons,[{reason:'language_unavailable',language:'ur',count:4},{reason:'worker_inactive',language:null,count:2}]);
    assert.deepEqual(Object.keys(problem).sort(),['briefingId','delivered','reasons','requestId','state','title','undelivered','updatedAt']);
    assert.ok(!/error|request_json|undelivered_json|requested_by/.test(JSON.stringify(withDelivery.attention.delivery)));
    assert.ok(withDelivery.attention.needsAttention.items.every((item)=>item.title===frozenTitle));
    assert.ok(withDelivery.attention.waiting.items.every((item)=>item.title===frozenTitle));
    const deliveryPage=await (await request('/overview/attention?group=delivery&page=1',staff)).json();
    assert.equal(deliveryPage.total,1);
    assert.deepEqual(deliveryPage.items.map((item)=>item.requestId),[sendId]);
    assert.equal(deliveryPage.items[0].title,frozenTitle);
    assert.deepEqual(deliveryPage.items[0].reasons,problem.reasons);
    assert.deepEqual(Object.keys(deliveryPage.items[0]).sort(),['briefingId','delivered','reasons','requestId','state','title','undelivered','updatedAt']);
    assert.ok(!/error|request_json|undelivered_json|requested_by/.test(JSON.stringify(deliveryPage)));
    const foreignDelivery=await (await request('/overview/attention?group=delivery&page=1',foreign)).json();
    assert.equal(foreignDelivery.total,0);
    assert.deepEqual(foreignDelivery.items,[]);

    const preparingId=randomUUID();
    db.prepare("INSERT INTO briefings(id,org_id,site_id,title,source,revision,next_version,state,prepared_json,created_at,updated_at) VALUES('shelf-queued','cedar','beirut','Queued shelf batch','Hold the blue shelf.',1,1,'draft',NULL,?,?)").run(now,now);
    db.prepare(`INSERT INTO instruction_sends(request_id,org_id,site_id,briefing_id,publication_request_id,audience_json,
      response_mode,delivery_mode,evidence_mode,state,publication_id,audience_count,delivered,undelivered,undelivered_json,
      error,request_json,requested_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      preparingId,'cedar','beirut','shelf-queued',randomUUID(),JSON.stringify({allWorkers:true}),'question','text','none','preparing',null,
      30,0,30,'[]',null,JSON.stringify({briefingId:'shelf-queued'}),'maya',now,now);
    const preparing=await (await request('/overview',staff)).json();
    assert.equal(preparing.attention.delivery.total,1);
    assert.deepEqual(preparing.attention.delivery.items.map((item)=>item.requestId),[sendId]);

    assert.equal((await request('/worker/briefings/assignment-24/answers',worker24,{submissionId:randomUUID(),text:'Finished items go on the blue shelf and unfinished items on the yellow shelf.'})).status,201);
    const afterAnswer=await (await request('/overview',staff)).json();
    assert.equal(afterAnswer.attention.waiting.total,5);
    assert.ok(!afterAnswer.attention.waiting.items.some((item)=>item.assignmentId==='assignment-24'));
    assert.equal(afterAnswer.attention.total,9);

    db.prepare("UPDATE publications SET state='withdrawn' WHERE id='shelf-v3'").run();
    const withdrawn=await (await request('/overview',staff)).json();
    assert.equal(withdrawn.attention.waiting.total,0);
    assert.equal(withdrawn.attention.needsAttention.total,3);
    assert.equal(withdrawn.attention.delivery.total,1);
    assert.equal(withdrawn.attention.total,4);
  } finally {await new Promise((resolve)=>server.close(resolve));db.close();}
});
