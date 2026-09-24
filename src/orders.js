import {createHash} from 'node:crypto';
export class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
export async function createOrder(db,userId,requestKey,items){
 const fingerprint=createHash('sha256').update(JSON.stringify(items)).digest('hex');
 return db.transaction(async tx=>{
  // Lock the buyer row: serializes duplicate checkout requests for this account.
  await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
  const old=(await tx.query('SELECT * FROM orders WHERE user_id=$1 AND request_key=$2',[userId,requestKey])).rows[0];
  if(old){if(old.fingerprint!==fingerprint)throw new HttpError(409,'Kunci checkout telah digunakan untuk pesanan lain.');return old;}
  const snapshots=[];
  for(const item of items){const p=(await tx.query('SELECT p.*,g.name AS game_name,g.server_required FROM products p JOIN games g ON g.id=p.game_id WHERE p.id=$1 AND p.active=true AND g.active=true FOR SHARE OF p,g',[item.productId])).rows[0];
   if(!p)throw new HttpError(400,'Produk tidak tersedia.');if(p.server_required&&!item.serverId)throw new HttpError(400,'Server ID wajib diisi.');snapshots.push({...p,targetId:item.targetId,serverId:item.serverId||''});}
  const subtotal=snapshots.reduce((sum,p)=>sum+p.price,0),fee=1000;
  const order=(await tx.query("INSERT INTO orders(user_id,request_key,fingerprint,subtotal,fee,total,expires_at) VALUES ($1,$2,$3,$4,$5,$6,now()+interval '30 minutes') RETURNING *",[userId,requestKey,fingerprint,subtotal,fee,subtotal+fee])).rows[0];
  for(const p of snapshots)await tx.query('INSERT INTO order_items(order_id,product_id,game_name,product_name,supplier_code,target_id,server_id,price,cost) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',[order.id,p.id,p.game_name,p.name,p.supplier_code,p.targetId,p.serverId,p.price,p.cost]);
  await tx.query('INSERT INTO order_events(order_id,message) VALUES ($1,$2)',[order.id,'Pesanan dibuat. Menunggu pembayaran simulasi.']);return order;
 });
}
export async function paySimulation(db,id,userId){return db.transaction(async tx=>{
 const o=(await tx.query('SELECT * FROM orders WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,userId])).rows[0];
 if(!o)throw new HttpError(404,'Pesanan tidak ditemukan.');if(o.payment_status==='paid')return o;
 if(o.payment_status!=='pending'||new Date(o.expires_at)<=new Date())throw new HttpError(409,'Pesanan sudah kedaluwarsa atau tidak dapat dibayar.');
 await tx.query("UPDATE orders SET payment_status='paid',fulfillment_status='queued' WHERE id=$1",[id]);
 await tx.query("UPDATE order_items SET status='queued' WHERE order_id=$1",[id]);
 await tx.query('INSERT INTO fulfillment_jobs(order_id) VALUES ($1) ON CONFLICT DO NOTHING',[id]);
 await tx.query('INSERT INTO order_events(order_id,message) VALUES ($1,$2)',[id,'Pembayaran simulasi diterima; pengiriman masuk antrean.']);return {...o,payment_status:'paid',fulfillment_status:'queued'};
});}
export async function processSimulation(db){return db.transaction(async tx=>{
 const job=(await tx.query("SELECT j.* FROM fulfillment_jobs j JOIN orders o ON o.id=j.order_id WHERE j.status='queued' AND o.payment_status='paid' ORDER BY j.created_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED")).rows[0];if(!job)return false;
 const order=(await tx.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[job.order_id])).rows[0];
 if(order.fulfillment_status==='success'){await tx.query("UPDATE fulfillment_jobs SET status='done' WHERE id=$1",[job.id]);return true;}
 const s=(await tx.query('SELECT * FROM supplier_settings WHERE id=1 FOR UPDATE')).rows[0];
 const cost=Number((await tx.query('SELECT SUM(cost) AS total FROM order_items WHERE order_id=$1',[order.id])).rows[0].total);
 if(!s||s.balance<cost){await tx.query("UPDATE orders SET fulfillment_status='held' WHERE id=$1",[order.id]);await tx.query("UPDATE fulfillment_jobs SET status='held' WHERE id=$1",[job.id]);await tx.query('INSERT INTO order_events(order_id,message) VALUES ($1,$2)',[order.id,'Saldo pemasok simulasi tidak mencukupi. Menunggu admin.']);return true;}
 await tx.query('UPDATE supplier_settings SET balance=balance-$1 WHERE id=1',[cost]);
 await tx.query('INSERT INTO supplier_ledger(order_id,amount,description) VALUES ($1,$2,$3)',[order.id,-cost,'Pembelian top up simulasi']);
 await tx.query("UPDATE order_items SET status='success' WHERE order_id=$1",[order.id]);
 await tx.query("UPDATE orders SET fulfillment_status='success' WHERE id=$1",[order.id]);
 await tx.query("UPDATE fulfillment_jobs SET status='done',attempts=attempts+1 WHERE id=$1",[job.id]);
 await tx.query('INSERT INTO order_events(order_id,message) VALUES ($1,$2)',[order.id,'Simulasi pengiriman berhasil. Tidak ada produk game sungguhan yang dikirim.']);return true;
});}
