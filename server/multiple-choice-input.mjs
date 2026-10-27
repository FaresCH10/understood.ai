export function validateMultipleChoice(value){
  if(value?.rubric?.mode!=='multiple-choice')return false;
  return Object.values(value.languages || {}).every(item=>item?.questionType==='multiple-choice'
    && Array.isArray(item.choices) && item.choices.length===4 && new Set(item.choices.map(choice=>choice.id)).size===4
    && item.choices.every(choice=>typeof choice.id==='string' && /^[a-f0-9]{32}$/.test(choice.id)
      && typeof choice.text==='string' && choice.text.trim() && choice.text.length<=5000)
    && item.choices.some(choice=>choice.id===value.rubric.correctChoiceId));
}
