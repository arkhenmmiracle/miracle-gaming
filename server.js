import express from 'express';
import {database} from './src/database.js';
import {createApp} from './src/app.js';
if ((process.env.PAYMENT_MODE || 'simulation') !== 'simulation' || (process.env.SUPPLIER_MODE || 'simulation') !== 'simulation') throw new Error('Only simulation adapters are implemented');
const app = express();
let handler;
app.use(async (req,res,next) => {
  try {
    if (!handler) handler = database().then(db => createApp(db,{inlineSimulation:true})).catch(error => { handler=null; throw error; });
    return (await handler)(req,res,next);
  } catch(error) { console.error('initialization_error',error.code || error.name); res.status(503).json({error:'Konfigurasi server belum siap.'}); }
});
export default app;
