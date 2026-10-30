import {Pool} from 'pg';
import {attachDatabasePool} from '@neon/functions';

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000});
attachDatabasePool(pool);

// Public readiness only: never return connection strings, identities, or tenant data.
export default async function hello(request:Request):Promise<Response> {
  if(request.method!=='GET')return new Response('Method not allowed',{status:405,headers:{Allow:'GET'}});
  try{
    await pool.query('SELECT 1');
    return Response.json({app:'understood',service:'neon-functions',postgres:'connected'},
      {headers:{'cache-control':'no-store'}});
  }catch{return Response.json({app:'understood',status:'unavailable'},{status:503});}
}
