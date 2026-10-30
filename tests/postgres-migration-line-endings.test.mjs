import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations,verifyMigrations} from '../server/postgres/migrate.mjs';

test('migration verification accepts legacy Windows checksums on Linux but rejects SQL edits',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'understood-migrations-'));
  const db=new PGlite();
  const pool={async connect(){return {release(){},async query(sql,values){return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)||{rows:[]};}};}};
  const options={schema:'migration_fixture',directory},file=join(directory,'001_initial.sql');
  const sql='CREATE TABLE sample (id integer PRIMARY KEY);\n-- Original migration\n';
  const hash=value=>createHash('sha256').update(value).digest('hex');
  try{
    await db.exec('CREATE SCHEMA migration_fixture');
    await writeFile(file,sql.replace(/\n/g,'\r\n'));
    await runMigrations(pool,options);
    assert.equal((await db.query('SELECT checksum FROM migration_fixture.schema_migrations')).rows[0].checksum,hash(sql));
    await db.query('UPDATE migration_fixture.schema_migrations SET checksum=$1',[hash(sql.replace(/\n/g,'\r\n'))]);
    await writeFile(file,sql);
    assert.equal((await verifyMigrations(pool,options)).migrations,1);
    assert.deepEqual(await runMigrations(pool,options),[]);
    await writeFile(file,sql+'ALTER TABLE sample ADD COLUMN changed text;\n');
    await assert.rejects(verifyMigrations(pool,options),/migration verification failed/);
    await assert.rejects(runMigrations(pool,options),/Migration checksum mismatch/);
  }finally{await db.close();await rm(directory,{recursive:true,force:true});}
});
