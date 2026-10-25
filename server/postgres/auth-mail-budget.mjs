import {AUTH_MAIL_QUEUE_LIMIT} from '../auth-mail-budget.mjs';

// All enqueues hold this lock until their insert commits. Workers only release capacity.
export async function authMailCapacity(client) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['understood:auth-mail-queue:v1']);
  const row=(await client.query(`SELECT (SELECT COUNT(*) FROM staff_recovery_mail WHERE state IN ('queued','processing'))+
    (SELECT COUNT(*) FROM staff_invitation_mail WHERE state IN ('queued','processing'))+
    (SELECT COUNT(*) FROM registration_mail WHERE state IN ('queued','processing')) AS n`)).rows[0];
  return Number(row.n)<AUTH_MAIL_QUEUE_LIMIT;
}
