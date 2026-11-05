export async function instructionModes(client,orgId,siteId,briefingId) {
  const row=(await client.query(`SELECT s.response_mode,s.delivery_mode,s.evidence_mode
    FROM briefings b LEFT JOIN instruction_sends s ON s.briefing_id=b.id AND s.org_id=b.org_id AND s.site_id=b.site_id
    WHERE b.id=$1 AND b.org_id=$2 AND b.site_id=$3`,[briefingId,orgId,siteId])).rows[0];
  const modes=row?.response_mode
    ? {responseMode:row.response_mode,deliveryMode:row.delivery_mode,evidenceMode:row.evidence_mode}
    : {responseMode:'question',deliveryMode:'both',evidenceMode:'none'};
  return modes;
}
