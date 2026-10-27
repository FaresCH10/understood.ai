const key=value=>value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]+/gu,' ').trim();
export function questionChoices(value){
  if(!Array.isArray(value)||value.length!==4||value.some(text=>typeof text!=='string'||!text.trim()||text.length>1000)
    ||new Set(value.map(key)).size!==4)throw Error('Invalid instruction answer choices');
  return value.map(text=>text.trim());
}
export const choiceSchema={type:'array',minItems:4,maxItems:4,items:{type:'string',minLength:1,maxLength:1000}};
export const choicePreparationPrompt='Ask one concrete question about the actual locations, numbers, timing, conditions or actions in the asked facts, never a generic question about following instructions or a question based only on the title. Return choices as exactly four short plausible answers in order: the first is the only correct answer, and each other answer changes a specific asked fact (for example swapping two locations or changing a stated quantity). Wrong answers must contradict the source; do not invent equally valid alternatives. Do not use generic distractors about ignoring, skipping, replacing, or doing the opposite of the instruction. Keep options similar in length and style. Do not label them or disclose the answer in the question.';
export const choiceGroundingPrompt='Also independently assess all four choices against the source and askedFacts. choicesAligned is true only when exactly the first answer is correct, each of the other three contradicts at least one asked fact, every option answers the question, and the question tests specific source facts rather than merely asking whether to follow instructions. Incorrect, ambiguous, generic or duplicate options must set choicesAligned=false.';
