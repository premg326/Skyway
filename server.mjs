import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { dirname, extname, join, normalize, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = join(root, 'data');
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, 'skyway.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS flights (id TEXT PRIMARY KEY, airline TEXT, flight_number TEXT, origin TEXT, destination TEXT, departure_time TEXT, arrival_time TEXT, duration TEXT, stops TEXT, price REAL, currency TEXT, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS bookings (id INTEGER PRIMARY KEY, reference TEXT UNIQUE, flight_id TEXT, traveler_first TEXT, traveler_last TEXT, email TEXT, phone TEXT, passengers INTEGER, trip_type TEXT, depart_date TEXT, return_date TEXT, total REAL, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp' };
const send = (res, status, data) => { res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' }); res.end(JSON.stringify(data)); };
async function body(req) {
  let raw=''; for await (const part of req) { raw += part; if(raw.length > 1_000_000) throw Error('Request too large'); }
  try { return JSON.parse(raw || '{}'); } catch { throw Error('Invalid JSON body'); }
}
function clean(value, max=180) { return typeof value === 'string' ? value.trim().slice(0,max) : ''; }
function code(place) { return clean(place).match(/\(([A-Z]{3})\)/i)?.[1]?.toUpperCase() || clean(place).slice(0,3).toUpperCase(); }
const plans = [
  ['Northstar Air','NS 204','08:15','16:05','6h 50m','Nonstop',489],
  ['Juniper Airways','JA 718','11:40','19:30','6h 50m','1 stop',552],
  ['Atlas Airlines','AT 931','17:25','01:10','6h 45m','Nonstop',624]
];
const isoTime = (date, time) => `${date}T${time}:00`;
const flightUpsert = db.prepare('INSERT OR REPLACE INTO flights (id,airline,flight_number,origin,destination,departure_time,arrival_time,duration,stops,price,currency,active) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)');
const flightGet = db.prepare('SELECT * FROM flights WHERE id=? AND active=1');
const bookingInsert = db.prepare('INSERT INTO bookings (reference,flight_id,traveler_first,traveler_last,email,phone,passengers,trip_type,depart_date,return_date,total) VALUES (?,?,?,?,?,?,?,?,?,?,?)');

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'POST' && url.pathname === '/api/search') {
      const q = await body(req);
      const origin=clean(q.origin), destination=clean(q.destination), depart=clean(q.depart_date,10);
      if (!origin || !destination || !/^\d{4}-\d{2}-\d{2}$/.test(depart)) return send(res,422,{error:'Enter a valid origin, destination and departure date.'});
      if (code(origin) === code(destination)) return send(res,422,{error:'Choose two different airports.'});
      const flights = plans.map((p,i) => {
        const id = `${code(origin)}-${code(destination)}-${depart}-${i+1}`;
        const price = p[6] + (code(origin).charCodeAt(0)%8)*12 + (code(destination).charCodeAt(1)%7)*9;
        const f={ id, airline:p[0], flight_number:p[1], origin, destination, departure_time:isoTime(depart,p[2]), arrival_time:isoTime(depart,p[3]), duration:p[4], stops:p[5], price, currency:'USD' };
        flightUpsert.run(f.id,f.airline,f.flight_number,f.origin,f.destination,f.departure_time,f.arrival_time,f.duration,f.stops,f.price,f.currency); return f;
      });
      return send(res,200,{flights});
    }
    if (req.method === 'POST' && url.pathname === '/api/book') {
      const q=await body(req), t=q.traveler||{}, f=q.flight||{};
      const first=clean(t.first_name,80), last=clean(t.last_name,80), email=clean(t.email,254), phone=clean(t.phone,40);
      const count=Number(q.passengers), trip=q.trip_type === 'oneway' ? 'oneway' : q.trip_type === 'roundtrip' ? 'roundtrip' : '';
      if (!first || !last || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !phone) return send(res,422,{error:'Enter valid traveler details.'});
      if (!Number.isInteger(count) || count<1 || count>9 || !trip) return send(res,422,{error:'Choose a valid passenger count and trip type.'});
      const flight=flightGet.get(clean(f.id,100));
      if (!flight) return send(res,409,{error:'That flight is no longer available. Search again.'});
      const ref=`SKY-${randomBytes(3).toString('hex').toUpperCase()}`;
      const total=Number(flight.price)*count*(trip==='roundtrip'?1.82:1);
      bookingInsert.run(ref,flight.id,first,last,email,phone,count,trip,clean(q.depart_date,10),clean(q.return_date,10),total);
      return send(res,201,{reference:ref,total,currency:flight.currency,status:'pending'});
    }
    if (url.pathname.startsWith('/api/')) return send(res,404,{error:'API route not found.'});
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res,405,{error:'Method not allowed.'});
    const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    if (!['index.html','styles.css','app.js'].includes(requested)) { res.writeHead(404); return res.end('Not found'); }
    const file = normalize(join(root, requested));
    const rel = relative(root, file);
    if (isAbsolute(rel) || rel.startsWith('..') || !existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200,{ 'content-type': mime[extname(file)] || 'application/octet-stream', 'x-content-type-options':'nosniff' });
    createReadStream(file).pipe(res);
  } catch (error) { send(res,400,{error:error.message || 'Request failed.'}); }
});
const port=Number(process.env.PORT||4173);
const host=process.env.HOST||'0.0.0.0';
server.listen(port,host,()=>console.log(`Skyway listening on ${host}:${port}`));
