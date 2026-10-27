export function checkedPresentationChoices(choices,original=null){
  if(!Array.isArray(choices)||choices.length!==4||new Set(choices.map(choice=>choice?.id)).size!==4
    ||choices.some(choice=>!choice||Object.keys(choice).sort().join(',')!=='id,text'||typeof choice.id!=='string'||!/^[a-f0-9]{32}$/.test(choice.id)
      ||typeof choice.text!=='string'||!choice.text.trim()||choice.text.length>5000))throw Error('Invalid presentation choices');
  if(original && JSON.stringify(choices.map(choice=>choice.id).sort())!==JSON.stringify(original.map(choice=>choice.id).sort()))throw Error('Presentation choices changed');
  return choices.map(({id,text})=>({id,text}));
}

