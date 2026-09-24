import {database} from '../src/database.js';
import bcrypt from 'bcryptjs';
const email=process.env.ADMIN_EMAIL?.trim().toLowerCase(), password=process.env.ADMIN_PASSWORD;
if(!email||!password||password.length<12||password.length>72)throw new Error('Set ADMIN_EMAIL dan ADMIN_PASSWORD (12–72 karakter) melalui environment lokal.');
const db=await database();
await db.query("INSERT INTO users(name,email,password_hash,role) VALUES ('Administrator',$1,$2,'admin')",[email,await bcrypt.hash(password,12)]);
await db.close();console.log('Akun admin dibuat. Hapus ADMIN_PASSWORD dari environment setelah selesai.');
