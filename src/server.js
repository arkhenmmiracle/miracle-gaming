import {database} from './database.js';
import {createApp} from './app.js';
import {processSimulation} from './orders.js';
if((process.env.PAYMENT_MODE||'simulation')!=='simulation'||(process.env.SUPPLIER_MODE||'simulation')!=='simulation')throw new Error('Integrasi produksi belum tersedia. Server menolak mode produksi pembayaran/pemasok.');
const db=await database();await db.query('SELECT 1 FROM games LIMIT 1');
const server=createApp(db).listen(Number(process.env.PORT)||3000,()=>console.log('MIRACLE TOPUP berjalan. Pembayaran dan pengiriman: SIMULASI. Database:',db.local?'PostgreSQL lokal untuk pengembangan':'Neon/PostgreSQL'));
let busy=false;const timer=setInterval(async()=>{if(busy)return;busy=true;try{await processSimulation(db);}catch(e){console.error('worker_error',e.code||e.name);}finally{busy=false;}},3000);
async function stop(){clearInterval(timer);server.close(async()=>{await db.close();process.exit(0);});}process.on('SIGTERM',stop);process.on('SIGINT',stop);
