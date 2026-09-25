import express from 'express';
import helmet from 'helmet';
import {rateLimit} from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {fileURLToPath} from 'node:url';
import {createOrder,paySimulation,processSimulation,HttpError} from './orders.js';
const hash=s=>createHash('sha256').update(s).digest('hex');
const idSchema=z.string().uuid();
const safeText=z.string().trim().min(1).max(80);
const orderSchema=z.object({items:z.array(z.object({productId:idSchema,targetId:z.string().trim().min(3).max(80).regex(/^[a-zA-Z0-9#_. -]+$/),serverId:z.string().trim().max(30).regex(/^[a-zA-Z0-9 _-]*$/).default('')})).min(1).max(10)});
const credentials=z.object({email:z.email().max(254).transform(s=>s.toLowerCase()),password:z.string().min(12).max(72)});
const publicUser=u=>({id:u.id,name:u.name,email:u.email,role:u.role});
export function createApp(db,{origin=process.env.APP_ORIGIN||'http://localhost:3000',simulation=process.env.PAYMENT_MODE!=='production',production=process.env.NODE_ENV==='production',inlineSimulation=false}={}){
 const app=express(); app.disable('x-powered-by'); if(process.env.VERCEL)app.set('trust proxy',1);
 if(production&&!origin.startsWith('https://'))throw new Error('Production requires HTTPS APP_ORIGIN');
 app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'","data:"],connectSrc:["'self'"],upgradeInsecureRequests:production?[]:null}},strictTransportSecurity:production?undefined:false}));
 app.use(express.json({limit:'32kb'}));
 app.use('/api',rateLimit({windowMs:60000,limit:120,standardHeaders:'draft-8',legacyHeaders:false}));
 const authLimit=rateLimit({windowMs:15*60000,limit:20,standardHeaders:'draft-8',legacyHeaders:false});
 app.use('/api',async(req,res,next)=>{
  res.set('Cache-Control','no-store');
  const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('mt_session='))?.slice(11);
  if(token&&/^[a-f0-9]{64}$/.test(token)){const row=(await db.query('SELECT u.*,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=$1 AND s.expires_at>now()',[hash(token)])).rows[0];if(row){req.user=publicUser(row);req.csrf=row.csrf;req.sessionHash=hash(token);}}
  next();
 });
 app.use('/api',(req,res,next)=>{
  if(['GET','HEAD','OPTIONS'].includes(req.method))return next();
  if(req.get('origin')!==origin)return next(new HttpError(403,'Asal permintaan tidak diizinkan.'));
  if(req.user){const incoming=req.get('x-csrf-token')||'';if(incoming.length!==req.csrf.length||!timingSafeEqual(Buffer.from(incoming),Buffer.from(req.csrf)))return next(new HttpError(403,'Token keamanan tidak valid. Muat ulang halaman.'));}
  next();
 });
 const auth=(req,res,next)=>req.user?next():next(new HttpError(401,'Silakan masuk terlebih dahulu.'));
 const admin=(req,res,next)=>req.user?.role==='admin'?next():next(new HttpError(403,'Akses admin diperlukan.'));
 const event=async(tx,orderId,message)=>tx.query('INSERT INTO order_events(order_id,message) VALUES ($1,$2)',[orderId,message]);
 const log=async(tx,req,action,detail)=>tx.query('INSERT INTO audit_logs(actor_id,action,detail) VALUES ($1,$2,$3)',[req.user.id,action,JSON.stringify(detail)]);
 async function session(req,res,user){if(req.sessionHash)await db.query('DELETE FROM sessions WHERE hash=$1',[req.sessionHash]);const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');await db.query("INSERT INTO sessions(hash,user_id,csrf,expires_at) VALUES ($1,$2,$3,now()+interval '7 days')",[hash(token),user.id,csrf]);res.cookie('mt_session',token,{httpOnly:true,secure:production,sameSite:'lax',maxAge:7*86400000,path:'/'});return {user:publicUser(user),csrf};}
 app.get('/api/health',async(req,res)=>{await db.query('SELECT 1');res.json({ok:true,database:db.local?'local-development':'postgresql',mode:simulation?'simulation':'production'});});
 app.get('/api/session',(req,res)=>res.json({user:req.user||null,csrf:req.csrf||null,mode:simulation?'simulation':'production',database:db.local?'local-development':'neon'}));
 app.post('/api/auth/register',authLimit,async(req,res)=>{const data=credentials.extend({name:safeText}).parse(req.body);const passwordHash=await bcrypt.hash(data.password,12);let user;try{user=(await db.query('INSERT INTO users(name,email,password_hash) VALUES ($1,$2,$3) RETURNING *',[data.name,data.email,passwordHash])).rows[0];}catch(e){if(e.code==='23505')throw new HttpError(409,'Email sudah terdaftar.');throw e;}res.status(201).json(await session(req,res,user));});
 const dummy=bcrypt.hashSync(randomBytes(20).toString('hex'),12);
 app.post('/api/auth/login',authLimit,async(req,res)=>{const data=credentials.parse(req.body);const user=(await db.query('SELECT * FROM users WHERE email=$1',[data.email])).rows[0];const ok=await bcrypt.compare(data.password,user?.password_hash||dummy);if(!user||!ok)throw new HttpError(401,'Email atau kata sandi salah.');res.json(await session(req,res,user));});
 app.post('/api/auth/logout',auth,async(req,res)=>{await db.query('DELETE FROM sessions WHERE hash=$1',[req.sessionHash]);res.clearCookie('mt_session',{path:'/',httpOnly:true,secure:production,sameSite:'lax'}).json({ok:true});});
 app.patch('/api/profile',auth,async(req,res)=>{const {name}=z.object({name:safeText}).parse(req.body);await db.query('UPDATE users SET name=$1 WHERE id=$2',[name,req.user.id]);res.json({ok:true});});
 app.get('/api/catalog',async(req,res)=>res.json({games:(await db.query('SELECT * FROM games WHERE active=true ORDER BY name')).rows,products:(await db.query('SELECT id,game_id,name,price FROM products WHERE active=true ORDER BY price')).rows}));
 app.get('/api/articles',async(req,res)=>res.json((await db.query('SELECT id,title,category,body,created_at FROM articles WHERE published=true ORDER BY created_at DESC')).rows));
 app.post('/api/orders',auth,async(req,res)=>{if(!simulation)throw new HttpError(503,'Checkout produksi belum diaktifkan.');const data=orderSchema.parse(req.body);const key=z.string().min(16).max(100).regex(/^[\w-]+$/).parse(req.get('idempotency-key'));res.status(201).json(await createOrder(db,req.user.id,key,data.items));});
 app.get('/api/orders',auth,async(req,res)=>res.json((await db.query("SELECT *,CASE WHEN payment_status='pending' AND expires_at<now() THEN 'expired' ELSE payment_status END AS payment_status FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",[req.user.id])).rows));
 async function detail(id,owner){const o=(await db.query("SELECT *,CASE WHEN payment_status='pending' AND expires_at<now() THEN 'expired' ELSE payment_status END AS payment_status FROM orders WHERE id=$1"+(owner?' AND user_id=$2':''),owner?[id,owner]:[id])).rows[0];if(!o)throw new HttpError(404,'Pesanan tidak ditemukan.');const items=(await db.query('SELECT * FROM order_items WHERE order_id=$1',[id])).rows;if(owner)items.forEach(i=>{delete i.cost;delete i.supplier_code;delete i.provider_reference;});return {...o,items,events:(await db.query('SELECT message,created_at FROM order_events WHERE order_id=$1 ORDER BY created_at',[id])).rows};}
 app.get('/api/orders/:id',auth,async(req,res)=>res.json(await detail(idSchema.parse(req.params.id),req.user.id)));
 app.post('/api/orders/:id/simulate-payment',auth,async(req,res)=>{if(!simulation)throw new HttpError(404,'Tidak ditemukan.');const id=idSchema.parse(req.params.id);await paySimulation(db,id,req.user.id);if(inlineSimulation)await processSimulation(db,id);res.json(await detail(id,req.user.id));});
 app.use('/api/admin',auth,admin);
 app.get('/api/admin/dashboard',async(req,res)=>res.json({summary:(await db.query("SELECT COUNT(*)::int AS orders,COUNT(*) FILTER(WHERE fulfillment_status='success')::int AS success,COUNT(*) FILTER(WHERE fulfillment_status IN ('held','failed','unknown'))::int AS attention,COALESCE(SUM(total) FILTER(WHERE payment_status='paid'),0)::int AS received FROM orders")).rows[0],supplier:(await db.query('SELECT * FROM supplier_settings WHERE id=1')).rows[0]}));
 app.get('/api/admin/orders',async(req,res)=>res.json((await db.query('SELECT o.*,u.name AS customer FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 200')).rows));
 app.get('/api/admin/orders/:id',async(req,res)=>res.json(await detail(idSchema.parse(req.params.id))));
 app.post('/api/admin/orders/:id/retry',async(req,res)=>{if(!simulation)throw new HttpError(503,'Adapter produksi belum tersedia.');const id=idSchema.parse(req.params.id);await db.transaction(async tx=>{const o=(await tx.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!o||o.payment_status!=='paid'||!['held','failed'].includes(o.fulfillment_status))throw new HttpError(409,'Pesanan tidak aman untuk diproses ulang.');await tx.query("UPDATE orders SET fulfillment_status='queued' WHERE id=$1",[id]);await tx.query("UPDATE fulfillment_jobs SET status='queued' WHERE order_id=$1",[id]);await event(tx,id,'Admin memasukkan kembali pesanan simulasi ke antrean.');await log(tx,req,'order.retry',{orderId:id});});if(inlineSimulation)await processSimulation(db,id);res.json({ok:true});});
 app.post('/api/admin/orders/:id/notes',async(req,res)=>{const id=idSchema.parse(req.params.id),{note}=z.object({note:z.string().trim().min(1).max(1000)}).parse(req.body);await detail(id);await log(db,req,'order.note',{orderId:id,note});res.json({ok:true});});
 app.get('/api/admin/products',async(req,res)=>res.json((await db.query('SELECT p.*,g.name AS game_name FROM products p JOIN games g ON g.id=p.game_id ORDER BY g.name,p.price')).rows));
 app.patch('/api/admin/products/:id',async(req,res)=>{const id=idSchema.parse(req.params.id),d=z.object({price:z.number().int().min(100).max(100000000),active:z.boolean()}).parse(req.body);await db.transaction(async tx=>{const r=await tx.query('UPDATE products SET price=$1,active=$2 WHERE id=$3 RETURNING id',[d.price,d.active,id]);if(!r.rows.length)throw new HttpError(404,'Produk tidak ditemukan.');await log(tx,req,'product.update',{id,...d});});res.json({ok:true});});
 app.get('/api/admin/supplier',async(req,res)=>res.json({settings:(await db.query('SELECT * FROM supplier_settings WHERE id=1')).rows[0],ledger:(await db.query('SELECT * FROM supplier_ledger ORDER BY created_at DESC LIMIT 100')).rows,mode:'simulation'}));
 app.post('/api/admin/supplier/deposit',async(req,res)=>{if(!simulation)throw new HttpError(404,'Tidak ditemukan.');const {amount}=z.object({amount:z.number().int().min(10000).max(10000000)}).parse(req.body);await db.transaction(async tx=>{await tx.query('UPDATE supplier_settings SET balance=balance+$1 WHERE id=1',[amount]);await tx.query('INSERT INTO supplier_ledger(amount,description) VALUES ($1,$2)',[amount,'Deposit simulasi oleh admin']);await log(tx,req,'supplier.demo_deposit',{amount});});res.json({ok:true});});
 app.get('/api/admin/articles',async(req,res)=>res.json((await db.query('SELECT * FROM articles ORDER BY created_at DESC')).rows));
 app.post('/api/admin/articles',async(req,res)=>{const d=z.object({title:z.string().min(3).max(160),category:safeText,body:z.string().min(10).max(15000),published:z.boolean()}).parse(req.body);const a=await db.transaction(async tx=>{const row=(await tx.query('INSERT INTO articles(title,category,body,published) VALUES ($1,$2,$3,$4) RETURNING *',[d.title,d.category,d.body,d.published])).rows[0];await log(tx,req,'article.create',{id:row.id});return row;});res.status(201).json(a);});
 app.get('/api/admin/audit',async(req,res)=>res.json((await db.query('SELECT action,detail,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 100')).rows));
 app.use('/api',(req,res)=>res.status(404).json({error:'Endpoint tidak ditemukan.'}));
 app.use(express.static(fileURLToPath(new URL('../public/',import.meta.url)),{index:'index.html'}));
 app.use((err,req,res,next)=>{if(res.headersSent)return next(err);if(err instanceof z.ZodError)return res.status(400).json({error:'Data tidak valid.',fields:err.issues.map(i=>({field:i.path.join('.'),message:i.message}))});const status=err.status||500;if(status===500)console.error('request_error',err.code||err.name);res.status(status).json({error:status===500?'Terjadi kesalahan server.':err.message});});
 return app;
}
