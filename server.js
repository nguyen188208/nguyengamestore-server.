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
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, type TEXT NOT NULL, product_id INTEGER, user_id INTEGER, customer TEXT DEFAULT '', amount INTEGER DEFAULT 0, card_type TEXT, card_value INTEGER, card_code TEXT, card_serial TEXT, receive TEXT, game TEXT, uid TEXT, coupon_code TEXT, discount INTEGER DEFAULT 0, withdraw_bank TEXT, withdraw_number TEXT, withdraw_owner TEXT, withdraw_fee INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(product_id) REFERENCES products(id), FOREIGN KEY(user_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS coupons (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE COLLATE NOCASE NOT NULL, percent INTEGER NOT NULL, max_uses INTEGER NOT NULL DEFAULT 0, used_count INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
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
addCol('orders','coupon_code','TEXT');
addCol('orders','discount','INTEGER DEFAULT 0');
addCol('orders','withdraw_fee','INTEGER DEFAULT 0');

const defaults={rate:20,bank:{name:'MB Bank',number:'0123456789',owner:'NGUYEN GAME STORE',content:'NGS + mã đơn'},cardRates:{Viettel:20,Vinaphone:20,Mobifone:20,Garena:15,Zing:15},cardRateMode:'discount',topups:{'Free Fire (Kim cương xong ngay)':5,'Nạp Sò':5,'Delta Force':5,'Liên Quân Mobile (Thẻ Garena)':5,'Quân Huy Liên Quân (xong ngay, chỉ nạp TK FB, Google)':5,'Nạp Roblox (nhận RB ngay)':5,'Robux 120h':5,'Thẻ tuần & tháng (Free Fire)':5,'FIFA Online':5,'PUBG Mobile VN':5,'Liên Minh Huyền Thoại: Tốc Chiến':5,'Liên Minh Huyền Thoại PC':5,'Valorant':5,'Đấu Trường Chân Lý':5,'Cái Thế Tranh Hùng':5},withdrawFee:5000,support:[]};
for(const [k,v] of Object.entries(defaults)) db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)').run(k,JSON.stringify(v));
const getSetting=k=>JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value ?? 'null');
const setSetting=(k,v)=>db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,JSON.stringify(v));
const cardRateMode=getSetting('cardRateMode'); if(cardRateMode===null){const oldRates=getSetting('cardRates')||defaults.cardRates; const migrated={}; for(const [k,v] of Object.entries(oldRates)) migrated[k]=Math.max(0,Math.min(100,100-Number(v)||0)); setSetting('cardRates',migrated); setSetting('cardRateMode','discount');}
const currentTopups=getSetting('topups')||{}; let topupsChanged=false; for(const k of Object.keys(currentTopups)){if(k==='Liên Quân'||k==='Robux chính hãng'||k==='120h') {delete currentTopups[k]; topupsChanged=true}} for(const [k,v] of Object.entries(defaults.topups)){if(currentTopups[k]===undefined){currentTopups[k]=v;topupsChanged=true}} if(topupsChanged)setSetting('topups',currentTopups); if(getSetting('withdrawFee')===null)setSetting('withdrawFee',defaults.withdrawFee);
const hash=p=>crypto.scryptSync(String(p), 'ngs-salt-v1', 64).toString('hex');
const verify=(p,h)=>crypto.timingSafeEqual(Buffer.from(hash(p),'hex'),Buffer.from(h,'hex'));
const adminUser = db.prepare('SELECT id FROM users WHERE lower(username)=lower(?)').get(ADMIN_USERNAME);
if(!adminUser) db.prepare('INSERT INTO users(username,password_hash,name,is_admin) VALUES (?,?,?,1)').run(ADMIN_USERNAME,hash(ADMIN_PASSWORD),'Administrator');
else db.prepare('UPDATE users SET is_admin=1, password_hash=? WHERE id=?').run(hash(ADMIN_PASSWORD),adminUser.id);
if(db.prepare('SELECT COUNT(*) c FROM products').get().c===0){const ins=db.prepare('INSERT INTO products(game,name,price,desc,account_data) VALUES (?,?,?,?,?)');ins.run('Free Fire','Acc Rank cao + nhiều skin',250000,'Acc mẫu — thay thông tin bằng acc thật.','');ins.run('Liên Quân','Acc nhiều tướng',350000,'Acc mẫu — thay thông tin bằng acc thật.','');ins.run('PUBG Mobile','Acc nhiều skin',450000,'Acc mẫu — thay thông tin bằng acc thật.','');}
const makeId=()=>crypto.randomUUID();
const userSessions=new Map();const adminSessions=new Set();
const userAuth=(req,res,next)=>{const t=(req.headers.authorization||'').replace('Bearer ','');const uid=userSessions.get(t);if(!uid)return res.status(401).json({error:'Vui lòng đăng nhập'});req.user=db.prepare('SELECT * FROM users WHERE id=?').get(uid);if(!req.user)return res.status(401).json({error:'Tài khoản không tồn tại'});next()};
const adminAuth=(req,res,next)=>{
  const t=(req.headers['x-admin-token']||'');
  if(adminSessions.has(t)) return next();
  const bearer=(req.headers.authorization||'').replace('Bearer ','');
  const uid=userSessions.get(bearer);
  if(!uid) return res.status(401).json({error:'Vui lòng đăng nhập tài khoản quản trị'});
  const u=db.prepare('SELECT id,is_admin FROM users WHERE id=?').get(uid);
  if(!u?.is_admin) return res.status(403).json({error:'Chỉ tài khoản quản trị mới được truy cập'});
  req.user=u;
  next();
};
app.use(helmet({contentSecurityPolicy:false}));app.use(express.json({limit:'100kb'}));app.use(rateLimit({windowMs:60000,max:120,standardHeaders:true,legacyHeaders:false}));app.use(express.static(path.join(__dirname,'public')));
app.get('/api/health',(req,res)=>res.json({ok:true,service:'nguyengamestore'}));
app.get('/api/config',(req,res)=>res.json({rate:getSetting('rate'),bank:getSetting('bank'),cardRates:getSetting('cardRates'),topups:getSetting('topups'),withdrawFee:Number(getSetting('withdrawFee')||0),support:getSetting('support')||[]}));
app.get('/api/products',(req,res)=>res.json(db.prepare("SELECT id,game,name,price,desc,status FROM products WHERE status='available' ORDER BY id DESC").all()));
app.get('/api/coupons/:code',userAuth,(req,res)=>{
  const code=String(req.params.code||'').trim().toUpperCase();
  const c=db.prepare('SELECT code,percent,max_uses,used_count,active FROM coupons WHERE lower(code)=lower(?)').get(code);
  if(!c||!c.active||(c.max_uses>0&&c.used_count>=c.max_uses)) return res.status(404).json({error:'Mã giảm giá không hợp lệ hoặc đã hết lượt'});
  res.json({code:c.code,percent:c.percent});
});
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
app.post('/api/login',(req,res)=>{
  const username=String(req.body?.username||'').trim();
  const u=db.prepare('SELECT * FROM users WHERE lower(username)=lower(?)').get(username);
  if(!u||!verify(req.body?.password||'',u.password_hash)) return res.status(401).json({error:'Sai tài khoản hoặc mật khẩu'});
  const token=crypto.randomBytes(32).toString('hex');
  userSessions.set(token,u.id);
  res.json({token});
});
app.get('/api/me',userAuth,(req,res)=>res.json({id:req.user.id,username:req.user.username,name:req.user.name,balance:req.user.balance,is_admin:!!req.user.is_admin}));
app.post('/api/logout',userAuth,(req,res)=>{const t=(req.headers.authorization||'').replace('Bearer ','');userSessions.delete(t);res.json({ok:true})});
app.post('/api/admin/login',(req,res)=>{
  const u=db.prepare('SELECT * FROM users WHERE lower(username)=lower(?) AND is_admin=1').get(ADMIN_USERNAME);
  if(!u||req.body?.password!==ADMIN_PASSWORD)return res.status(401).json({error:'Sai mật khẩu admin'});
  const token=crypto.randomBytes(32).toString('hex');
  adminSessions.add(token);
  res.json({token});
});
app.get('/api/orders/history',userAuth,(req,res)=>{
  const rows=db.prepare(`SELECT o.id,o.type,o.amount,o.card_type,o.card_value,o.game,o.uid,o.discount,o.status,o.created_at,o.product_id,p.game product_game,p.name product_name
    FROM orders o LEFT JOIN products p ON p.id=o.product_id WHERE o.user_id=? ORDER BY o.created_at DESC`).all(req.user.id);
  res.json(rows);
});
app.get('/api/orders/deposit-history',userAuth,(req,res)=>{
  const rows=db.prepare(`SELECT id,type,amount,card_type,card_value,status,created_at FROM orders WHERE user_id=? AND type IN ('card','bank') ORDER BY created_at DESC`).all(req.user.id);
  res.json(rows);
});
app.get('/api/orders/history/:id/account',userAuth,(req,res)=>{
  const o=db.prepare(`SELECT o.id,o.type,o.status,o.product_id,o.created_at,p.game,p.name,p.account_data FROM orders o LEFT JOIN products p ON p.id=o.product_id WHERE o.id=? AND o.user_id=? AND o.type='buy'`).get(req.params.id,req.user.id);
  if(!o)return res.status(404).json({error:'Không tìm thấy đơn hàng'});
  if(o.status!=='done')return res.status(403).json({error:'Đơn hàng chưa hoàn tất'});
  res.json({id:o.id,game:o.game,name:o.name,account_data:o.account_data||''});
});
app.get('/api/admin/products',adminAuth,(req,res)=>res.json(db.prepare('SELECT * FROM products ORDER BY id DESC').all()));
app.post('/api/admin/products',adminAuth,(req,res)=>{const {game,name,price,desc='',account_data=''}=req.body;if(!game||!name||!Number.isFinite(+price)||+price<0)return res.status(400).json({error:'Dữ liệu không hợp lệ'});const r=db.prepare('INSERT INTO products(game,name,price,desc,account_data) VALUES (?,?,?,?,?)').run(String(game).trim(),String(name).trim(),Math.round(+price),String(desc||''),String(account_data||''));res.json({id:r.lastInsertRowid});});
app.put('/api/admin/products/:id',adminAuth,(req,res)=>{const {game,name,price,desc='',account_data='',status='available'}=req.body;if(!game||!name||!Number.isFinite(+price)||!['available','sold'].includes(status))return res.status(400).json({error:'Dữ liệu không hợp lệ'});const r=db.prepare('UPDATE products SET game=?,name=?,price=?,desc=?,account_data=?,status=? WHERE id=?').run(String(game).trim(),String(name).trim(),Math.round(+price),String(desc||''),String(account_data||''),status,req.params.id);if(!r.changes)return res.status(404).json({error:'Không tìm thấy acc'});res.json({ok:true})});
app.delete('/api/admin/products/:id',adminAuth,(req,res)=>{db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);res.json({ok:true})});
app.get('/api/admin/users',adminAuth,(req,res)=>{
  const q=String(req.query?.q||'').trim();
  if(q) return res.json(db.prepare('SELECT id,username,name,balance,is_admin,created_at FROM users WHERE username LIKE ? COLLATE NOCASE ORDER BY is_admin DESC, id DESC').all('%'+q+'%'));
  res.json(db.prepare('SELECT id,username,name,balance,is_admin,created_at FROM users ORDER BY is_admin DESC, id DESC').all());
});
app.post('/api/admin/users/:id/balance',adminAuth,(req,res)=>{const amount=Number(req.body?.balance);if(!Number.isSafeInteger(amount)||amount<0)return res.status(400).json({error:'Số dư phải là số nguyên không âm'});const r=db.prepare('UPDATE users SET balance=? WHERE id=?').run(amount,req.params.id);if(!r.changes)return res.status(404).json({error:'Không tìm thấy tài khoản'});res.json({ok:true,balance:amount})});
app.put('/api/admin/users/:id',adminAuth,(req,res)=>{const u=db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);if(!u)return res.status(404).json({error:'Không tìm thấy tài khoản'});const name=String(req.body?.name??u.name??'').trim().slice(0,60);const password=String(req.body?.password??'');if(password&&password.length<6)return res.status(400).json({error:'Mật khẩu mới tối thiểu 6 ký tự'});if(password)db.prepare('UPDATE users SET name=?, password_hash=? WHERE id=?').run(name,hash(password),u.id);else db.prepare('UPDATE users SET name=? WHERE id=?').run(name,u.id);res.json({ok:true})});
app.get('/api/admin/orders',adminAuth,(req,res)=>{
  const q=String(req.query?.q||'').trim();
  const like='%'+q+'%';
  const sql=`SELECT o.*, u.username AS customer_username, u.name AS customer_name, u.balance AS customer_balance, p.game AS product_game, p.name AS product_name
             FROM orders o
             LEFT JOIN users u ON u.id=o.user_id
             LEFT JOIN products p ON p.id=o.product_id
             ${q?'WHERE o.id LIKE ? OR u.username LIKE ? OR u.name LIKE ? OR o.customer LIKE ?':''}
             ORDER BY o.created_at DESC`;
  const rows=q?db.prepare(sql).all(like,like,like,like):db.prepare(sql).all();
  res.json(rows.map(o=>({...o,customer:o.customer_username||o.customer||'',customer_name:o.customer_name||'',customer_balance:o.customer_balance??null})));
});
app.get('/api/admin/orders/:id',adminAuth,(req,res)=>{
  const o=db.prepare(`SELECT o.*, u.username AS customer_username, u.name AS customer_name, u.balance AS customer_balance,
    u.created_at AS customer_created_at, p.game AS product_game, p.name AS product_name, p.price AS product_price, p.account_data AS product_account_data
    FROM orders o LEFT JOIN users u ON u.id=o.user_id LEFT JOIN products p ON p.id=o.product_id WHERE o.id=?`).get(req.params.id);
  if(!o)return res.status(404).json({error:'Không tìm thấy đơn hàng'});
  res.json({...o,customer:o.customer_username||o.customer||'',customer_name:o.customer_name||'',customer_balance:o.customer_balance??null});
});
app.put('/api/admin/orders/:id',adminAuth,(req,res)=>{
  const old=db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if(!old)return res.status(404).json({error:'Không tìm thấy đơn hàng'});
  const allowedStatus=['pending','done','rejected'];
  const b=req.body||{};
  const status=allowedStatus.includes(String(b.status||old.status))?String(b.status||old.status):null;
  if(!status)return res.status(400).json({error:'Trạng thái không hợp lệ'});
  const amount=Number(b.amount ?? old.amount ?? 0);
  const discount=Number(b.discount ?? old.discount ?? 0);
  if(!Number.isSafeInteger(amount)||amount<0||!Number.isSafeInteger(discount)||discount<0)return res.status(400).json({error:'Số tiền hoặc giảm giá không hợp lệ'});
  db.prepare(`UPDATE orders SET customer=?, amount=?, card_type=?, card_value=?, card_code=?, card_serial=?, receive=?, game=?, uid=?, coupon_code=?, discount=?, withdraw_bank=?, withdraw_number=?, withdraw_owner=?, withdraw_fee=?, status=? WHERE id=?`)
    .run(String(b.customer??old.customer??'').trim().slice(0,120),amount,
      b.card_type??old.card_type??null,b.card_value===''?null:(b.card_value??old.card_value??null),
      b.card_code??old.card_code??null,b.card_serial??old.card_serial??null,b.receive??old.receive??null,
      b.game??old.game??null,b.uid??old.uid??null,b.coupon_code??old.coupon_code??null,discount,
      b.withdraw_bank??old.withdraw_bank??null,b.withdraw_number??old.withdraw_number??null,b.withdraw_owner??old.withdraw_owner??null,Number(b.withdraw_fee??old.withdraw_fee??0),status,req.params.id);
  res.json({ok:true});
});
app.delete('/api/admin/orders/:id',adminAuth,(req,res)=>{
  const r=db.prepare('DELETE FROM orders WHERE id=?').run(req.params.id);
  if(!r.changes)return res.status(404).json({error:'Không tìm thấy đơn hàng'});
  res.json({ok:true});
});
app.post('/api/admin/settings',adminAuth,(req,res)=>{for(const k of ['rate','bank','cardRates','topups','withdrawFee','support'])if(req.body[k]!==undefined)setSetting(k,k==='withdrawFee'?Math.max(0,Math.round(Number(req.body[k])||0)):req.body[k]);res.json({ok:true})});
app.get('/api/admin/coupons',adminAuth,(req,res)=>res.json(db.prepare('SELECT * FROM coupons ORDER BY id DESC').all()));
app.post('/api/admin/coupons',adminAuth,(req,res)=>{const code=String(req.body?.code||'').trim().toUpperCase();const percent=Number(req.body?.percent);const maxUses=Number(req.body?.max_uses||0);if(!/^[A-Z0-9_-]{3,40}$/.test(code)||!Number.isInteger(percent)||percent<1||percent>100||!Number.isInteger(maxUses)||maxUses<0)return res.status(400).json({error:'Mã hoặc phần trăm giảm giá không hợp lệ'});try{const r=db.prepare('INSERT INTO coupons(code,percent,max_uses,active) VALUES (?,?,?,1)').run(code,percent,maxUses);res.json({id:r.lastInsertRowid})}catch(e){if(e?.code==='SQLITE_CONSTRAINT_UNIQUE')return res.status(409).json({error:'Mã giảm giá đã tồn tại'});res.status(500).json({error:'Không thể tạo mã giảm giá'})}});
app.delete('/api/admin/coupons/:id',adminAuth,(req,res)=>{db.prepare('DELETE FROM coupons WHERE id=?').run(req.params.id);res.json({ok:true})});
app.post('/api/admin/orders/:id/approve-card',adminAuth,(req,res)=>{const tx=db.transaction(()=>{const o=db.prepare("SELECT * FROM orders WHERE id=? AND type='card' AND status='pending'").get(req.params.id);if(!o)throw new Error('Đơn không hợp lệ');const rates=getSetting('cardRates')||{};const discount=Math.max(0,Math.min(100,Number(rates[o.card_type]??getSetting('rate')??0)));const credit=Math.round(Number(o.card_value)*(100-discount)/100);db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(credit,o.user_id);db.prepare("UPDATE orders SET status='done',amount=? WHERE id=?").run(credit,o.id);return credit;});try{res.json({ok:true,credit:tx()})}catch(e){res.status(400).json({error:e.message})}});
app.post('/api/admin/orders/:id/status',adminAuth,(req,res)=>{const s=req.body?.status;if(!['pending','done','rejected'].includes(s))return res.status(400).json({error:'Status không hợp lệ'});db.prepare('UPDATE orders SET status=? WHERE id=?').run(s,req.params.id);res.json({ok:true})});
app.post('/api/orders/card',userAuth,(req,res)=>{const {type,value,code,serial}=req.body;if(!type||!value||!code||!serial)return res.status(400).json({error:'Thiếu thông tin'});const id=makeId();db.prepare('INSERT INTO orders(id,type,user_id,card_type,card_value,card_code,card_serial,status) VALUES (?,?,?,?,?,?,?,?)').run(id,'card',req.user.id,type,+value,code,serial,'pending');res.json({id,status:'pending'});});
app.post('/api/orders/bank',userAuth,(req,res)=>{const {amount}=req.body;if(!amount||amount<1000)return res.status(400).json({error:'Số tiền không hợp lệ'});const id=makeId();db.prepare('INSERT INTO orders(id,type,user_id,amount,status) VALUES (?,?,?,?,?)').run(id,'bank',req.user.id,+amount,'pending');res.json({id,status:'pending'});});
app.post('/api/orders/topup',userAuth,(req,res)=>{const {game,value,uid,gameLogin='',gameAccount='',serverLink=''}=req.body;if(!game||!value||!uid)return res.status(400).json({error:'Thiếu thông tin'});const rates=getSetting('topups')||{};const rate=+rates[game]||0;const basePay=Math.round(+value*(100-rate)/100);const login=String(gameLogin||'').trim();const fee=(game==='Robux 120h'&&login)?8000:0;const pay=basePay+fee;if(req.user.balance<pay)return res.status(400).json({error:'Số dư không đủ'});const finalUid=[String(uid||'').trim(),game==='Robux 120h'&&gameAccount?`Tài khoản game: ${String(gameAccount).trim()}`:'',game==='Robux 120h'&&serverLink?`Link SVV: ${String(serverLink).trim()}`:'',game==='Robux 120h'&&login?`TK/MK: ${login}`:''].filter(Boolean).join('\n');const tx=db.transaction(()=>{db.prepare('UPDATE users SET balance=balance-? WHERE id=?').run(pay,req.user.id);const id=makeId();db.prepare('INSERT INTO orders(id,type,user_id,amount,game,uid,status) VALUES (?,?,?,?,?,?,?)').run(id,'topup',req.user.id,pay,game,finalUid,'pending');return id})();res.json({id:tx,pay,basePay,fee,rate,status:'pending'});});
app.post('/api/orders/withdraw',userAuth,(req,res)=>{const {bank,number,owner,amount}=req.body;const requested=Math.round(Number(amount));const fee=Math.max(0,Math.round(Number(getSetting('withdrawFee')||0)));const total=requested+fee;if(!bank||!number||!owner||!Number.isSafeInteger(requested)||requested<1000)return res.status(400).json({error:'Thông tin rút tiền không hợp lệ'});try{const result=db.transaction(()=>{const u=db.prepare('SELECT balance FROM users WHERE id=?').get(req.user.id);if(!u||u.balance<total)throw new Error(`Số dư không đủ. Cần ${total.toLocaleString('vi-VN')}đ gồm phí ${fee.toLocaleString('vi-VN')}đ`);db.prepare('UPDATE users SET balance=balance-? WHERE id=?').run(total,req.user.id);const id=makeId();db.prepare('INSERT INTO orders(id,type,user_id,amount,withdraw_bank,withdraw_number,withdraw_owner,withdraw_fee,status) VALUES (?,?,?,?,?,?,?,?,?)').run(id,'withdraw',req.user.id,requested,bank,number,owner,fee,'pending');return {id,amount:requested,fee,total,balance:u.balance-total,status:'pending'};})();res.json(result)}catch(e){res.status(400).json({error:e.message})}});
app.post('/api/orders/buy/quote',userAuth,(req,res)=>{
  const productId=Number(req.body?.productId);
  const p=db.prepare("SELECT id,game,name,price,desc FROM products WHERE id=? AND status='available'").get(productId);
  if(!p)return res.status(404).json({error:'ACC không còn bán'});
  const raw=String(req.body?.coupon||'').trim().toUpperCase();
  let coupon=null,discount=0;
  if(raw){coupon=db.prepare('SELECT code,percent,max_uses,used_count,active FROM coupons WHERE lower(code)=lower(?)').get(raw);if(!coupon||!coupon.active||(coupon.max_uses>0&&coupon.used_count>=coupon.max_uses))return res.status(400).json({error:'Mã giảm giá không hợp lệ hoặc đã hết lượt'});discount=Math.floor(p.price*coupon.percent/100);}
  const total=p.price-discount;
  res.json({product:p,coupon:coupon?{code:coupon.code,percent:coupon.percent}:null,discount,total,balance:req.user.balance,canBuy:req.user.balance>=total});
});
app.post('/api/orders/buy/confirm',userAuth,(req,res)=>{
  const productId=Number(req.body?.productId);
  const raw=String(req.body?.coupon||'').trim().toUpperCase();
  try{
    const result=db.transaction(()=>{
      const p=db.prepare("SELECT * FROM products WHERE id=? AND status='available'").get(productId);
      if(!p)throw new Error('ACC không còn bán');
      let coupon=null,discount=0;
      if(raw){coupon=db.prepare('SELECT * FROM coupons WHERE lower(code)=lower(?)').get(raw);if(!coupon||!coupon.active||(coupon.max_uses>0&&coupon.used_count>=coupon.max_uses))throw new Error('Mã giảm giá không hợp lệ hoặc đã hết lượt');discount=Math.floor(p.price*coupon.percent/100);}
      const total=p.price-discount;
      const u=db.prepare('SELECT balance FROM users WHERE id=?').get(req.user.id);
      if(!u||u.balance<total)throw new Error('Số dư không đủ');
      const id=makeId();
      db.prepare('UPDATE users SET balance=balance-? WHERE id=?').run(total,req.user.id);
      db.prepare("UPDATE products SET status='sold' WHERE id=?").run(p.id);
      if(coupon)db.prepare('UPDATE coupons SET used_count=used_count+1 WHERE id=?').run(coupon.id);
      db.prepare('INSERT INTO orders(id,type,user_id,product_id,amount,coupon_code,discount,receive,status) VALUES (?,?,?,?,?,?,?,?,?)').run(id,'buy',req.user.id,p.id,total,coupon?.code||null,discount,p.account_data||'','done');
      return {id,game:p.game,name:p.name,price:p.price,discount,total,balance:u.balance-total};
    })();
    res.json(result);
  }catch(e){res.status(409).json({error:e.message})}
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, function(){
  console.log('NGUYENGAMESTORE running on http://localhost:' + PORT);
});
