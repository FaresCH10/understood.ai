export async function instructionModes(client,orgId,siteId,briefingId) {
  const row=(await client.query('SELECT response_mode,delivery_mode FROM instruction_sends WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3',
    [briefingId,orgId,siteId])).rows[0];
  return row ? {responseMode:row.response_mode,deliveryMode:row.delivery_mode} : {responseMode:'question',deliveryMode:'both'};
}
