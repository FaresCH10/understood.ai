import type {KeyboardEvent} from 'react';

export function chatEnterToSend(event:KeyboardEvent<HTMLTextAreaElement>){
  if(event.key!=='Enter'||event.shiftKey||event.nativeEvent.isComposing)return;
  if(!window.matchMedia('(pointer:fine)').matches)return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

export function resizeChatComposer(element:HTMLTextAreaElement|null){
  if(!element)return;
  element.style.height='auto';
  element.style.height=`${Math.min(element.scrollHeight,120)}px`;
}
