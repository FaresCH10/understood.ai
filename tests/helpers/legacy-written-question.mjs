import {domainTransaction} from '../../server/postgres/domain.mjs';
// Model an existing written-question publication. New customer drafts use MCQs;
// recordings, historical retries and operator tests must still cover older records.
export async function legacyWrittenQuestion(pool,briefingId,{schema='public'}={}){
  await domainTransaction(pool,schema,async client=>{
    const prepared=(await client.query('SELECT prepared_json FROM briefings WHERE id=$1',[briefingId])).rows[0]?.prepared_json;
    if(!prepared||prepared.artifactBundle)throw Error('Legacy fixture requires a prepared synthetic draft without provider artifacts');
    const {mode,correctChoiceId,...rubric}=prepared.rubric;
    const languages=Object.fromEntries(Object.entries(prepared.languages).map(([language,item])=>{const {choices,questionType,...content}=item;return [language,content];}));
    await client.query('UPDATE briefings SET prepared_json=$2 WHERE id=$1',[briefingId,JSON.stringify({...prepared,rubric,languages})]);
  });
}
