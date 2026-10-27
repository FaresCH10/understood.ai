import {translatedPresentationContent} from './presentation-input.mjs';

import {checkedPresentationChoices} from './presentation-choice-input.mjs';

// Viewing translations retain the original public choice IDs and cannot supply an answer key.
export async function translatePresentation(translator,kind,sourceLanguage,targetLanguage,original){
  if(translator?.capabilities?.textLanguages&&!translator.capabilities.textLanguages.includes(targetLanguage))throw Object.assign(Error('Presentation language unavailable'),{code:'translation_invalid'});
  const translated=await translator.translate({kind,sourceLanguage,targetLanguage,content:original});
  const validate=(...args)=>{try{return translatedPresentationContent(...args);}catch{throw Object.assign(Error('Invalid presentation translation'),{code:'translation_invalid'});}};
  const content=validate(kind,translated?.content,targetLanguage);
  if(kind==='instruction' && original.choices){
    let choices=content.choices;
    if(!choices){
      choices=[];
      for(const choice of original.choices){
        let text=content.text;
        if(choice.text!==original.text){
          const value=await translator.translate({kind:'instruction',sourceLanguage,targetLanguage,content:{title:original.title,text:choice.text,question:original.question}});
          text=validate('instruction',value?.content,targetLanguage).text;
        }
        choices.push({id:choice.id,text});
      }
    }
    try{content.questionType='multiple-choice';content.choices=checkedPresentationChoices(choices,original.choices);}catch{throw Object.assign(Error('Invalid presentation choices'),{code:'translation_invalid'});}
  }
  return {...translated,content};
}
