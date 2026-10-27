import type {WorkerUiLanguage} from './worker-ui-language';

export const workerChoicePrompt:Record<WorkerUiLanguage,string>={
  en:'Select one answer',ar:'اختر إجابة واحدة',ur:'ایک جواب منتخب کریں',
  hi:'एक उत्तर चुनें',bn:'একটি উত্তর বেছে নিন',ml:'ഒരു ഉത്തരം തിരഞ്ഞെടുക്കുക',
  ta:'ஒரு பதிலைத் தேர்ந்தெடுக்கவும்',te:'ఒక సమాధానాన్ని ఎంచుకోండి',ne:'एउटा उत्तर छान्नुहोस्',
  fil:'Pumili ng isang sagot',si:'එක් පිළිතුරක් තෝරන්න',ru:'Выберите один ответ',
  'pa-Guru':'ਇੱਕ ਜਵਾਬ ਚੁਣੋ','pa-Arab':'اک جواب چنو',id:'Pilih satu jawaban',
};

export const workerChoiceAnswerLabel:Record<WorkerUiLanguage,string>={
  en:'Selected answer',ar:'الإجابة المختارة',ur:'منتخب جواب',hi:'चुना गया उत्तर',bn:'বেছে নেওয়া উত্তর',
  ml:'തിരഞ്ഞെടുത്ത ഉത്തരം',ta:'தேர்ந்தெடுத்த பதில்',te:'ఎంచుకున్న సమాధానం',ne:'छानिएको उत्तर',
  fil:'Napiling sagot',si:'තෝරාගත් පිළිතුර',ru:'Выбранный ответ','pa-Guru':'ਚੁਣਿਆ ਜਵਾਬ','pa-Arab':'چنیا جواب',id:'Jawaban yang dipilih',
};
