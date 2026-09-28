import {HttpError} from './orders.js';
export function reportPeriod(query,now=new Date()){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const end=query.end||today,start=query.start||new Date(Date.parse(today+'T00:00:00Z')-29*86400000).toISOString().slice(0,10);
 const valid=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
 if(!valid(start)||!valid(end)||start>end||(Date.parse(end)-Date.parse(start))/86400000>365)throw new HttpError(400,'Pilih rentang tanggal yang valid, maksimal 366 hari.');
 return {start,end};
}
export async function salesReport(db,game,period){
 const rows=(await db.query(`SELECT o.id,o.created_at,o.payment_status,o.fulfillment_status,o.total,o.fee,u.name AS customer,EXISTS(SELECT 1 FROM order_events e WHERE e.order_id=o.id AND e.message LIKE 'Bantuan pelanggan:%' AND e.created_at>COALESCE((SELECT MAX(r.created_at) FROM order_events r WHERE r.order_id=o.id AND r.message LIKE 'Balasan admin:%'),'-infinity'::timestamptz)) AS needs_help,
 to_char(o.created_at AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD') AS ordered_date,
 to_char(paid.at AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD') AS paid_date,
 COALESCE(SUM(i.price) FILTER(WHERE $1='' OR p.game_id=$1),0)::bigint AS product_revenue,
 COALESCE(SUM(i.cost) FILTER(WHERE ($1='' OR p.game_id=$1) AND i.status='success'),0)::bigint AS cost,
 STRING_AGG(i.game_name||' — '||i.product_name,', ') FILTER(WHERE $1='' OR p.game_id=$1) AS products
 FROM orders o JOIN users u ON u.id=o.user_id JOIN order_items i ON i.order_id=o.id JOIN products p ON p.id=i.product_id
 LEFT JOIN LATERAL (SELECT MIN(created_at) AS at FROM order_events WHERE order_id=o.id AND message='Pembayaran simulasi diterima; pengiriman masuk antrean.') paid ON true
 WHERE ($1='' OR EXISTS(SELECT 1 FROM order_items x JOIN products q ON q.id=x.product_id WHERE x.order_id=o.id AND q.game_id=$1))
 AND (CASE WHEN o.payment_status IN ('paid','refunded') THEN paid.at ELSE o.created_at END AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $2::date AND $3::date
 GROUP BY o.id,u.name,paid.at ORDER BY o.created_at DESC`,[game,period.start,period.end])).rows;
 const summary={orders:rows.length,success:0,attention:0,received:0,product_revenue:0,service_fees:0,cost:0,gateway_fees:0,refunds:0,gross_profit:0};
 const sales=[];for(let t=Date.parse(period.start);t<=Date.parse(period.end);t+=86400000)sales.push({date:new Date(t).toISOString().slice(0,10),revenue:0,orders:0});
 const days=new Map(sales.map(r=>[r.date,r]));
 for(const row of rows){const paid=['paid','refunded'].includes(row.payment_status);row.product_revenue=Number(row.product_revenue);row.cost=Number(row.cost);row.service_fees=paid&&!game?row.fee:0;row.received=paid?row.product_revenue+row.service_fees:0;row.refunds=row.payment_status==='refunded'?row.received:0;row.gateway_fees=0;row.gross_profit=row.received-row.refunds-row.cost;
 summary.success+=Number(row.fulfillment_status==='success');summary.attention+=Number(row.needs_help||(['held','failed','unknown'].includes(row.fulfillment_status)&&row.payment_status==='paid'));
 for(const key of ['received','service_fees','cost','refunds','gross_profit'])summary[key]+=row[key];if(paid)summary.product_revenue+=row.product_revenue;
 const day=days.get(row.paid_date);if(day&&paid){day.revenue+=row.received;day.orders++;}}
 return {period,summary,sales,rows};
}
export function reportCsv(report){const cell=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"';const fields=['id','customer','products','ordered_date','paid_date','payment_status','fulfillment_status','received','cost','service_fees','gateway_fees','refunds','gross_profit'];return '\ufeff'+[fields,...report.rows.map(r=>fields.map(k=>r[k]))].map(row=>row.map(cell).join(',')).join('\r\n');}
