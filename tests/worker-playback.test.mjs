import test from 'node:test';
import assert from 'node:assert/strict';
import {playbackSeconds,playbackTime,playbackSeek,workerPlaybackRates,workerPlaybackText} from '../src/worker-playback.ts';
import {assertWorkerDictionary} from './helpers/worker-locales.mjs';

test('playback duration and time never expose invalid or negative media metadata',()=>{
  for(const value of [NaN,Infinity,-Infinity,-1]){assert.equal(playbackSeconds(value),0);assert.equal(playbackTime(value),'0:00');}
  assert.equal(playbackTime(72.9),'1:12');assert.equal(playbackTime(3600),'60:00');assert.equal(playbackSeconds(0.25),0.25);
});
test('seeking uses actual finite media ranges rather than assuming all duration is seekable',()=>{
  assert.equal(playbackSeek(10,72,[]),null);assert.equal(playbackSeek(NaN,72,[{start:0,end:72}]),null);
  assert.equal(playbackSeek(10,Infinity,[{start:0,end:72}]),null);
  assert.equal(playbackSeek(-1,72,[{start:0,end:72}]),0);assert.equal(playbackSeek(99,72,[{start:0,end:72}]),72);
  assert.equal(playbackSeek(10,72,[{start:0,end:20}]),10);assert.equal(playbackSeek(29,72,[{start:0,end:20},{start:40,end:72}]),20);
  assert.equal(playbackSeek(35,72,[{start:0,end:20},{start:40,end:72}]),40);
  assert.equal(playbackSeek(0,72,[{start:-1,end:10},{start:10,end:1},{start:NaN,end:20}]),null);
});
test('playback controls, errors and accessible labels cover every enabled worker UI language',()=>{
  assertWorkerDictionary(workerPlaybackText,'workerPlaybackText');
  assert.deepEqual(workerPlaybackRates,[0.75,1,1.25,1.5,2]);
});
