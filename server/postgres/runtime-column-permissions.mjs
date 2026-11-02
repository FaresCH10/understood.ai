export async function inspectRuntimeUpdateColumns(client,{schema,role,table,updates,deletes=false}) {
  const state=(await client.query(`WITH target AS (
    SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$2 AND c.relname=$3 AND c.relkind IN ('r','p'))
    SELECT (SELECT count(*) FROM target)=1
      AND NOT EXISTS(SELECT 1 FROM unnest($4::text[]) col(name) WHERE NOT EXISTS(
        SELECT 1 FROM target c JOIN pg_attribute a ON a.attrelid=c.oid
        WHERE a.attnum>0 AND NOT a.attisdropped AND a.attname=col.name))
      AND NOT EXISTS(SELECT 1 FROM target c WHERE
        NOT has_table_privilege($1,c.oid,'SELECT') OR has_table_privilege($1,c.oid,'SELECT WITH GRANT OPTION')
        OR EXISTS(SELECT 1 FROM unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) v(privilege)
          WHERE has_table_privilege($1,c.oid,v.privilege) AND NOT ($5::boolean AND v.privilege='DELETE'))
        OR has_table_privilege($1,c.oid,'DELETE WITH GRANT OPTION')
        OR EXISTS(SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee=0)
        OR EXISTS(SELECT 1 FROM pg_attribute a CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) v(privilege)
          WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND (
            has_column_privilege($1,c.oid,a.attnum,v.privilege) IS DISTINCT FROM
              (v.privilege='SELECT' OR v.privilege='UPDATE' AND a.attname=ANY($4::text[]))
            OR has_column_privilege($1,c.oid,a.attnum,v.privilege||' WITH GRANT OPTION')
            OR EXISTS(SELECT 1 FROM aclexplode(a.attacl) x WHERE x.grantee=0)))) AS valid`,[role,schema,table,updates,deletes])).rows[0];
  if(!state?.valid)throw Error('Runtime table or column privileges do not match update policy');
}
