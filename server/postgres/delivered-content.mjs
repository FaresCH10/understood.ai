// Publication content wins when present. Late delivery is immutable evidence
// for one exact assignment, never a publication-wide or cross-worker fallback.
export async function assignmentContent(client,assignment,snapshot) {
  const original=snapshot?.languages?.[assignment.language];
  if(original)return original;
  const row=(await client.query(`SELECT d.content_json FROM instruction_deliveries d
    JOIN instruction_sends s ON s.request_id=d.request_id AND s.org_id=d.org_id AND s.site_id=d.site_id
    JOIN assignments a ON a.id=d.assignment_id AND a.org_id=d.org_id AND a.site_id=d.site_id AND a.worker_id=d.worker_id
    WHERE d.assignment_id=$1 AND d.org_id=$2 AND d.site_id=$3 AND d.worker_id=$4
      AND d.language=$5 AND d.state='available' AND s.publication_id=a.publication_id AND a.publication_id=$6`,
  [assignment.id,assignment.org_id,assignment.site_id,assignment.worker_id,assignment.language,assignment.publication_id])).rows[0];
  return row?.content_json ?? null;
}
