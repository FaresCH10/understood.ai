export async function assignmentEvidence(client,orgId,siteId,assignmentId) {
  const row=(await client.query(`SELECT request_id AS "requestId",mime,bytes,sha256,received_at AS "receivedAt"
    FROM assignment_evidence WHERE assignment_id=$1 AND org_id=$2 AND site_id=$3`,
  [assignmentId,orgId,siteId])).rows[0];
  return row ? {...row,receivedAt:row.receivedAt instanceof Date?row.receivedAt.toISOString():row.receivedAt} : null;
}

export async function assignmentEvidenceData(client,orgId,siteId,assignmentId) {
  return (await client.query(`SELECT mime,data_base64 AS "dataBase64",received_at AS "receivedAt"
    FROM assignment_evidence WHERE assignment_id=$1 AND org_id=$2 AND site_id=$3`,
  [assignmentId,orgId,siteId])).rows[0] || null;
}
