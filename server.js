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
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'nguyen188208';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'CHANGE_ME_NOW';
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'store.db'));
db.pragma('journal_mode = WAL');

const hasCol=(table,col)=>db.prepare(`PRAGMA table_info(${table})`).all().some(x=>x.name===col);
const addCol=(table,col,definition)=>{if(!hasCol(table,col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${definition}`)};
db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, game TEXT NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL, desc TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'available', account_data TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, name TEXT DEFAULT '', balance INTEGER NOT NULL DEFAULT 0, is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, type TEXT NOT NULL, product_id INTEGER, user_id INTEGER, customer TEXT DEFAULT '', amount INTEGER DEFAULT 0, card_type TEXT, card_value INTEGER, card_code TEXT, card_serial TEXT, receive TEXT, game TEXT, uid TEXT, withdraw_bank TEXT, withdraw_number TEXT, withdraw_owner TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(product_id) REFERENCES products(id), FOREIGN KEY(user_id) REFERENCES users(id));
`);
// Migrate older databases so registration/login keep working after redeploys.
addCol('users','name',"TEXT DEFAULT ''");
addCol('users','balance',"INTEGER NOT NULL DEFAULT 0");
addCol('users','is_admin',"INTEGER NOT NULL DEFAULT 0");
addCol('users','created_at',"TEXT DEFAULT ''");
addCol('products','desc',"TEXT DEFAULT ''");
addCol('products','status',"TEXT NOT NULL DEFAULT 'available'");
addCol('products','account_data',"TEXT DEFAULT ''");
addCol('products','created_at',"TEXT DEFAULT ''");
addCol('orders','user_id','INTEGER');
addCol('orders','withdraw_bank','TEXT');
addCol('orders','withdraw_number','TEXT');
addCol('orders','withdraw_owner','TEXT');

const defaults={rate:80,bank:{name:'MB Bank',number:'0123456789',owner:'NGUYEN GAME STORE',content:'NGS + mã đơn'},cardRates:{Viettel:80,Vinaphone:80,Mobifone:80,Garena:85,Zing:85},topups:{'Free Fire':3,'Liên Quân':3,'PUBG Mobile':2,Roblox:2},support:[]};
for(const [k,v] of Object.entries(defaults)) db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)').run(k,JSON.stringify(v));
const getSetting=k=>JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value ?? 'null');
const setSetting=(k,v)=>db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,JSON.stringify(v));
const hash=p=>crypto.scryptSync(String(p), 'ngs-salt-v1', 64).toString('hex');
const verify=(p,h)=>crypto.timingSafeEqual(Buffer.from(hash(p),'hex'),Buffer.from(h,'hex'));
if(!db.prepare('SELECT id FROM users WHERE username=?').get(ADMIN_USERNAME)) db.prepare('INSERT INTO users(username,password_hash,name,is_admin) VALUES (?,?,?,1)').run(ADMIN_USERNAME,hash(ADMIN_PASSWORD),'Administrator');
else db.prepare('UPDATE users SET is_admin=1 WHERE username=?').run(ADMIN_USERNAME);
if(db.prepare('SELECT COUNT(*) c FROM products').get().c===0){const ins=db.prepare('INSERT INTO products(game,name,price,desc,account_data) VALUES (?,?,?,?,?)');ins.run('Free Fire','Acc Rank cao + nhiều skin',250000,'Acc mẫu — thay thông tin bằng acc thật.','');ins.run('Liên Quân','Acc nhiều tướng',350000,'Acc mẫu — thay thông tin bằng acc thật.','');ins.run('PUBG Mobile','Acc nhiều skin',450000,'Acc mẫu — thay thông tin bằng acc thật.','');}
const makeId=()=>crypto.randomUUID();
const userSessions=new Map();const adminSessions=new Set();
const userAuth=(req,res,next)=>{const t=(req.headers.authorization||'').replace('Bearer ','');const uid=userSessions.get(t);if(!uid)return res.status(401).json({error:'Vui lòng đăng nhập'});req.user=db.prepare('SELECT * FROM users WHERE id=?').get(uid);if(!req.user)return res.status(401).json({error:'Tài khoản không tồn tại'});next()};
const adminAuth=(req,res,next)=>{const t=(req.headers['x-admin-token']||'');if(!adminSessions.has(t))return res.status(401).json({error:'Chỉ admin mới được truy cập'});next()};
app.use(helmet({contentSecurityPolicy:false}));app.use(express.json({limit:'100kb'}));app.use(rateLimit({windowMs:60000,max:120,standardHeaders:true,legacyHeaders:false}));app.use(express.static(path.join(__dirname,'public')));
app.get('/api/health',(req,res)=>res.json({ok:true,service:'nguyengamestore'}));
app.get('/api/config',(req,res)=>res.json({rate:getSetting('rate'),bank:getSetting('bank'),cardRates:getSetting('cardRates'),topups:getSetting('topups'),support:getSetting('support')||[]}));
app.get('/api/products',(req,res)=>res.json(db.prepare("SELECT id,game,name,price,desc,status FROM products WHERE status='available' ORDER BY id DESC").all()));
app.post('/api/register',(req,res)=>{
  const {username,password,name=''}=req.body||{};
  const cleanUser=String(username||'').trim();
  const cleanName=String(name||'').trim().slice(0,60);
  if(!/^[a-zA-Z0-9_]{3,24}$/.test(cleanUser)||String(password||'').length<6) return res.status(400).json({error:'Tên tài khoản 3-24 ký tự và mật khẩu tối thiểu 6 ký tự'});
  try{
    // Username không được trùng, kể cả khác chữ hoa/chữ thường (ví dụ nguyen2008 và NGUYEN2008).
    const existed=db.prepare('SELECT id FROM users WHERE lower(username)=lower(?)').get(cleanUser);
    if(existed) return res.status(409).json({error:'Tên tài khoản đã tồn tại'});
    const r=db.prepare('INSERT INTO users(username,password_hash,name) VALUES (?,?,?)').run(cleanUser,hash(password),cleanName);
    const token=crypto.randomBytes(32).toString('hex');
    userSessions.set(token,Number(r.lastInsertRowid));
    res.json({token});
  }catch(e){
    console.error('REGISTER_ERROR',e);
    if(e?.code==='SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/i.test(String(e?.message||''))) return res.status(409).json({error:'Tên tài khoản đã tồn tại'});
    return res.status(500).json({error:'Máy chủ không thể tạo tài khoản. Hãy thử lại sau.'});
  }
});
app.post('/api/login',(req,res)=>{const u=db.prepare('SELECT * FROM users WHERE username=?').get(req.body?.username||'');if(!u||!verify(req.body?.password||'',u.password_hash))return res.status(401).json({error:'Sai tài khoản hoặc mật khẩu'});const token=crypto.randomBytes(32).toString('hex');userSessions.set(token,u.id);res.json({token});});
app.get('/api/me',userAuth,(req,res)=>res.json({id:req.user.id,username:req.user.username,name:req.user.name,balance:req.user.balance,is_admin:!!req.user.is_admin}));
app.post('/api/logout',userAuth,(req,res)=>{const t=(req.headers.authorization||'').replace('Bearer ','');userSessions.delete(t);res.json({ok:true})});
app.post('/api/admin/login',(req,res)=>{const u=db.prepare('SELECT * FROM users WHERE username=? AND is_admin=1').get(ADMIN_USERNAME);if(!u||req.body?.password!==ADMIN_PASSWORD)return res.status(401).json({error:'Sai mật khẩu admin'});const token=crypto.randomBytes(32).toString('hex');adminSessions.add(token);res.json({token});});
app.get('/api/admin/products',adminAuth,(req,res)=>res.json(db.prepare('SELECT * FROM products ORDER BY id DESC').all()));
app.post('/api/admin/products',adminAuth,(req,res)=>{const {game,name,price,desc='',account_data=''}=req.body;if(!game||!name||!Number.isFinite(+price))return res.status(400).json({error:'Dữ liệu không hợp lệ'});const r=db.prepare('INSERT INTO products(game,name,price,desc,account_data) VALUES (?,?,?,?,?)').run(game,name,+price,desc,account_data);res.json({id:r.lastInsertRowid});});
app.delete('/api/admin/products/:id',adminAuth,(req,res)=>{db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);res.json({ok:true})});
app.get('/api/admin/users',adminAuth,(req,res)=>res.json(db.prepare('SELECT id,username,name,balance,is_admin,created_at FROM users ORDER BY id DESC').all()));
app.post('/api/admin/users/:id/balance',adminAuth,(req,res)=>{const amount=Number(req.body?.balance);if(!Number.isSafeInteger(amount)||amount<0)return res.status(400).json({error:'Số dư phải là số nguyên không âm'});const r=db.prepare('UPDATE users SET balance=? WHERE id=?').run(amount,req.params.id);if(!r.changes)return res.status(404).json({error:'Không tìm thấy tài khoản'});res.json({ok:true,balance:amount})});
app.get('/api/admin/orders',adminAuth,(req,res)=>res.json(db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all()));
app.post('/api/admin/settings',adminAuth,(req,res)=>{for(const k of ['rate','bank','cardRates','topups','support'])if(req.body[k]!==undefined)setSetting(k,req.body[k]);res.json({ok:true})});
app.post('/api/admin/orders/:id/approve-card',adminAuth,(req,res)=>{const tx=db.transaction(()=>{const o=db.prepare("SELECT * FROM orders WHERE id=? AND type='card' AND status='pending'").get(req.params.id);if(!o)throw new Error('Đơn không hợp lệ');const rates=getSetting('cardRates')||{};const rate=Number(rates[o.card_type]??getSetting('rate')??0);const credit=Math.round(Number(o.card_value)*rate/100);db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(credit,o.user_id);db.prepare("UPDATE orders SET status='done',amount=? WHERE id=?").run(credit,o.id);return credit;});try{res.json({ok:true,credit:tx()})}catch(e){res.status(400).json({error:e.message})}});
app.post('/api/admin/orders/:id/status',adminAuth,(req,res)=>{const s=req.body?.status;if(!['pending','done','rejected'].includes(s))return res.status(400).json({error:'Status không hợp lệ'});db.prepare('UPDATE orders SET status=? WHERE id=?').run(s,req.params.id);res.json({ok:true})});
app.post('/api/orders/card',userAuth,(req,res)=>{const {type,value,code,serial}=req.body;if(!type||!value||!code||!serial)return res.status(400).json({error:'Thiếu thông tin'});const id=makeId();db.prepare('INSERT INTO orders(id,type,user_id,card_type,card_value,card_code,card_serial,status) VALUES (?,?,?,?,?,?,?,?)').run(id,'card',req.user.id,type,+value,code,serial,'pending');res.json({id,status:'pending'});});
app.post('/api/orders/bank',userAuth,(req,res)=>{const {amount}=req.body;if(!amount||amount<1000)return res.status(400).json({error:'Số tiền không hợp lệ'});const id=makeId();db.prepare('INSERT INTO orders(id,type,user_id,amount,status) VALUES (?,?,?,?,?)').run(id,'bank',req.user.id,+amount,'pending');res.json({id,status:'pending'});});
app.post('/api/orders/topup',userAuth,(req,res)=>{const {game,value,uid}=req.body;if(!game||!value||!uid)return res.status(400).json({error:'Thiếu thông tin'});const rates=getSetting('topups')||{};const rate=+rates[game]||0;const pay=Math.round(+value*(100-rate)/100);if(req.user.balance<pay)return res.status(400).json({error:'Số dư không đủ'});const tx=db.transaction(()=>{db.prepare('UPDATE users SET balance=balance-? WHERE id=?').run(pay,req.user.id);const id=makeId();db.prepare('INSERT INTO orders(id,type,user_id,amount,game,uid,status) VALUES (?,?,?,?,?,?,?)').run(id,'topup',req.user.id,pay,game,uid,'pending');return id})();res.json({id:tx,pay,rate,status:'pending'});});
app.post('/api/orders/withdraw',userAuth,(req,res)=>{const {bank,number,owner,amount}=req.body;if(!bank||!number||!owner||!amount||amount<1000)return res.status(400).json({error:'Thông tin rút tiền không hợp lệ'});const tx=db.transaction(()=>{const u=db.prepare('SELECT balance FROM users WHERE id=?').get(req.user.id);if(u.balance<amount)throw new Error('Số dư không đủ');db.prepare('UPDATE users SET balance=balance-? WHERE id=?').run(+amount,req.user.id);const id=makeId();db.prepare('INSERT INTO orders(id,type,user_id,amount,withdraw_bank,withdraw_number,withdraw_owner,status) VALUES (?,?,?,?,?,?,?,?)').run(id,'withdraw',req.user.id,+amount,bank,number,owner,'pending');return id})();try{res.json({id:tx,status:'pending'})}catch(e){res.status(400).json({error:e.message})}});
app.post('/api/orders/buy',userAuth,(req,res)=>{const {productId}=req.body;const tx=db.transaction(()=>{const p=db.prepare("SELECT * FROM products WHERE id=? AND status='available'").get(productId);if(!p)throw new Error('ACC không còn bán');const id=makeId();db.prepare('INSERT INTO orders(id,type,user_id,product_id,amount,status) VALUES (?,?,?,?,?,?)').run(id,'buy',req.user.id,p.id,p.price,'pending');db.prepare("UPDATE products SET status='sold' WHERE id=?").run(p.id);return {id,p:{id:p.id,game:p.game,name:p.name,price:p.price,account_data:p.account_data}}});try{res.json(tx())}catch(e){res.status(409).json({error:e.message})}});
app.get('/', (req, res) => {
res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, function(){
  console.log('NGUYENGAMESTORE running on http://localhost:' + PORT);
});
