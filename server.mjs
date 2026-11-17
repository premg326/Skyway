import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { dirname, extname, join, normalize, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

const scrypt = promisify(scryptCallback);
const root = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || join(root, 'data');
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, 'skyway.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS flights (
  id TEXT PRIMARY KEY, airline TEXT NOT NULL, flight_number TEXT NOT NULL,
  origin TEXT NOT NULL, destination TEXT NOT NULL, departure_time TEXT NOT NULL,
  arrival_time TEXT NOT NULL, duration TEXT NOT NULL, stops TEXT NOT NULL,
  price REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', cabin TEXT NOT NULL DEFAULT 'Economy',
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY, reference TEXT NOT NULL UNIQUE, flight_id TEXT NOT NULL,
  traveler_first TEXT NOT NULL, traveler_last TEXT NOT NULL, email TEXT NOT NULL,
  phone TEXT NOT NULL, passengers INTEGER NOT NULL, trip_type TEXT NOT NULL,
  depart_date TEXT NOT NULL, return_date TEXT, total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id TEXT, travelers_json TEXT NOT NULL DEFAULT '[]', booking_json TEXT NOT NULL DEFAULT '{}',
  cabin TEXT NOT NULL DEFAULT 'Economy', payment_status TEXT NOT NULL DEFAULT 'not_collected',
  cancelled_at TEXT
);
CREATE TABLE IF NOT EXISTS itineraries (
  id TEXT PRIMARY KEY, segments_json TEXT NOT NULL, price REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD', cabin TEXT NOT NULL DEFAULT 'Economy', expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
  email TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`);

function ensureColumn(table, column, definition) {
  const found = db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
  if (!found) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
// Migrate databases created by the earlier demo without discarding saved bookings.
ensureColumn('flights', 'cabin', "TEXT NOT NULL DEFAULT 'Economy'");
ensureColumn('bookings', 'user_id', 'TEXT');
ensureColumn('bookings', 'travelers_json', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('bookings', 'booking_json', "TEXT NOT NULL DEFAULT '{}'");
ensureColumn('bookings', 'cabin', "TEXT NOT NULL DEFAULT 'Economy'");
ensureColumn('bookings', 'payment_status', "TEXT NOT NULL DEFAULT 'not_collected'");
ensureColumn('bookings', 'cancelled_at', 'TEXT');

const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8' };
const send = (res, status, data, headers={}) => {
  res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff', ...headers });
  res.end(JSON.stringify(data));
};
const clean = (value, max=180) => typeof value === 'string' ? value.trim().slice(0,max) : '';
const normalizedEmail = (value) => clean(value,254).toLowerCase();
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const cabins = new Set(['Economy','Premium economy','Business','First class']);
const validDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0,10) === value;
};
const airportCode = (place) => clean(place).match(/\(([A-Z]{3})\)/i)?.[1]?.toUpperCase() || clean(place).slice(0,3).toUpperCase();
const hash = (value) => createHash('sha256').update(value).digest('hex');
const cabinFactor = (cabin) => ({ 'Economy':1, 'Premium economy':1.35, 'Business':2.45, 'First class':3.25 }[cabin] || 1);
const plans = [
  ['Northstar Air','NS 204','08:15','16:05','6h 50m','Nonstop',489],
  ['Juniper Airways','JA 718','11:40','19:30','6h 50m','1 stop',552],
  ['Atlas Airlines','AT 931','17:25','01:10','6h 45m','Nonstop',624]
];
const flightUpsert = db.prepare(`INSERT OR REPLACE INTO flights
  (id,airline,flight_number,origin,destination,departure_time,arrival_time,duration,stops,price,currency,cabin,active)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`);
const flightGet = db.prepare('SELECT * FROM flights WHERE id=? AND active=1');
const itineraryInsert = db.prepare('INSERT OR REPLACE INTO itineraries (id,segments_json,price,currency,cabin,expires_at) VALUES (?,?,?,?,?,?)');
const itineraryGet = db.prepare('SELECT * FROM itineraries WHERE id=? AND expires_at>?');
const accountByEmail = db.prepare('SELECT * FROM accounts WHERE email=?');
const accountById = db.prepare('SELECT id,email,first_name,last_name,phone,created_at FROM accounts WHERE id=?');
const sessionGet = db.prepare(`SELECT a.id,a.email,a.first_name,a.last_name,a.phone,a.created_at,s.expires_at
  FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?`);
const sessionInsert = db.prepare('INSERT INTO sessions (token_hash,account_id,expires_at) VALUES (?,?,?)');
const bookingInsert = db.prepare(`INSERT INTO bookings
  (reference,flight_id,traveler_first,traveler_last,email,phone,passengers,trip_type,depart_date,return_date,total,status,user_id,travelers_json,booking_json,cabin,payment_status)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const bookingForUser = db.prepare('SELECT * FROM bookings WHERE user_id=? ORDER BY id DESC LIMIT 100');
const bookingByReference = db.prepare('SELECT * FROM bookings WHERE reference=?');

async function body(req) {
  let raw='';
  for await (const part of req) { raw += part; if (raw.length > 1_000_000) throw Object.assign(Error('Request too large.'),{status:413}); }
  try { const data=JSON.parse(raw || '{}'); if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error(); return data; }
  catch { throw Object.assign(Error('Send a valid JSON request.'),{status:400}); }
}
function cookie(req, name) {
  const item=(req.headers.cookie||'').split(';').map((part)=>part.trim()).find((part)=>part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length+1)) : '';
}
function cookieHeader(req, token, maxAge) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;
  return `skyway_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure?'; Secure':''}`;
}
function currentAccount(req) {
  const token=cookie(req,'skyway_session');
  if (!token) return null;
  const tokenHash=hash(token), row=sessionGet.get(tokenHash,Date.now());
  if (!row) { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash); return null; }
  const { expires_at, ...account }=row;
  return account;
}
function publicAccount(account) {
  if (!account) return null;
  return { id:account.id,email:account.email,first_name:account.first_name,last_name:account.last_name,phone:account.phone||'' };
}
async function createAccountSession(req, res, accountId) {
  const token=randomBytes(32).toString('base64url'), expiry=Date.now()+7*24*60*60*1000;
  sessionInsert.run(hash(token),accountId,expiry);
  const account=accountById.get(accountId);
  send(res,200,{account:publicAccount(account)},{'set-cookie':cookieHeader(req,token,7*24*60*60)});
}
function makeFlight(segment, planIndex, cabin) {
  const p=plans[planIndex], origin=clean(segment.origin), destination=clean(segment.destination), date=clean(segment.depart_date,10);
  const fromCode=airportCode(origin), toCode=airportCode(destination);
  const id=`${fromCode}-${toCode}-${date}-${planIndex+1}-${cabin.toLowerCase().replace(/[^a-z]/g,'')}`;
  const base=p[6]+(fromCode.charCodeAt(0)%8)*12+(toCode.charCodeAt(1)%7)*9;
  const price=Math.round(base*cabinFactor(cabin)*100)/100;
  const flight={id,airline:p[0],flight_number:p[1],origin,destination,departure_time:`${date}T${p[2]}:00`,arrival_time:`${date}T${p[3]}:00`,duration:p[4],stops:p[5],price,currency:'USD',cabin};
  flightUpsert.run(flight.id,flight.airline,flight.flight_number,flight.origin,flight.destination,flight.departure_time,flight.arrival_time,flight.duration,flight.stops,flight.price,flight.currency,flight.cabin);
  return flight;
}
function bookingRecord(row) {
  let details={}; try { details=JSON.parse(row.booking_json||'{}'); } catch {}
  let travelers=[]; try { travelers=JSON.parse(row.travelers_json||'[]'); } catch {}
  return { reference:row.reference,status:row.status,created_at:row.created_at,trip_type:row.trip_type,depart_date:row.depart_date,return_date:row.return_date,
    passengers:row.passengers,cabin:row.cabin||'Economy',total:Number(row.total),currency:'USD',payment_status:row.payment_status||'not_collected',
    contact:{email:row.email,phone:row.phone},travelers,details };
}
function authRequired(req,res) { const account=currentAccount(req); if (!account) { send(res,401,{error:'Sign in to view your account bookings.'}); return null; } return account; }

