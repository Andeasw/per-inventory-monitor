/**
 * PerMonitorH v1.0.0
 * Author: Prince
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const dotenv = require('dotenv');

// ============================================================================
// 🔐 1. 自动加密
// ============================================================================
(function autoSecurity() {
    const env = path.join(__dirname, '.env');
    const enc = path.join(__dirname, '.env.enc');
    const key = path.join(__dirname, '.secret.key');

    if (fs.existsSync(env)) {
        try {
            const k = crypto.randomBytes(32);
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv('aes-256-cbc', k, iv);
            let e = cipher.update(fs.readFileSync(env, 'utf8'), 'utf8', 'hex');
            e += cipher.final('hex');
            fs.writeFileSync(enc, iv.toString('hex') + ':' + e);
            fs.writeFileSync(key, k.toString('hex'));
            fs.unlinkSync(env);
            console.log('✅ 配置已加密。');
        } catch (e) { console.error('❌ 加密失败', e); process.exit(1); }
    }

    if (fs.existsSync(enc) && fs.existsSync(key)) {
        try {
            const k = Buffer.from(fs.readFileSync(key, 'utf8'), 'hex');
            const p = fs.readFileSync(enc, 'utf8').split(':');
            const d = crypto.createDecipheriv('aes-256-cbc', k, Buffer.from(p[0], 'hex'));
            let t = d.update(p[1], 'hex', 'utf8');
            t += d.final('utf8');
            const c = dotenv.parse(t);
            for (const x in c) process.env[x] = c[x];
        } catch (e) { console.error('❌ 解密失败。'); process.exit(1); }
    } else { console.error('❌ 找不到配置文件。'); process.exit(1); }
})();

// ============================================================================
// 📦 核心程序
// ============================================================================
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const nodemailer = require('nodemailer');

const CFG = {
    SITE: {
        URL: process.env.SITE_URL,
        NAME: process.env.SITE_NAME,
        LOGIN: process.env.LOGIN_REQUIRED === 'true',
        LOGIN_URL: process.env.LOGIN_URL,
        USER: process.env.SITE_USER,
        PASS: process.env.SITE_PASS
    },
    APP: {
        INTERVAL: parseInt(process.env.CHECK_INTERVAL) || 40000,
        GAP: parseInt(process.env.NOTIFY_GAP) || 600000,
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

const app = express();
const SESSION = { cookie: null, lastLogin: 0 };
const WEB = { items: [], logs: [], lastCheck: '-' };
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
    if (WEB.logs.length > 100) WEB.logs.pop();
    try { fs.appendFileSync(CFG.APP.LOG, s + '\n'); } catch (e) {}
}

// ============================================================================
// 🟣 通知系统
// ============================================================================
async function notify(title, type, data = []) {
    log('Notify', `>>> Sending: ${title}`);
    let color = type === 'RESTOCK' ? '#28a745' : '#dc3545';
    
    let tg = `🔔 *${title}*\n\n`;
    if (type === 'RESTOCK') {
        data.forEach(i => tg += `📦 \`${i.name}\`: *${i.count}*\n`);
        tg += `\n⚡️ [立即前往](${CFG.SITE.URL})`;
    } else tg += `❌ 已全部售罄。`;
    tg += `\n🕒 ${time()}`;

    let html = `<div style="border:1px solid #eee;padding:20px;border-radius:8px">
        <h2 style="color:${color}">${title}</h2><p>${time()}</p><hr>`;
    if (type === 'RESTOCK') {
        html += `<ul>`;
        data.forEach(i => html += `<li><b>${i.name}</b>: <span style="color:green;font-weight:bold">${i.count}</span></li>`);
        html += `</ul><br><a href="${CFG.SITE.URL}" style="background:${color};color:#fff;padding:10px 20px;text-decoration:none">Go</a>`;
    } else html += `<p style="color:red">Sold Out</p>`;
    html += `</div>`;

    const p = [];
    if (CFG.TG.OPEN) p.push(api.post(`https://api.telegram.org/bot${CFG.TG.TOKEN}/sendMessage`, { chat_id: CFG.TG.ID, text: tg, parse_mode: 'Markdown', disable_web_page_preview: true }).catch(e => log('TG', e.message)));
    if (CFG.SMTP.OPEN && mailer) p.push(mailer.sendMail({ from: `"Monitor" <${CFG.SMTP.USER}>`, to: CFG.SMTP.TO, subject: title, html }).catch(e => log('Email', e.message)));
    await Promise.all(p);
}

// ============================================================================
// 🟠 监控逻辑 (核心修正版)
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

        if (items.length === 0) return;

        let state = { lastNotify: 0, wasInStock: false };
        try { if (fs.existsSync(CFG.APP.STATE)) state = JSON.parse(fs.readFileSync(CFG.APP.STATE)); } catch (e) {}

        const inStock = items.filter(i => i.count > 0);
        const hasStock = inStock.length > 0;
        const now = Date.now();
        
        WEB.items = inStock;
        WEB.lastCheck = time();
        log('Audit', `Scan: ${items.map(i => `${i.name}(${i.count})`).join(', ')}`);

        // --- 逻辑修正：严格状态翻转 (Strict Flip-Flop) ---
        if (hasStock) {
            // 场景: 0 -> 1 (补货)
            // 只有当"之前状态是无货"时，才触发通知
            if (!state.wasInStock) {
                // 冷却检查: 防止短时间内反复 0->1->0->1 造成的刷屏
                if (now - state.lastNotify > CFG.APP.GAP) {
                    await notify(`🟢 ${CFG.SITE.NAME} 补货通知`, 'RESTOCK', inStock);
                    state.lastNotify = now;
                    state.wasInStock = true;
                } else {
                    log('Limit', 'Restock detected but inside cooldown gap. Notification skipped.');
                    // 这里保持 wasInStock = false，以便冷却结束后能再次尝试触发
                }
            } else {
                // 场景: 1 -> 1 (持续有货)
                // 之前有货，现在也有货 -> 绝对静默
                // log('Logic', 'Stock persists. Silent.');
                state.wasInStock = true;
            }
        } else {
            // 场景: 1 -> 0 (售罄)
            // 只有当"之前状态是有货"时，才触发通知
            if (state.wasInStock) {
                await notify(`🔴 ${CFG.SITE.NAME} 已售罄`, 'SOLDOUT');
                state.wasInStock = false;
                // 售罄不更新 lastNotify，确保下一次补货能立即触发
            }
        }

        fs.writeFileSync(CFG.APP.STATE, JSON.stringify(state));
    } catch (e) { log('Error', e.message); }
}

// ============================================================================
// 🌐 Web Interface (Smart Visual)
// ============================================================================
app.get('/api/data', (req, res) => res.json({ ...WEB, interval: CFG.APP.INTERVAL }));
app.get('/', (req, res) => res.send(`
<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Monitor</title>
<link id="fav" rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🛡️</text></svg>">
<style>
body{font-family:sans-serif;margin:0;padding:20px;background:#f8f9fa;color:#333;transition:0.3s}
.card{background:#fff;padding:25px;border-radius:12px;box-shadow:0 4px 15px rgba(0,0,0,0.05);max-width:800px;margin:0 auto}
.header{display:flex;justify-content:space-between;align-items:center}
.status{padding:20px;border-radius:8px;text-align:center;font-weight:bold;font-size:1.5em;margin:20px 0}
.s-ok{background:#e3f2fd;color:#1565c0}
.s-alert{background:#c62828;color:#fff;animation:pulse 0.5s infinite}
.item{padding:15px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;font-size:1.2em}
.cnt{color:#28a745;font-weight:bold}
.log{background:#1e1e1e;color:#82aaff;padding:15px;height:250px;overflow-y:auto;font-size:12px;white-space:pre-wrap;border-radius:8px;font-family:monospace}
.btn{width:100%;padding:15px;background:#ff9800;color:white;border:none;border-radius:8px;font-size:1.2em;cursor:pointer;display:none}
@keyframes pulse{0%{opacity:1}50%{opacity:0.8}} .flash-bg{background:#ffcdd2}
</style></head><body>
<div class="card">
    <div class="header"><h2>🛡️ PerMonitorH</h2><small id="t">-</small></div>
    <button id="btn" class="btn" onclick="stop()">🔕 停止声音</button>
    <div id="box" class="status s-ok">连接中...</div>
    <h3>📦 实时库存</h3><div id="list"></div><h3>📜 日志</h3><div id="logs" class="log"></div>
</div>
<script>
let alarm=false, lastHash='', colorIdx=0;
const colors=['#28a745','#ff9800','#2196f3','#9c27b0'];
const okI="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🛡️</text></svg>";
const snd=new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg');

function getIcon(color) {
    return \`data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><circle cx=%2250%22 cy=%2250%22 r=%2250%22 fill=%22\${encodeURIComponent(color)}%22/></svg>\`;
}

function stop(){ alarm=false; document.getElementById('btn').style.display='none'; }

function updateIcon(isChange) {
    if(isChange) colorIdx = (colorIdx + 1) % colors.length;
    document.getElementById('fav').href = getIcon(colors[colorIdx]);
}

function load(){
    fetch('/api/data').then(r=>r.json()).then(d=>{
        document.getElementById('t').innerText=d.lastCheck;
        const box=document.getElementById('box'), list=document.getElementById('list');
        const currentHash = JSON.stringify(d.items);
        
        if(d.items.length>0){
            box.className='status s-alert';
            box.innerText=\`🚨 发现 \${d.items.length} 个资源！\`;
            
            if(currentHash !== lastHash) updateIcon(true);
            else updateIcon(false);
            
            if(!alarm && document.getElementById('btn').style.display==='none') alarm=true;
            if(alarm){
                document.getElementById('btn').style.display='block';
                snd.play().catch(()=>{});
                document.title = \`【!!! 有货 \${d.items.length} !!!】\`;
            }
        } else {
            alarm=false;
            document.getElementById('btn').style.display='none';
            box.className='status s-ok'; 
            box.innerText='✅ 监控中 - 无货';
            document.title="PerMonitorH";
            document.getElementById('fav').href = okI;
        }
        
        lastHash = currentHash;
        list.innerHTML=d.items.length?d.items.map(i=>\`<div class="item"><span>\${i.name}</span><span class="cnt">\${i.count}</span></div>\`).join(''):'<div style="padding:15px;text-align:center;color:#999">无库存</div>';
        document.getElementById('logs').innerText=d.logs.join('\\n');
    });
}
setInterval(load, ${CFG.APP.INTERVAL}); load();
</script></body></html>`));

app.listen(CFG.APP.PORT, async () => {
    console.log(`[System] Web UI: http://localhost:${CFG.APP.PORT}`);
    if (CFG.SMTP.OPEN) try { await mailer.verify(); log('SMTP', '✅ OK'); } catch (e) { log('SMTP', e.message); }
    if (CFG.APP.TEST) await notify(`🔵 ${CFG.SITE.NAME} Start`, 'RESTOCK', [{name:'Test-Item', count:1}]);
    check(); setInterval(check, CFG.APP.INTERVAL);
});
