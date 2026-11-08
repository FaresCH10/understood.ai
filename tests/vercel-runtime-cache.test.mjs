import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {guardPostgresPool} from '../server/postgres/db.mjs';
import {runtimeCache} from '../server/vercel-runtime-cache.mjs';
test('warm runtime retires a failed pool and concurrent next requests share one replacement',async()=>{
 let creates=0,closed=0,handled=0;
 const cached=runtimeCache(async()=>{creates++;const pool=guardPostgresPool(new EventEmitter());pool.end=async()=>{closed++;};return {pool,handler:()=>{handled++;}};});
 const first=await cached();first.handler();first.pool.emit('error',Error('idle socket ended'));
 const [second,third]=await Promise.all([cached(),cached()]);
 assert.notEqual(first,second);assert.equal(second,third);assert.equal(creates,2);assert.equal(handled,1);
 await Promise.resolve();assert.equal(closed,1);assert.equal(await cached(),second);
});
test('failed initialization is retried on a later request',async()=>{
 let count=0;const cached=runtimeCache(async()=>{if(++count===1)throw Error('unavailable');return {handler(){}};});
 await assert.rejects(cached(),/unavailable/);assert.ok(await cached());assert.equal(count,2);
});
