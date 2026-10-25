import { openDatabase, NOW, transaction } from './db.mjs';
import { CANONICAL_SOURCE, syntheticPrepare } from './domain.mjs';
import { ensureBriefingSchema } from './preparation.mjs';

export function seed(db) {
  ensureBriefingSchema(db);
  if (db.prepare('SELECT 1 FROM organizations LIMIT 1').get()) return false;
  transaction(db, () => {
    db.prepare('INSERT INTO organizations VALUES (?,?)').run('cedar', 'Cedar Works');
    db.prepare('INSERT INTO organizations VALUES (?,?)').run('harbor', 'Harbor Tools');
    db.prepare('INSERT INTO sites VALUES (?,?,?,?)').run('beirut', 'cedar', 'Beirut site', 'Asia/Beirut');
    db.prepare('INSERT INTO sites VALUES (?,?,?,?)').run('harbor-yard', 'harbor', 'Harbor yard', 'UTC');
    db.prepare('INSERT INTO staff VALUES (?,?,?,?,?,?)').run('maya', 'cedar', 'beirut', 'Maya Haddad', 'owner', 1);
    db.prepare('INSERT INTO staff VALUES (?,?,?,?,?,?)').run('harbor-owner', 'harbor', 'harbor-yard', 'Harbor Owner', 'owner', 1);
    const addWorker = db.prepare('INSERT INTO workers (id,org_id,site_id,code,name,language,active) VALUES (?,?,?,?,?,?,?)');
    const workerNames = ['Rana Khoury', 'Omar Nassar', 'Lina Haddad', 'Yusuf Karim', 'Mariam Saleh', 'Tariq Aziz'];
    for (let n = 1; n <= 30; n++) {
      const code = `Worker ${String(n).padStart(3, '0')}`;
      const language = n <= 12 ? 'en' : n <= 22 ? 'ar' : 'ur';
      addWorker.run(`worker-${n}`, 'cedar', 'beirut', code, workerNames[(n - 1) % workerNames.length], language, 1);
    }
    addWorker.run('harbor-worker', 'harbor', 'harbor-yard', 'Worker 014', 'Harbor Worker', 'en', 1);
    const prepared = syntheticPrepare(CANONICAL_SOURCE);
    const now = NOW();
    db.prepare('INSERT INTO briefings VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('shelf', 'cedar', 'beirut', prepared.title, CANONICAL_SOURCE, 1, 4, 'draft', null, now, now);
    db.prepare('INSERT INTO publications VALUES (?,?,?,?,?,?,?,?)').run('shelf-v3', 'cedar', 'beirut', 'shelf', 3, JSON.stringify(prepared), now, 'published');
    db.prepare('INSERT INTO briefings VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('harbor-brief', 'harbor', 'harbor-yard', 'Harbor notice', 'Use the east gate.', 1, 1, 'draft', null, now, now);
    const addAssignment = db.prepare('INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,due_at,created_at,language) VALUES (?,?,?,?,?,?,?,?)');
    for (let n = 1; n <= 30; n++) addAssignment.run(`assignment-${n}`, 'cedar', 'beirut', 'shelf-v3', `worker-${n}`, null, now, n <= 12 ? 'en' : n <= 22 ? 'ar' : 'ur');
    const responding = [...Array.from({ length: 23 }, (_, i) => i + 1), 28];
    const addAttempt = db.prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?,?,?)');
    const addClarification = db.prepare('INSERT INTO clarifications VALUES (?,?,?,?,?,?,?,?,?)');
    for (const n of responding) {
      const outcome = [14, 21, 28].includes(n) ? 'clarification' : 'matched';
      const answer = n === 14 ? 'Finished items go on the blue shelf.'
        : n === 21 ? 'I am not sure which shelf.'
        : n === 28 ? 'Please help with the second shelf.'
        : 'Finished items go on the blue shelf and unfinished items on the yellow shelf.';
      addAttempt.run(`attempt-${n}`, 'cedar', `assignment-${n}`, `seed-${n}`, answer, outcome,
        JSON.stringify(outcome === 'matched' ? ['asked_facts_present'] : ['missing_asked_fact']), now);
      if (outcome === 'clarification') addClarification.run(`clarification-${n}`, 'cedar', `assignment-${n}`, `attempt-${n}`,
        n === 21 ? 'Unclear audio' : n === 28 ? 'Help requested' : 'Missing fact', 'maya', 'open', '', now);
    }
  });
  return true;
}

if (process.argv[1]?.endsWith('seed.mjs')) {
  const db = openDatabase();
  console.log(seed(db) ? 'Synthetic demo seeded.' : 'Existing data preserved.');
  db.close();
}
