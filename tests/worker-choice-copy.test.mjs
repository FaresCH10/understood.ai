import test from 'node:test';
import assert from 'node:assert/strict';
import {workerChoicePrompt,workerChoiceAnswerLabel} from '../src/worker-choice-text.ts';
import {WORKER_LANGUAGE_CODES} from '../server/languages.mjs';
test('multiple-choice prompts are localized for every selectable worker UI locale',()=>{for(const code of WORKER_LANGUAGE_CODES){assert.ok(workerChoicePrompt[code]?.trim().length>3);assert.ok(workerChoiceAnswerLabel[code]?.trim().length>3);}});
