import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'CHANGE_ME_NOW';
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'store.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products (
 id INTEGER PRIMARY KEY AUTOINCREMENT, game TEXT NOT NULL, name TEXT NOT NULL,
 price INTEGER NOT NULL, desc TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'available',
 account_data TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY, type TEXT NOT NULL, product_id INTEGER, customer TEXT DEFAULT '',
 amount INTEGER DEFAULT 0, card_type TEXT, card_value INTEGER, card_code TEXT, card_serial TEXT,
 receive TEXT, game TEXT, uid TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(product_id) REFERENCES products(id)
);
`);

const defaults = {
 rate: 80,
 bank: {name:'MB Bank',number:'0123456789',owner:'NGUYEN GAME STORE',content:'NGS + mã đơn'},
 cardRates: {'Viettel':80,'Vinaphone':80,'Mobifone':80,'Garena':85,'Zing':85},
 topups: {'Free Fire':3,'Liên Quân':3,'PUBG Mobile':2,'Roblox':2}
};
for (const [k,v] of Object.entries(defaults)) db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)').run(k, JSON.stringify(v));
if (db.prepare('SELECT COUNT(*) c FROM products').get().c === 0) {
 const ins=db.prepare('INSERT INTO products(game,name,price,desc,account_data) VALUES (?,?,?,?,?)');
 ins.run('Free Fire','Acc Rank cao + nhiều skin',250000,'Acc mẫu — thay thông tin bằng acc thật của bạn.','');
 ins.run('Liên Quân','Acc nhiều tướng',350000,'Acc mẫu — thay thông tin bằng acc thật của bạn.','');
 ins.run('PUBG Mobile','Acc nhiều skin',450000,'Acc mẫu — thay thông tin bằng acc thật của bạn.','');
}
const getSetting=k=>JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value ?? 'null');
const setSetting=(k,v)=>db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,JSON.stringify(v));
const makeId=()=>crypto.randomUUID();
const auth = (req,res,next)=>{ if(req.headers.authorization !== `Bearer ${req.sessionToken}`){}; const token=(req.headers.authorization||'').replace('Bearer ',''); if(!token || !sessions.has(token)) return res.status(401).json({error:'Unauthorized'}); next(); };
const sessions=new Set();
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:'100kb'}));
app.use(rateLimit({windowMs:60_000,max:120,standardHeaders:true,legacyHeaders:false}));
app.use(express.static(path.join(__dirname,'public')));

app.get('/api/config',(req,res)=>res.json({rate:getSetting('rate'),bank:getSetting('bank'),cardRates:getSetting('cardRates'),topups:getSetting('topups')}));
app.get('/api/products',(req,res)=>res.json(db.prepare("SELECT id,game,name,price,desc,status FROM products WHERE status='available' ORDER BY id DESC").all()));

app.post('/api/admin/login',(req,res)=>{ if(!req.body?.password || req.body.password!==ADMIN_PASSWORD) return res.status(401).json({error:'Sai mật khẩu'}); const token=crypto.randomBytes(32).toString('hex'); sessions.add(token); res.json({token}); });
app.post('/api/admin/logout',auth,(req,res)=>{sessions.delete((req.headers.authorization||'').replace('Bearer ',''));res.json({ok:true})});
app.get('/api/admin/products',auth,(req,res)=>res.json(db.prepare('SELECT * FROM products ORDER BY id DESC').all()));
app.post('/api/admin/products',auth,(req,res)=>{const {game,name,price,desc='',account_data=''}=req.body;if(!game||!name||!Number.isFinite(+price))return res.status(400).json({error:'Dữ liệu không hợp lệ'});const r=db.prepare('INSERT INTO products(game,name,price,desc,account_data) VALUES (?,?,?,?,?)').run(game,name,+price,desc,account_data);res.json({id:r.lastInsertRowid});});
app.delete('/api/admin/products/:id',auth,(req,res)=>{db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);res.json({ok:true})});
app.post('/api/admin/products/:id/status',auth,(req,res)=>{const s=req.body.status;if(!['available','sold','hidden'].includes(s))return res.status(400).json({error:'Status không hợp lệ'});db.prepare('UPDATE products SET status=? WHERE id=?').run(s,req.params.id);res.json({ok:true})});
app.get('/api/admin/orders',auth,(req,res)=>res.json(db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all()));
app.post('/api/admin/orders/:id/status',auth,(req,res)=>{const s=req.body.status;if(!s)return res.status(400).json({error:'Thiếu status'});db.prepare('UPDATE orders SET status=? WHERE id=?').run(s,req.params.id);res.json({ok:true})});
app.post('/api/admin/settings',auth,(req,res)=>{for(const k of ['rate','bank','cardRates','topups']) if(req.body[k]!==undefined)setSetting(k,req.body[k]);res.json({ok:true})});

app.post('/api/orders/card',(req,res)=>{const {type,value,code,serial,receive}=req.body;if(!type||!value||!code||!serial||!receive)return res.status(400).json({error:'Thiếu thông tin'});const id=makeId();db.prepare('INSERT INTO orders(id,type,card_type,card_value,card_code,card_serial,receive,status) VALUES (?,?,?,?,?,?,?,?)').run(id,'card',type,+value,code,serial,receive,'pending');res.json({id,status:'pending'});});
app.post('/api/orders/bank',(req,res)=>{const {amount,customer}=req.body;if(!amount||!customer)return res.status(400).json({error:'Thiếu thông tin'});const id=makeId();db.prepare('INSERT INTO orders(id,type,customer,amount,status) VALUES (?,?,?,?,?)').run(id,'bank',customer,+amount,'pending');res.json({id,status:'pending'});});
app.post('/api/orders/topup',(req,res)=>{const {game,value,uid}=req.body;if(!game||!value||!uid)return res.status(400).json({error:'Thiếu thông tin'});const rates=getSetting('topups')||{};const rate=+rates[game]||0;const pay=Math.round(+value*(100-rate)/100);const id=makeId();db.prepare('INSERT INTO orders(id,type,amount,game,uid,status) VALUES (?,?,?,?,?,?)').run(id,'topup',pay,game,uid,'pending');res.json({id,pay,rate,status:'pending'});});
app.post('/api/orders/buy',(req,res)=>{const {productId,customer=''}=req.body;const tx=db.transaction(()=>{const p=db.prepare("SELECT * FROM products WHERE id=? AND status='available'").get(productId);if(!p)throw new Error('ACC không còn bán');const id=makeId();db.prepare('INSERT INTO orders(id,type,product_id,customer,amount,status) VALUES (?,?,?,?,?,?)').run(id,'buy',p.id,customer,p.price,'pending');db.prepare("UPDATE products SET status='sold' WHERE id=?").run(p.id);return {id,p:{id:p.id,game:p.game,name:p.name,price:p.price,account_data:p.account_data}};});try{res.json(tx())}catch(e){res.status(409).json({error:e.message})}});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.listen(PORT,()=>console.log(`NGUYENGAMESTORE running on http://localhost:${PORT}`));