const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost'), path=url.pathname;
  try {
    if (req.method==='GET' && path==='/api/health') return send(res,200,{ok:true,service:'skyway-demo'});
    if (req.method==='GET' && path==='/api/auth/me') return send(res,200,{account:publicAccount(currentAccount(req))});
    if (req.method==='POST' && path==='/api/auth/register') {
      const d=await body(req), first=clean(d.first_name,80), last=clean(d.last_name,80), email=normalizedEmail(d.email), phone=clean(d.phone,40), password=typeof d.password==='string'?d.password:'';
      if (!first||!last||!validEmail(email)||password.length<8||password.length>128) return send(res,422,{error:'Enter your name, a valid email, and a password between 8 and 128 characters.'});
      if (accountByEmail.get(email)) return send(res,409,{error:'An account with this email already exists. Sign in instead.'});
      const id=randomBytes(16).toString('hex'), salt=randomBytes(16).toString('base64url'), passwordHash=(await scrypt(password,salt,64)).toString('base64url');
      db.prepare('INSERT INTO accounts (id,email,password_salt,password_hash,first_name,last_name,phone) VALUES (?,?,?,?,?,?,?)').run(id,email,salt,passwordHash,first,last,phone);
      return createAccountSession(req,res,id);
    }
    if (req.method==='POST' && path==='/api/auth/login') {
      const d=await body(req), email=normalizedEmail(d.email), password=typeof d.password==='string'?d.password:'';
      const account=accountByEmail.get(email);
      if (!account || password.length>128) return send(res,401,{error:'Email or password is incorrect.'});
      const supplied=await scrypt(password,account.password_salt,64), expected=Buffer.from(account.password_hash,'base64url');
      if (supplied.length!==expected.length||!timingSafeEqual(supplied,expected)) return send(res,401,{error:'Email or password is incorrect.'});
      return createAccountSession(req,res,account.id);
    }
    if (req.method==='POST' && path==='/api/auth/logout') {
      const token=cookie(req,'skyway_session'); if(token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token));
      return send(res,200,{ok:true},{'set-cookie':cookieHeader(req,'',0)});
    }
    if (req.method==='PATCH' && path==='/api/auth/profile') {
      const account=authRequired(req,res); if(!account)return;
      const d=await body(req), first=clean(d.first_name,80), last=clean(d.last_name,80), phone=clean(d.phone,40);
      if(!first||!last)return send(res,422,{error:'First and last name are required.'});
      db.prepare('UPDATE accounts SET first_name=?,last_name=?,phone=? WHERE id=?').run(first,last,phone,account.id);
      return send(res,200,{account:publicAccount(accountById.get(account.id))});
    }
    if (req.method==='PATCH' && path==='/api/auth/password') {
      const account=authRequired(req,res); if(!account)return;
      const d=await body(req), currentPassword=typeof d.current_password==='string'?d.current_password:'', newPassword=typeof d.new_password==='string'?d.new_password:'';
      const stored=accountByEmail.get(account.email);
      if(!currentPassword||!stored)return send(res,401,{error:'Enter your current password.'});
      const supplied=await scrypt(currentPassword,stored.password_salt,64), expected=Buffer.from(stored.password_hash,'base64url');
      if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return send(res,401,{error:'Current password is incorrect.'});
      if(newPassword.length<8||newPassword.length>128)return send(res,422,{error:'Your new password must be between 8 and 128 characters.'});
      const salt=randomBytes(16).toString('base64url'), passwordHash=(await scrypt(newPassword,salt,64)).toString('base64url');
      db.prepare('UPDATE accounts SET password_salt=?,password_hash=? WHERE id=?').run(salt,passwordHash,account.id);
      const currentTokenHash=hash(cookie(req,'skyway_session'));
      db.prepare('DELETE FROM sessions WHERE account_id=? AND token_hash<>?').run(account.id,currentTokenHash);
      return send(res,200,{ok:true,message:'Password updated. Other signed-in sessions have been signed out.'});
    }
    if (req.method==='POST' && path==='/api/search') {
      const q=await body(req), origin=clean(q.origin), destination=clean(q.destination), depart=clean(q.depart_date,10), returnDate=clean(q.return_date,10);
      const cabin=clean(q.cabin,40)||'Economy', trip=q.trip_type==='oneway'?'oneway':q.trip_type==='multicity'?'multicity':'roundtrip';
      if(!cabins.has(cabin))return send(res,422,{error:'Choose a valid cabin class.'});
      if(!origin||!destination||!validDate(depart))return send(res,422,{error:'Enter a valid origin, destination, and departure date.'});
      if(airportCode(origin)===airportCode(destination))return send(res,422,{error:'Choose two different airports.'});
      if(trip==='roundtrip'&&(!validDate(returnDate)||returnDate<depart))return send(res,422,{error:'Choose a valid return date after departure.'});
      if(trip==='multicity') {
        const segments=Array.isArray(q.segments)?q.segments:[];
        if(segments.length<2||segments.length>4||segments.some((s)=>!clean(s.origin)||!clean(s.destination)||airportCode(s.origin)===airportCode(s.destination)||!validDate(clean(s.depart_date,10)))||segments.some((s,i)=>i>0&&clean(s.depart_date,10)<clean(segments[i-1].depart_date,10)))return send(res,422,{error:'Add 2 to 4 valid flight legs in date order for a multi-city trip.'});
        const itineraries=[0,1,2].map((planIndex)=>{
          const legs=segments.map((segment)=>makeFlight(segment,planIndex,cabin));
          const id=`MC-${randomBytes(8).toString('hex').toUpperCase()}`, price=legs.reduce((sum,leg)=>sum+leg.price,0);
          itineraryInsert.run(id,JSON.stringify(legs),price,'USD',cabin,Date.now()+2*60*60*1000);
          return {id,airline:legs.map((leg)=>leg.airline).filter((name,index,all)=>all.indexOf(name)===index).join(' + '),flight_number:`${legs.length} legs`,legs,price,currency:'USD',cabin};
        });
        return send(res,200,{flights:itineraries});
      }
      const flights=plans.map((_,i)=>makeFlight({origin,destination,depart_date:depart},i,cabin));
      return send(res,200,{flights});
    }
    if (req.method==='POST' && path==='/api/bookings') {
      const q=await body(req), account=currentAccount(req), trip=q.trip_type==='oneway'?'oneway':q.trip_type==='multicity'?'multicity':'roundtrip';
      const count=Number(q.passengers), cabin=clean(q.cabin,40)||'Economy', depart=clean(q.depart_date,10), returnDate=clean(q.return_date,10)||null;
      if(!cabins.has(cabin))return send(res,422,{error:'Choose a valid cabin class.'});
      if(!Number.isInteger(count)||count<1||count>9)return send(res,422,{error:'Passenger count must be between 1 and 9.'});
      if(!validDate(depart))return send(res,422,{error:'Enter a valid departure date.'});
      if(trip==='roundtrip'&&(!returnDate||!validDate(returnDate)||returnDate<depart))return send(res,422,{error:'Enter a valid return date.'});
      const contact=q.contact||{}, email=normalizedEmail(contact.email||account?.email), phone=clean(contact.phone||account?.phone,40);
      if(!validEmail(email)||!phone)return send(res,422,{error:'Enter a valid booking contact email and phone number.'});
      let travelers=Array.isArray(q.travelers)?q.travelers:[];
      if(!travelers.length&&q.traveler)travelers=[q.traveler];
      travelers=travelers.slice(0,count).map((t)=>({first_name:clean(t.first_name,80),last_name:clean(t.last_name,80)}));
      if(travelers.length!==count||travelers.some((t)=>!t.first_name||!t.last_name))return send(res,422,{error:'Enter the first and last name for every traveler.'});
      let flightId='', flightData={}, basePrice=0;
      if(trip==='multicity') {
        const itinerary=itineraryGet.get(clean(q.flight?.id,80),Date.now());
        if(!itinerary)return send(res,409,{error:'This multi-city fare expired. Search again.'});
        flightId=JSON.parse(itinerary.segments_json)[0]?.id||itinerary.id;
        flightData={id:itinerary.id,legs:JSON.parse(itinerary.segments_json)};
        basePrice=Number(itinerary.price);
      } else {
        const flight=flightGet.get(clean(q.flight?.id,120));
        if(!flight)return send(res,409,{error:'This flight is no longer available. Search again.'});
        flightId=flight.id;flightData=flight;basePrice=Number(flight.price);
      }
      const total=Math.round(basePrice*count*(trip==='roundtrip'?1.82:1)*100)/100;
      let reference;
      do { reference=`SKY-${randomBytes(4).toString('hex').toUpperCase()}`; } while(bookingByReference.get(reference));
      const details={flight:flightData,trip_type:trip,origin:clean(q.origin),destination:clean(q.destination),depart_date:depart,return_date:returnDate,cabin,passengers:count};
      bookingInsert.run(reference,flightId,travelers[0].first_name,travelers[0].last_name,email,phone,count,trip,depart,returnDate,total,'confirmed_demo',account?.id||null,JSON.stringify(travelers),JSON.stringify(details),cabin,'not_collected');
      const row=bookingByReference.get(reference);
      return send(res,201,{booking:bookingRecord(row),message:'Demo booking confirmed. No payment was collected and no airline ticket was issued.'});
    }
    if (req.method==='GET' && path==='/api/bookings') {
      const account=authRequired(req,res); if(!account)return;
      return send(res,200,{bookings:bookingForUser.all(account.id).map(bookingRecord)});
    }
    if (req.method==='POST' && path==='/api/bookings/lookup') {
      const d=await body(req), reference=clean(d.reference,32).toUpperCase(), email=normalizedEmail(d.email);
      if(!reference||!validEmail(email))return send(res,422,{error:'Enter the booking reference and the email used for the booking.'});
      const row=bookingByReference.get(reference);
      if(!row||normalizedEmail(row.email)!==email)return send(res,404,{error:'We could not find a booking with that reference and email.'});
      return send(res,200,{booking:bookingRecord(row)});
    }
    const cancelMatch=path.match(/^\/api\/bookings\/([A-Z0-9-]+)\/cancel$/i);
    if(req.method==='POST'&&cancelMatch) {
      const d=await body(req), row=bookingByReference.get(cancelMatch[1].toUpperCase()), account=currentAccount(req), email=normalizedEmail(d.email);
      if(!row||!(account?.id===row.user_id||email&&normalizedEmail(row.email)===email))return send(res,404,{error:'We could not find a booking you can manage.'});
      if(row.status==='cancelled_demo')return send(res,409,{error:'This demo booking is already cancelled.'});
      if(row.status!=='confirmed_demo')return send(res,409,{error:'Only confirmed demo bookings can be cancelled.'});
      db.prepare("UPDATE bookings SET status='cancelled_demo',cancelled_at=CURRENT_TIMESTAMP WHERE reference=?").run(row.reference);
      return send(res,200,{booking:bookingRecord(bookingByReference.get(row.reference)),message:'Demo booking cancelled. No refund is due because no payment was collected.'});
    }
    if (req.method==='POST' && path==='/api/newsletter') {
      const d=await body(req), email=normalizedEmail(d.email);
      if(!validEmail(email))return send(res,422,{error:'Enter a valid email address.'});
      db.prepare('INSERT OR IGNORE INTO newsletter_subscriptions (email) VALUES (?)').run(email);
      return send(res,201,{ok:true,message:'You are subscribed to Skyway travel updates.'});
    }
    if (path.startsWith('/api/')) return send(res,404,{error:'API route not found.'});
    if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,{error:'Method not allowed.'});
    const requested=path==='/'?'index.html':decodeURIComponent(path.slice(1));
    if(!['index.html','styles.css','app.js'].includes(requested)){res.writeHead(404);return res.end('Not found');}
    const file=normalize(join(root,requested)), rel=relative(root,file);
    if(isAbsolute(rel)||rel.startsWith('..')||!existsSync(file)){res.writeHead(404);return res.end('Not found');}
    res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin'});
    createReadStream(file).pipe(res);
  } catch(error) {
    const status=Number.isInteger(error.status)?error.status:500;
    if(status>=500)console.error('Skyway request failed:',error);
    send(res,status,{error:status>=500?'Unable to complete this request right now. Please try again.':error.message||'Request failed.'});
  }
});

const port=Number(process.env.PORT||4173),host=process.env.HOST||'0.0.0.0';
server.listen(port,host,()=>console.log(`Skyway listening on ${host}:${port}`));
