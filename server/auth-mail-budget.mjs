export const AUTH_MAIL_QUEUE_LIMIT=1000;

// Both lazy SQLite queues share one ceiling; call inside the enqueue transaction.
export function authMailCapacity(db) {
  let pending=0;
  for(const table of ['staff_recovery_mail','staff_invitation_mail','registration_mail']) {
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
      pending+=db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE state IN ('queued','processing')`).get().n;
  }
  return pending<AUTH_MAIL_QUEUE_LIMIT;
}
