import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {GEMINI_MODELS} from '../server/ai/gemini.mjs';
import {bundleHash} from '../server/ai/prepared-bundle.mjs';

const API='https://generativelanguage.googleapis.com';
const bytesHash=bytes=>createHash('sha256').update(bytes).digest('hex');
const reply=value=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]});

// This transport never delegates to fetch. Unknown, reordered or changed inputs fail.
export function scriptedProvider() {
  const queue=[],trace=[],spoken=new Map();let fileSequence=0;
  const add=(stage,verify,response)=>queue.push({stage,verify,response});
  return {
    structured(stage,input,result,schemaKey) {
      const expected=structuredClone(input),output=structuredClone(result);
      add(stage,(url,options)=>{
        assert.equal(url,`${API}/v1beta/models/${GEMINI_MODELS.text}:generateContent`);
        assert.equal(options.method,'POST');const body=JSON.parse(options.body);
        assert.deepEqual(JSON.parse(body.contents[0].parts[0].text),expected);
        assert.ok(body.generationConfig.responseFormat.text.schema.properties[schemaKey]);
        assert.equal(body.generationConfig.responseFormat.text.mimeType,'APPLICATION_JSON');assert.equal(body.store,false);
        assert.equal(typeof body.systemInstruction.parts[0].text,'string');
        return {inputHash:bundleHash(expected),model:GEMINI_MODELS.text};
      },()=>reply(output));
    },
    speech(stage,text,bytes) {
      const output=Buffer.from(bytes);
      add(stage,(url,options)=>{
        assert.equal(url,`${API}/v1beta/interactions`);
        assert.equal(options.method,'POST');const body=JSON.parse(options.body);
        assert.deepEqual(body,{model:GEMINI_MODELS.speech,store:false,input:[{type:'user_input',content:[{type:'text',text}]}],
          response_format:{type:'audio',mime_type:'audio/wav',sample_rate:16000},generation_config:{speech_config:[{voice:'Kore'}]}});
        return {inputHash:bundleHash(text),model:GEMINI_MODELS.speech};
      },()=>Response.json({status:'completed',model:GEMINI_MODELS.speech,steps:[{type:'model_output',content:[{type:'audio',mime_type:'audio/wav',data:output.toString('base64')}]}]}));
    },
    // Question speech legitimately embeds a randomly shuffled four-choice set;
    // verify the set and numbering without assuming the shuffle order.
    speechQuestion(stage,question,choices,bytes) {
      const output=Buffer.from(bytes),expected=choices.map(choice=>choice.trim()).sort();
      add(stage,(url,options)=>{
        assert.equal(url,`${API}/v1beta/interactions`);
        assert.equal(options.method,'POST');const body=JSON.parse(options.body),text=body.input?.[0]?.content?.[0]?.text;
        assert.equal(typeof text,'string');
        const [first,...lines]=text.split('\n');
        assert.equal(first,question);
        assert.equal(lines.length,4);
        const offered=lines.map((line,index)=>{
          const match=/^([1-4])\. (.+)$/.exec(line);
          assert.ok(match,`Choice ${index+1} is not a numbered option`);
          assert.equal(Number(match[1]),index+1);
          return match[2];
        });
        assert.equal(new Set(offered).size,4);
        assert.deepEqual([...offered].sort(),expected);
        const {input,...rest}=body;
        assert.deepEqual(rest,{model:GEMINI_MODELS.speech,store:false,
          response_format:{type:'audio',mime_type:'audio/wav',sample_rate:16000},generation_config:{speech_config:[{voice:'Kore'}]}});
        assert.deepEqual(input,[{type:'user_input',content:[{type:'text',text}]}]);
        spoken.set(stage,text);
        return {inputHash:bundleHash(text),model:GEMINI_MODELS.speech};
      },()=>Response.json({status:'completed',model:GEMINI_MODELS.speech,steps:[{type:'model_output',content:[{type:'audio',mime_type:'audio/wav',data:output.toString('base64')}]}]}));
    },
    speechText(stage) {
      if(!spoken.has(stage))throw Error(`No verified speech text for ${stage}`);
      return spoken.get(stage);
    },
    transcription(stage,bytes,text) {
      const expected=Buffer.from(bytes),name=`files/synthetic-${++fileSequence}`,uri=`${API}/v1beta/${name}`,upload=`${API}/upload/synthetic-${fileSequence}`;
      add(`${stage}.start`,(url,options)=>{
        assert.equal(url,`${API}/upload/v1beta/files`);assert.equal(options.method,'POST');
        assert.equal(options.headers['x-goog-upload-header-content-length'],String(expected.length));
        assert.equal(options.headers['x-goog-upload-header-content-type'],'audio/wav');
        assert.deepEqual(JSON.parse(options.body),{file:{display_name:'worker-answer'}});
        return {inputHash:bytesHash(expected),model:GEMINI_MODELS.transcription};
      },()=>new Response('',{headers:{'x-goog-upload-url':upload}}));
      add(`${stage}.upload`,(url,options)=>{
        assert.equal(url,upload);assert.equal(options.method,'POST');assert.deepEqual(Buffer.from(options.body),expected);
        assert.equal(options.headers['x-goog-upload-command'],'upload, finalize');
        return {inputHash:bytesHash(expected),model:GEMINI_MODELS.transcription};
      },()=>Response.json({file:{name,uri}}));
      add(`${stage}.transcribe`,(url,options)=>{
        assert.equal(url,`${API}/v1beta/interactions`);assert.equal(options.method,'POST');
        assert.deepEqual(JSON.parse(options.body),{model:GEMINI_MODELS.transcription,store:false,
          input:[{type:'audio',uri,mime_type:'audio/wav'}],generation_config:{transcription_config:{mode:{type:'verbatim'}}}});
        return {inputHash:bytesHash(expected),model:GEMINI_MODELS.transcription};
      },()=>Response.json({status:'completed',model:GEMINI_MODELS.transcription,steps:[{type:'model_output',content:[{type:'text',text}]}]}));
      add(`${stage}.cleanup`,(url,options)=>{
        assert.equal(url,uri);assert.equal(options.method,'DELETE');
        return {inputHash:bundleHash(name),model:GEMINI_MODELS.transcription};
      },()=>new Response(null,{status:204}));
    },
    async fetchImpl(url,options) {
      const expected=queue.shift();if(!expected)throw Error('Unexpected scripted provider request');
      const evidence=expected.verify(url,options);
      trace.push({sequence:trace.length+1,stage:expected.stage,...evidence});return expected.response();
    },
    finish(){assert.equal(queue.length,0,'Scripted provider stages were not all executed');return structuredClone(trace);},
    get requestCount(){return trace.length;},
  };
}
