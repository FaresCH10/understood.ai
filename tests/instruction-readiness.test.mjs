import test from 'node:test';
import assert from 'node:assert/strict';
import {CANONICAL_SOURCE} from '../server/domain.mjs';
import {instructionReadiness} from '../server/instruction-readiness.mjs';
import {syntheticInstructionPrepare} from '../server/instruction-prep.mjs';
test('readiness never advertises arbitrary synthetic translations or generated speech',()=>{
 assert.deepEqual(instructionReadiness({},'Put the blue folder on the desk.'),{mode:'synthetic',textLanguages:['en'],speechLanguages:[]});
 assert.deepEqual(instructionReadiness({},CANONICAL_SOURCE).textLanguages,['en','ar','ur']);
 assert.deepEqual(instructionReadiness({integrationMode:'live',preparationAdapter:{capabilities:{textLanguages:['en','hi'],speechLanguages:['en']}}},'Instruction').textLanguages,['en','hi']);
 assert.deepEqual(instructionReadiness({},'ضع الملف على المكتب').textLanguages,[]);
 assert.throws(()=>instructionReadiness({},null),/Invalid instruction/);
});
test('synthetic question choices vary the same fact that the question asks about',()=>{
 const source='This is a test instruction. Put finished items on the blue shelf. Put unfinished items on the yellow shelf. Keep the walkway clear.';
 const result=syntheticInstructionPrepare({title:'Shelf check',source},{response_mode:'question'});
 assert.notEqual(result.question,'What must you keep clear?');
 assert.equal(result.languages.en.choices.length,4);
 assert.match(result.question,/Where must you put finished items/);
 assert.equal(result.languages.en.choices.find(choice=>choice.id===result.rubric.correctChoiceId).text,'on the blue shelf');
 assert.ok(result.languages.en.choices.every(choice=>!choice.text.includes('Keep the walkway')));
 assert.equal(syntheticInstructionPrepare({title:'Shelf check',source:CANONICAL_SOURCE},{response_mode:'question'}).question,'Where will you put finished and unfinished items?');
});
