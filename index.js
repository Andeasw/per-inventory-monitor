/**
 * Project: VPS Inventory Monitor
 * Author: Prince
 * Version: 1.0.0
 * License: MIT
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const http = require('http');

// ============================================================================
// 1. CONFIGURATION (LOAD FROM ENV)
// ============================================================================

const CONFIG = {
    SITE: {
        LOGIN_URL: process.env.SITE_LOGIN_URL || 'https://cloud.zrvvv.com/login',
        STOCK_URL: process.env.SITE_STOCK_URL || 'https://cloud.zrvvv.com/cart',
        USERNAME: process.env.SITE_USERNAME,
        PASSWORD: process.env.SITE_PASSWORD,
    },
    STRATEGY: {
        CHECK_INTERVAL: parseInt(process.env.CHECK_INTERVAL) || 60000,       // Default: 60s
        NOTIFY_COOLDOWN: parseInt(process.env.NOTIFY_COOLDOWN) || 600000,    // Default: 10m
        DAILY_REPORT_HOUR: parseInt(process.env.DAILY_REPORT_HOUR) || 12,    // Default: 12:00 CST
        COOKIE_MAX_AGE: 86400000 // 24 Hours
    },
    SMTP: {
        ENABLED: process.env.SMTP_ENABLED === 'true',
        HOST: process.env.SMTP_HOST || 'smtp.qq.com',
        PORT: parseInt(process.env.SMTP_PORT) || 587,
        SECURE: process.env.SMTP_SECURE === 'true',
        AUTH: {
            USER: process.env.SMTP_USER,
            PASS: process.env.SMTP_PASS
        },
        RECEIVER: process.env.SMTP_RECEIVER
    },
    TELEGRAM: {
        ENABLED: process.env.TG_ENABLED === 'true',
        BOT_TOKEN: process.env.TG_BOT_TOKEN,
        CHAT_ID: process.env.TG_CHAT_ID
    },
    SYSTEM: {
        PORT: 3000,
        LOG_DIR: path.join(__dirname, 'logs'),
        STATE_FILE: path.join(__dirname, 'data', 'monitor_state.json'),
        LOG_RETENTION_DAYS: 7,
        MAX_LOG_SIZE: 15 * 1024 * 1024 // 15MB
    },
    SELECTOR: {
        CARD: '.card.cartitem',
        NAME: 'h4',
        INVENTORY: 'p.card-text'
    }
};

// ============================================================================
// 2. INITIALIZATION
// ============================================================================

// Ensure directories exist
[CONFIG.SYSTEM.LOG_DIR, path.dirname(CONFIG.SYSTEM.STATE_FILE)].forEach(dir => {
    if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
});

// Global Session State
const SESSION = { cookie: null, lastLoginTime: 0 };

// HTTP Client (UTF-8 Enforced)
const api = axios.create({
    timeout: 30000,
    responseEncoding: 'utf8',
    maxRedirects: 5,
    headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9'
    }
});

// Mail Transporter
let mailTransporter = null;
if (CONFIG.SMTP.ENABLED) {
    mailTransporter = nodemailer.createTransport({
        host: CONFIG.SMTP.HOST,
        port: CONFIG.SMTP.PORT,
        secure: CONFIG.SMTP.SECURE,
        auth: { user: CONFIG.SMTP.AUTH.USER, pass: CONFIG.SMTP.AUTH.PASS },
        tls: { rejectUnauthorized: false }
    });
}

// ============================================================================
// 3. LOGGING & UTILS
// ============================================================================

function getBeijingTime() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
}

function log(module, message) {
    const now = getBeijingTime();
    const timeStr = now.toLocaleString('zh-CN', { hour12: false });
    const dateStr = now.toISOString().split('T')[0];
    const logLine = `[${timeStr}] [${module}] ${message}\n`;

    process.stdout.write(logLine);

    try {
        const logFile = path.join(CONFIG.SYSTEM.LOG_DIR, `app-${dateStr}.log`);
        let stats;
        try { stats = fsSync.statSync(logFile); } catch (e) {}
        if (!stats || stats.size < CONFIG.SYSTEM.MAX_LOG_SIZE) {
            fsSync.appendFileSync(logFile, logLine);
        }
    } catch (e) {
        console.error('Log write error:', e.message);
    }
}

async function rotateLogs() {
    try {
        const files = await fs.readdir(CONFIG.SYSTEM.LOG_DIR);
        const now = getBeijingTime().getTime();
        const DAY_MS = 86400000;
        
        for (const file of files) {
            if (!file.endsWith('.log')) continue;
            const filePath = path.join(CONFIG.SYSTEM.LOG_DIR, file);
            const stats = await fs.stat(filePath);
            if ((now - stats.mtimeMs) / DAY_MS > CONFIG.SYSTEM.LOG_RETENTION_DAYS) {
                await fs.unlink(filePath);
            }
        }
    } catch (e) {}
}

// ============================================================================
// 4. CORE LOGIC
// ============================================================================

async function sendNotification(text, subject = 'VPS Notification') {
    log('Notify', `Sending: "${subject}"`);
    const promises = [];

    if (CONFIG.SMTP.ENABLED && mailTransporter) {
        promises.push(mailTransporter.sendMail({
            from: `"VPS Monitor" <${CONFIG.SMTP.AUTH.USER}>`,
            to: CONFIG.SMTP.RECEIVER, subject, text
        }).catch(e => log('Email', `Error: ${e.message}`)));
    }

    if (CONFIG.TELEGRAM.ENABLED) {
        promises.push(axios.post(`https://api.telegram.org/bot${CONFIG.TELEGRAM.BOT_TOKEN}/sendMessage`, {
            chat_id: CONFIG.TELEGRAM.CHAT_ID, text, parse_mode: 'Markdown', disable_web_page_preview: true
        }).catch(e => log('Telegram', `Error: ${e.message}`)));
    }

    await Promise.all(promises);
}

async function performLogin() {
    if (!CONFIG.SITE.USERNAME || !CONFIG.SITE.PASSWORD) {
        log('Auth', 'Missing Credentials in ENV. Please check configuration.');
        return false;
    }
    try {
        const payload = `username=${encodeURIComponent(CONFIG.SITE.USERNAME)}&password=${encodeURIComponent(CONFIG.SITE.PASSWORD)}`;
        const res = await api.post(CONFIG.SITE.LOGIN_URL, payload);
        const cookies = res.headers['set-cookie'];
        if (cookies && cookies.length > 0) {
            SESSION.cookie = cookies.map(c => c.split(';')[0]).join('; ');
            SESSION.lastLoginTime = Date.now();
            log('Auth', 'Session refreshed successfully.');
            return true;
        }
        return false;
    } catch (e) {
        log('Auth', `Login failed: ${e.message}`);
        return false;
    }
}

async function fetchPage() {
    if (!SESSION.cookie || (Date.now() - SESSION.lastLoginTime > CONFIG.STRATEGY.COOKIE_MAX_AGE)) {
        await performLogin();
    }

    try {
        let res = await api.get(CONFIG.SITE.STOCK_URL, { headers: { Cookie: SESSION.cookie } });
        let $ = cheerio.load(res.data, { decodeEntities: true });

        // Retry login if selector not found
        if ($(CONFIG.SELECTOR.CARD).length === 0) {
            log('Network', 'Invalid session, retrying login...');
            if (await performLogin()) {
                res = await api.get(CONFIG.SITE.STOCK_URL, { headers: { Cookie: SESSION.cookie } });
                return cheerio.load(res.data, { decodeEntities: true });
            }
            return null;
        }
        return $;
    } catch (e) {
        log('Network', `Fetch error: ${e.message}`);
        return null;
    }
}

async function runTask() {
    let $ = null;
    let stocks = {};

    try {
        $ = await fetchPage();
        if (!$) return;

        $(CONFIG.SELECTOR.CARD).each(function () {
            const name = $(this).find(CONFIG.SELECTOR.NAME).text().trim();
            const match = $(this).find(`${CONFIG.SELECTOR.INVENTORY}:contains("inventory")`).text().match(/inventory\s*[：:]\s*(\d+)/i);
            if (name && match) stocks[name] = parseInt(match[1]);
        });

        const count = Object.keys(stocks).length;
        if (count === 0) return;

        // Load State
        let state = { lastNotifyTime: 0, lastDailyDate: "" };
        try {
            const data = await fs.readFile(CONFIG.SYSTEM.STATE_FILE, 'utf-8');
            state = { ...state, ...JSON.parse(data) };
        } catch (e) {}

        // Logic Analysis
        const inStockItems = [];
        for (const [name, qty] of Object.entries(stocks)) {
            if (qty > 0) inStockItems.push(`📦 **${name}**: ${qty}`);
        }

        const hasStock = inStockItems.length > 0;
        const now = Date.now();
        const timeSinceNotify = now - state.lastNotifyTime;

        log('Summary', `Scanned ${count} items. In Stock: ${inStockItems.length}`);

        // 1. Stock Notification (Global Cooldown)
        if (hasStock && timeSinceNotify > CONFIG.STRATEGY.NOTIFY_COOLDOWN) {
            log('Notify', 'Stock found. Cooldown passed. Sending alert.');
            const msg = `🟢 **VPS 有货提醒**\n\n${inStockItems.join('\n')}\n\n[👉 立即购买](${CONFIG.SITE.STOCK_URL})`;
            await sendNotification(msg, `发现 ${inStockItems.length} 款 VPS 有货`);
            state.lastNotifyTime = now;
        } else if (hasStock) {
            const wait = Math.ceil((CONFIG.STRATEGY.NOTIFY_COOLDOWN - timeSinceNotify) / 1000);
            log('Notify', `Stock found but in cooldown (${wait}s remaining).`);
        }

        // 2. Daily Report (Beijing Time 12:00)
        const bjNow = getBeijingTime();
        const bjDateStr = bjNow.toISOString().split('T')[0];
        if (bjNow.getHours() === CONFIG.STRATEGY.DAILY_REPORT_HOUR && state.lastDailyDate !== bjDateStr) {
            await rotateLogs();
            // Send report only if not in cooldown
            if (timeSinceNotify > CONFIG.STRATEGY.NOTIFY_COOLDOWN) {
                const report = `📅 **每日运行简报**\n----------------\n✅ 状态: 运行正常\n📦 监控: ${count} 个\n🟢 有货: ${hasStock?'是':'否'}\n🕒 时间: ${bjNow.toLocaleString('zh-CN')}`;
                await sendNotification(report, 'VPS监控每日简报');
            }
            state.lastDailyDate = bjDateStr;
            log('System', 'Daily maintenance done.');
        }

        // Save State
        await fs.writeFile(CONFIG.SYSTEM.STATE_FILE, JSON.stringify(state, null, 2));

    } catch (e) {
        log('Error', `Task Error: ${e.message}`);
    } finally {
        $ = null; stocks = null;
    }
}

// ============================================================================
// SERVICE BOOTSTRAP
// ============================================================================

async function bootstrap() {
    log('System', '>>> By Prince V1.0.0 Starting...');

    // Verify SMTP
    if (CONFIG.SMTP.ENABLED && mailTransporter) {
        try { await mailTransporter.verify(); log('SMTP', '✅ Connected'); } 
        catch (e) { log('SMTP', `❌ Config Error: ${e.message}`); }
    }

    // Self Check
    if (await performLogin()) {
        const $ = await fetchPage();
        if ($) {
            const count = $(CONFIG.SELECTOR.CARD).length;
            log('System', `✅ Init Success. Monitoring ${count} items.`);
            await sendNotification(`🔵 **服务启动成功**\nBy Prince V1.0.0\n监控: ${count} 个\n时区: CST (Beijing)`, 'VPS监控启动');
        }
    } else {
        log('Error', '❌ Login Failed. Check ENV variables.');
    }

    log('System', `Loop started (Interval: ${CONFIG.STRATEGY.CHECK_INTERVAL}ms)`);
    runTask();
    setInterval(runTask, CONFIG.STRATEGY.CHECK_INTERVAL);
}

// HTTP Keep-Alive Server
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`VPS Monitor By Prince Running.\nTime: ${getBeijingTime().toLocaleString()}`);
}).listen(CONFIG.SYSTEM.PORT, () => {
    log('System', `HTTP Server listening on ${CONFIG.SYSTEM.PORT}`);
    bootstrap();
});
