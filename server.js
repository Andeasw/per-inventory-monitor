/**
 * PerMonitorH v1.0.0 (Stable Encryption & Enhanced Web)
 * Author: Prince 2025.12
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const dotenv = require('dotenv');

// ============================================================================
// 🔐 1. 稳定版自动加密模块 (STABLE AUTO-VAULT)
// ============================================================================
(function stableSecurity() {
    const envFile = path.join(__dirname, '.env');
    const encFile = path.join(__dirname, '.env.enc');
    const keyFile = path.join(__dirname, '.secret.key'); // 密钥文件

    // A. 加密流程: 有 .env -> 生成随机密钥 -> 加密 -> 删 .env
    if (fs.existsSync(envFile)) {
        console.log('🔐 正在执行首次加密...');
        try {
            // 1. 生成 32字节 随机密钥
            const masterKey = crypto.randomBytes(32).toString('hex');
            
            // 2. 加密内容
            const text = fs.readFileSync(envFile, 'utf8');
            const iv = crypto.randomBytes(16);
            const keyBuffer = Buffer.from(masterKey, 'hex');
            const cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, iv);
            let encrypted = cipher.update(text, 'utf8', 'hex');
            encrypted += cipher.final('hex');

            // 3. 保存
            fs.writeFileSync(keyFile, masterKey); // 保存密钥
            fs.writeFileSync(encFile, iv.toString('hex') + ':' + encrypted); // 保存密文
            fs.unlinkSync(envFile); // 销毁明文

            console.log('✅ 加密成功！明文已销毁，密钥已保存至 .secret.key');
        } catch (e) { console.error('❌ 加密失败:', e.message); process.exit(1); }
    }

    // B. 解密流程: 读取 .secret.key -> 解密 .env.enc
    if (fs.existsSync(encFile)) {
        if (!fs.existsSync(keyFile)) {
            console.error('❌ 启动失败: 找不到密钥文件 [.secret.key]。');
            console.error('💡 解决: 请删除 .env.enc，重新创建 .env 文件。');
            process.exit(1);
        }
        try {
            const masterKey = fs.readFileSync(keyFile, 'utf8').trim();
            const content = fs.readFileSync(encFile, 'utf8').split(':');
            const iv = Buffer.from(content[0], 'hex');
            const encryptedText = content[1];
            const keyBuffer = Buffer.from(masterKey, 'hex');
            
            const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, iv);
            let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            
            // 注入环境变量
            const conf = dotenv.parse(decrypted);
            for (const k in conf) process.env[k] = conf[k];
            
        } catch (e) { 
            console.error('❌ 解密失败: 密钥不匹配或文件损坏。请重置配置。'); 
            process.exit(1); 
        }
    } else {
        console.error('❌ 未找到配置文件。请新建 .env 文件。');
        process.exit(1);
    }
})();

// ============================================================================
// 📦 核心依赖加载
// ============================================================================
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const nodemailer = require('nodemailer');

// 配置映射
const CFG = {
    SITE: {
        URL: process.env.SITE_URL,
        NAME: process.env.SITE_NAME || 'Monitor',
        LOGIN: process.env.LOGIN_REQUIRED === 'true',
        LOGIN_URL: process.env.LOGIN_URL,
        USER: process.env.SITE_USER,
        PASS: process.env.SITE_PASS
    },
    STRATEGY: {
        INTERVAL: parseInt(process.env.CHECK_INTERVAL) || 40000,
        GAP: parseInt(process.env.NOTIFY_GAP) || 600000,
        REPORT_HR: parseInt(process.env.DAILY_REPORT_TIME),
        RESTOCK_NOTIFY: process.env.RESTOCK_NOTIFY !== 'false',
        TEST: process.env.SEND_TEST === 'true',
        PORT: parseInt(process.env.PORT) || 3000,
        LOG: path.join(__dirname, 'monitor.log'),
        STATE: path.join(__dirname, 'state.json')
    },
    SMTP: {
        OPEN: process.env.SMTP_ENABLED === 'true',
        HOST: process.env.SMTP_HOST,
        PORT: parseInt(process.env.SMTP_PORT),
        SECURE: process.env.SMTP_SECURE === 'true',
        USER: process.env.SMTP_USER,
        PASS: process.env.SMTP_PASS,
        TO: process.env.SMTP_RECEIVER
    },
    TG: {
        OPEN: process.env.TG_ENABLED === 'true',
        TOKEN: process.env.TG_BOT_TOKEN,
        ID: process.env.TG_CHAT_ID
    },
    SEL: { BOX: '.card.cartitem', NAME: 'h4', TEXT: 'p.card-text' }
};
if (isNaN(CFG.STRATEGY.REPORT_HR)) CFG.STRATEGY.REPORT_HR = 12;

// ============================================================================
// 🔵 基础设施
// ============================================================================
const app = express();
const SESSION = { cookie: null, lastLogin: 0 };
const WEB = { items: [], logs: [], lastCheck: '-', status: 'INIT' };
const api = axios.create({ timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } });
const mailer = CFG.SMTP.OPEN ? nodemailer.createTransport({
    host: CFG.SMTP.HOST, port: CFG.SMTP.PORT, secure: CFG.SMTP.SECURE,
    auth: { user: CFG.SMTP.USER, pass: CFG.SMTP.PASS }, tls: { rejectUnauthorized: false }
}) : null;

const time = () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

function log(tag, msg) {
    const s = `[${time()}] [${tag}] ${msg}`;
    console.log(s);
    WEB.logs.unshift(s);
    if (WEB.logs.length > 100) WEB.logs.pop(); // Web保留100条
    try { fs.appendFileSync(CFG.STRATEGY.LOG, s + '\n'); } catch (e) {}
}

// ============================================================================
// 🟣 通知系统
// ============================================================================
async function notify(title, type, data = []) {
    log('Notify', `>>> Sending: ${title}`);
    let tg = `🔔 *${title}*\n\n`;
    let html = `<div style="border:1px solid #ccc;padding:15px;border-radius:5px"><h3>${title}</h3><hr>`;
    
    if (type === 'RESTOCK') {
        data.forEach(i => {
            tg += `📦 \`${i.name}\`: *${i.count}*\n`;
            html += `<p>📦 <b>${i.name}</b>: <span style="color:green;font-weight:bold">${i.count}</span></p>`;
        });
        tg += `\n⚡️ [Link](${CFG.SITE.URL})`;
        html += `<a href="${CFG.SITE.URL}" style="background:red;color:white;padding:10px;text-decoration:none">立即抢购</a>`;
    } else {
        tg += `❌ All items sold out.`;
        html += `<p style="color:red">全部售罄。</p>`;
    }
    tg += `\n🕒 ${time()}`;
    html += `<p style="color:#999;font-size:12px">${time()}</p></div>`;

    const p = [];
    if (CFG.TG.OPEN) p.push(api.post(`https://api.telegram.org/bot${CFG.TG.TOKEN}/sendMessage`, { chat_id: CFG.TG.ID, text: tg, parse_mode: 'Markdown', disable_web_page_preview: true }).catch(e => log('TG', e.message)));
    if (CFG.SMTP.OPEN && mailer) p.push(mailer.sendMail({ from: `"Monitor" <${CFG.SMTP.USER}>`, to: CFG.SMTP.TO, subject: title, html }).catch(e => log('Email', e.message)));
    await Promise.all(p);
}

// ============================================================================
// 🟠 核心逻辑
// ============================================================================
async function login() {
    if (!CFG.SITE.LOGIN) return true;
    try {
        const res = await api.post(CFG.SITE.LOGIN_URL, `username=${encodeURIComponent(CFG.SITE.USER)}&password=${encodeURIComponent(CFG.SITE.PASS)}`);
        if (res.headers['set-cookie']) {
            SESSION.cookie = res.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
            SESSION.lastLogin = Date.now();
            log('Auth', 'Session Refreshed');
            return true;
        }
        return false;
    } catch (e) { return false; }
}

async function check() {
    if (CFG.SITE.LOGIN && (!SESSION.cookie || Date.now() - SESSION.lastLogin > 86400000)) await login();
    try {
        let headers = CFG.SITE.LOGIN ? { Cookie: SESSION.cookie } : {};
        let res = await api.get(CFG.SITE.URL, { headers });
        let $ = cheerio.load(res.data);

        if (CFG.SITE.LOGIN && $(CFG.SEL.BOX).length === 0 && await login()) {
            res = await api.get(CFG.SITE.URL, { headers: { Cookie: SESSION.cookie } });
            $ = cheerio.load(res.data);
        }

        const items = [];
        $(CFG.SEL.BOX).each((_, el) => {
            const name = $(el).find(CFG.SEL.NAME).text().trim();
            const match = $(el).find(CFG.SEL.TEXT).text().match(/[:：(]?\s*(\d+)/);
            if (name && match) items.push({ name, count: parseInt(match[1]) });
        });

        if (items.length === 0) {
            WEB.status = 'ERROR';
            return;
        }

        let state = { lastNotify: 0, wasInStock: false, lastDaily: '' };
        try { if (fs.existsSync(CFG.STRATEGY.STATE)) state = JSON.parse(fs.readFileSync(CFG.STRATEGY.STATE)); } catch (e) {}

        const inStock = items.filter(i => i.count > 0);
        const hasStock = inStock.length > 0;
        const now = Date.now();
        
        WEB.items = inStock;
        WEB.lastCheck = time();
        WEB.status = hasStock ? 'RESTOCK' : 'SOLDOUT';
        log('Audit', `Scan: ${items.map(i => `${i.name}(${i.count})`).join(', ')}`);

        if (hasStock) {
            if (!state.wasInStock || (now - state.lastNotify > CFG.STRATEGY.GAP)) {
                if (CFG.STRATEGY.RESTOCK_NOTIFY) await notify(`🟢 ${CFG.SITE.NAME} Restock`, 'RESTOCK', inStock);
                state.lastNotify = now;
                state.wasInStock = true;
            }
        } else {
            if (state.wasInStock) {
                await notify(`🔴 ${CFG.SITE.NAME} Sold Out`, 'SOLDOUT');
                state.wasInStock = false;
                state.lastNotify = 0;
            }
        }

        const bjDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
        if (CFG.STRATEGY.REPORT_HR !== -1 && bjDate.getHours() === CFG.STRATEGY.REPORT_HR && state.lastDaily !== bjDate.toDateString()) {
            await notify(`📋 ${CFG.SITE.NAME} Daily`, 'RESTOCK', [{name:'Status', count: hasStock?'Available':'Empty'}]);
            state.lastDaily = bjDate.toDateString();
        }

        fs.writeFileSync(CFG.STRATEGY.STATE, JSON.stringify(state));
    } catch (e) { 
        log('Error', e.message); 
        WEB.status = 'ERROR';
    }
}

// ============================================================================
// 🌐 Web UI (修复显示问题)
// ============================================================================
app.get('/api/data', (req, res) => res.json({ ...WEB, interval: CFG.STRATEGY.INTERVAL }));
app.get('/', (req, res) => res.send(`
<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Monitor</title>
<link id="fav" rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🛡️</text></svg>">
<style>
body{font-family:sans-serif;margin:0;padding:20px;background:#f0f2f5;transition:0.3s}
.card{background:#fff;padding:20px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1);max-width:800px;margin:0 auto}
.head{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
.status{padding:15px;border-radius:8px;text-align:center;font-weight:bold;font-size:1.2em;margin-bottom:20px}
.s-ok{background:#e3f2fd;color:#1565c0}
.s-alert{background:#c62828;color:#fff;animation:pulse 0.8s infinite}
.s-err{background:#ffe0b2;color:#e65100}
.item{padding:12px;border-bottom:1px solid #eee;display:flex;justify-content:space-between}
.cnt{color:#2e7d32;font-weight:bold}
.log{background:#1e1e1e;color:#a9b7c6;padding:15px;height:300px;overflow-y:auto;font-size:12px;white-space:pre-wrap;border-radius:8px}
.btn{width:100%;padding:15px;background:#ff9800;color:white;border:none;border-radius:8px;font-size:1.2em;cursor:pointer;margin-bottom:20px;display:none}
@keyframes pulse{0%{opacity:1}50%{opacity:0.6}} .flash{background:#ffcdd2}
</style></head><body>
<div class="card">
    <div class="head"><h2>🛡️ PerMonitorH</h2><small id="t">Loading...</small></div>
    <button id="btn" class="btn" onclick="stop()">🔕 停止报警</button>
    <div id="box" class="status s-ok">正在连接...</div>
    <h3>📦 实时库存</h3><div id="list"></div>
    <h3>📜 运行日志</h3><div id="logs" class="log"></div>
</div>
<script>
let alarm=false, tm=null;
const okI="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🛡️</text></svg>";
const alI="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🔴</text></svg>";
const snd=new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg');

function stop(){ alarm=false; document.getElementById('btn').style.display='none'; document.body.className=''; document.getElementById('box').className='status s-ok'; resetT(); }
function flashT(){ if(tm)return; let s=false; tm=setInterval(()=>{ document.title=s?"【有货!!!】":"【快抢!!!】"; document.getElementById('fav').href=s?alI:okI; s=!s; },500); }
function resetT(){ clearInterval(tm); tm=null; document.title="PerMonitorH"; document.getElementById('fav').href=okI; }

function load(){
    fetch('/api/data').then(r=>r.json()).then(d=>{
        document.getElementById('t').innerText = d.lastCheck;
        const box = document.getElementById('box');
        
        if(d.status === 'ERROR') {
            box.className = 'status s-err'; box.innerText = '⚠️ 抓取失败/登录失效';
        } else if(d.items.length > 0) {
            if(!alarm && document.getElementById('btn').style.display==='none') alarm=true;
            if(alarm){
                document.body.className='flash'; box.className='status s-alert'; 
                box.innerText=\`🚨 发现 \${d.items.length} 个资源！\`; 
                document.getElementById('btn').style.display='block'; 
                flashT(); snd.play().catch(()=>{});
            } else {
                box.className='status s-ok'; box.style.background='#d4edda'; box.style.color='#155724'; box.innerText='✅ 发现资源 (已确认)';
            }
        } else {
            alarm=false; document.body.className=''; document.getElementById('btn').style.display='none'; 
            box.className='status s-ok'; box.style.background='#e3f2fd'; box.style.color='#1565c0'; box.innerText='✅ 监控中 - 无货'; resetT();
        }
        
        document.getElementById('list').innerHTML = d.items.length ? d.items.map(i=>\`<div class="item"><span>\${i.name}</span><span class="cnt">\${i.count}</span></div>\`).join('') : '<div style="text-align:center;color:#999;padding:10px">无库存</div>';
        document.getElementById('logs').innerText = d.logs.join('\\n');
    }).catch(e=>{ document.getElementById('box').innerText='服务器连接断开'; document.getElementById('box').className='status s-err'; });
}
setInterval(load, ${CFG.STRATEGY.INTERVAL}); load();
</script></body></html>`));

// Start
app.listen(CFG.STRATEGY.PORT, async () => {
    console.log(`[System] Web UI: http://localhost:${CFG.STRATEGY.PORT}`);
    if (CFG.SMTP.OPEN) try { await mailer.verify(); log('SMTP', '✅ OK'); } catch (e) { log('SMTP', e.message); }
    if (CFG.STRATEGY.TEST) await notify(`🔵 ${CFG.SITE.NAME} Start`, 'RESTOCK', [{name:'Test', count:1}]);
    check(); setInterval(check, CFG.STRATEGY.INTERVAL);
});
