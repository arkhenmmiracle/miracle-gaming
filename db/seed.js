import {database} from '../src/database.js';
export async function seed(db){
 await db.transaction(async tx=>{
  for(const g of [['mobile-legends','Mobile Legends','MOBA',true,'hero.webp'],['free-fire','Free Fire','Battle Royale',false,'arena.webp'],['pubg-mobile','PUBG Mobile','Battle Royale',false,'arena.webp'],['genshin-impact','Genshin Impact','RPG',true,'hero.webp']])await tx.query('INSERT INTO games (id,name,category,server_required,artwork) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',g);
  for(const p of [['mobile-legends','86 Diamonds','DEMO-ML86',18000,20000],['mobile-legends','172 Diamonds','DEMO-ML172',36000,39000],['free-fire','140 Diamonds','DEMO-FF140',18000,20000],['pubg-mobile','60 UC','DEMO-PUBG60',13000,15000],['genshin-impact','60 Genesis Crystals','DEMO-GI60',13000,16000]])await tx.query('INSERT INTO products(game_id,name,supplier_code,cost,price) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',p);
  await tx.query('INSERT INTO supplier_settings(id,balance,threshold) VALUES (1,500000,100000) ON CONFLICT DO NOTHING');
  const a=await tx.query('SELECT id FROM articles LIMIT 1');if(!a.rows.length)await tx.query('INSERT INTO articles(title,category,body,published) VALUES ($1,$2,$3,true)',['Periksa ID sebelum top up','Panduan','Pastikan User ID dan Server ID sesuai dengan akun tujuan. Pada demo ini, pengiriman dan pembayaran hanya simulasi. Tidak ada diamond sungguhan yang dikirim.']);
 });
}
if(process.argv[1]?.endsWith('/seed.js')){const db=await database();await seed(db);await db.close();console.log('Katalog demo siap. Tidak ada akun atau password bawaan.');}
