import pg from 'pg';
export async function database({ local = process.env.LOCAL_DEMO === 'true', url = process.env.DATABASE_URL, memory = false } = {}) {
  if (local) {
    if (process.env.NODE_ENV === 'production') throw new Error('LOCAL_DEMO is forbidden in production');
    const { PGlite } = await import('@electric-sql/pglite');
    const client = new PGlite(memory ? undefined : './.local-db');
    let queue = Promise.resolve();
    const serialized = fn => { const next = queue.then(fn); queue = next.catch(()=>{}); return next; };
    return { query: (text, values=[])=>serialized(()=>client.query(text,values)), transaction: fn=>serialized(()=>client.transaction(tx=>fn(tx))), close: ()=>client.close(), local:true };
  }
  if (!url) throw new Error('DATABASE_URL belum diatur. Isi koneksi Neon atau gunakan npm run demo.');
  const pool = new pg.Pool({connectionString:url,max:10,connectionTimeoutMillis:10000});
  return { query:(text,values=[])=>pool.query(text,values), transaction:async fn=>{const c=await pool.connect();try{await c.query('BEGIN');const v=await fn(c);await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}},close:()=>pool.end(),local:false };
}
