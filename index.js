/**
 * Template Resource Monitor
 * Project: template-resource-monitor-prince
 * Author: Prince
 * Version: 1.0.0
 * Description: Generic inventory monitor with session persistence and global cooldown.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const http = require('http');

// ============================================================================
// CONFIGURATION (ALL FROM ENV)
// ============================================================================

const CONFIG = {
    SITE: {
        // 必须通过环境变量传入，代码中不保留任何默认目标
        LOGIN_URL: process.env.SITE_LOGIN_URL,
        STOCK_URL: process.env.SITE_STOCK_URL,
        USERNAME: process.env.SITE_USERNAME,
        PASSWORD: process.env.SITE_PASSWORD,
    },
    STRATEGY: {
        CHECK_INTERVAL: parseInt(process.env.CHECK_INTERVAL) || 60000,       // 60s
        NOTIFY_COOLDOWN: parseInt(process.env.NOTIFY_COOLDOWN) || 600000,    // 10m
        DAILY_REPORT_HOUR: parseInt(process.env.DAILY_REPORT_HOUR) || 12,    // 12:00
        COOKIE_MAX_AGE: 86400000 // 24 Hours
    },
    SMTP: {
        ENABLED: process.env.SMTP_ENABLED === 'true',
        HOST: process.env.SMTP_HOST,
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
        PORT: 2996,
        LOG_DIR: path.join(__dirname, 'logs'),
        STATE_FILE: path.join(__dirname, 'data', 'monitor_state.json'),
        LOG_RETENTION_DAYS: 7,
        MAX_LOG_SIZE: 15 * 1024 * 1024 // 15MB
    },
    // 默认适配通用 WHMCS 模板选择器，也可通过环境变量覆盖
    SELECTOR: {
        CARD: process.env.SEL_CARD || '.card.cartitem',
        NAME: process.env.SEL_NAME || 'h4',
        INVENTORY: process.env.SEL_INVENTORY || 'p.card-text'
    }
};

// ============================================================================
// INFRASTRUCTURE SETUP
// ============================================================================

// Initialize Directories
[CONFIG.SYSTEM.LOG_DIR, path.dirname(CONFIG.SYSTEM.STATE_FILE)].forEach(dir => {
    if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
});

// Global Session State
const SESSION = { cookie: null, lastLoginTime: 0 };

// Axios Instance (UTF-8 Enforced)
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
if (CONFIG.SMTP.ENABLED && CONFIG.SMTP.HOST) {
    mailTransporter = nodemailer.createTransport({
        host: CONFIG.SMTP.HOST,
        port: CONFIG.SMTP.PORT,
        secure: CONFIG.SMTP.SECURE,
        auth: { user: CONFIG.SMTP.AUTH.USER, pass: CONFIG.SMTP.AUTH.PASS },
        tls: { rejectUnauthorized: false }
    });
}

// ============================================================================
// LOGGING & TIME UTILS
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
        console.error('Logger Error:', e.message);
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
// CORE BUSINESS LOGIC
// ============================================================================

async function sendNotification(text, subject = 'Resource Notification') {
    log('Notify', `Sending: "${subject}"`);
    const promises = [];

    if (CONFIG.SMTP.ENABLED && mailTransporter) {
        promises.push(mailTransporter.sendMail({
            from: `"Resource Monitor" <${CONFIG.SMTP.AUTH.USER}>`,
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
    if (!CONFIG.SITE.LOGIN_URL || !CONFIG.SITE.USERNAME || !CONFIG.SITE.PASSWORD) {
        log('Auth', 'Missing URL or Credentials in Environment Variables.');
        return false;
    }
    try {
        const payload = `username=${encodeURIComponent(CONFIG.SITE.USERNAME)}&password=${encodeURIComponent(CONFIG.SITE.PASSWORD)}`;
        const res = await api.post(CONFIG.SITE.LOGIN_URL, payload);
        const cookies = res.headers['set-cookie'];
        if (cookies && cookies.length > 0) {
            SESSION.cookie = cookies.map(c => c.split(';')[0]).join('; ');
            SESSION.lastLoginTime = Date.now();
            log('Auth', 'Session refreshed.');
            return true;
        }
        return false;
    } catch (e) {
        log('Auth', `Login failed: ${e.message}`);
        return false;
    }
}

async function fetchPage() {
    if (!CONFIG.SITE.STOCK_URL) {
        log('Network', 'Missing STOCK_URL in Environment Variables.');
        return null;
    }

    if (!SESSION.cookie || (Date.now() - SESSION.lastLoginTime > CONFIG.STRATEGY.COOKIE_MAX_AGE)) {
        await performLogin();
    }

    try {
        let res = await api.get(CONFIG.SITE.STOCK_URL, { headers: { Cookie: SESSION.cookie } });
        let $ = cheerio.load(res.data, { decodeEntities: true });

        // Auto Re-login if content invalid (Selector check)
        if ($(CONFIG.SELECTOR.CARD).length === 0) {
            log('Network', 'Invalid content, retrying session...');
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
    let items = {};

    try {
        $ = await fetchPage();
        if (!$) return;

        // Parse Items
        $(CONFIG.SELECTOR.CARD).each(function () {
            const name = $(this).find(CONFIG.SELECTOR.NAME).text().trim();
            const match = $(this).find(`${CONFIG.SELECTOR.INVENTORY}:contains("inventory")`).text().match(/inventory\s*[：:]\s*(\d+)/i);
            if (name && match) items[name] = parseInt(match[1]);
        });

        const count = Object.keys(items).length;
        if (count === 0) return;

        // Load State
        let state = { lastNotifyTime: 0, lastDailyDate: "" };
        try {
            const data = await fs.readFile(CONFIG.SYSTEM.STATE_FILE, 'utf-8');
            state = { ...state, ...JSON.parse(data) };
        } catch (e) {}

        // Check Availability
        const availableList = [];
        for (const [name, qty] of Object.entries(items)) {
            if (qty > 0) availableList.push(`📦 **${name}**: ${qty}`);
        }

        const hasStock = availableList.length > 0;
        const now = Date.now();
        const timeSinceNotify = now - state.lastNotifyTime;

        log('Summary', `Scanned ${count} items. Available: ${availableList.length}`);

        // Logic 1: Stock Notification (Global Cooldown 10m)
        if (hasStock && timeSinceNotify > CONFIG.STRATEGY.NOTIFY_COOLDOWN) {
            log('Notify', 'Availability detected. Sending alert.');
            const msg = `🟢 **资源有货提醒**\n\n${availableList.join('\n')}\n\n🕒 时间: ${getBeijingTime().toLocaleString('zh-CN')}\n[👉 立即查看](${CONFIG.SITE.STOCK_URL})`;
            await sendNotification(msg, `发现 ${availableList.length} 个可用资源`);
            state.lastNotifyTime = now;
        } else if (hasStock) {
            const wait = Math.ceil((CONFIG.STRATEGY.NOTIFY_COOLDOWN - timeSinceNotify) / 1000);
            log('Notify', `Stock found but in cooldown (${wait}s remaining).`);
        }

        // Logic 2: Daily Report
        const bjNow = getBeijingTime();
        const bjDateStr = bjNow.toISOString().split('T')[0];
        if (bjNow.getHours() === CONFIG.STRATEGY.DAILY_REPORT_HOUR && state.lastDailyDate !== bjDateStr) {
            await rotateLogs();
            // Send report if not recently notified
            if (timeSinceNotify > CONFIG.STRATEGY.NOTIFY_COOLDOWN) {
                const report = `📅 **每日运行简报**\n----------------\n✅ 状态: 运行正常\n📦 监控: ${count} 个\n🟢 有货: ${hasStock?'是':'否'}\n🕒 时间: ${bjNow.toLocaleString('zh-CN')}`;
                await sendNotification(report, '监控服务每日简报');
            }
            state.lastDailyDate = bjDateStr;
            log('System', 'Daily maintenance completed.');
        }

        await fs.writeFile(CONFIG.SYSTEM.STATE_FILE, JSON.stringify(state, null, 2));

    } catch (e) {
        log('Error', `Task Error: ${e.message}`);
    } finally {
        $ = null; items = null;
    }
}

// ============================================================================
// SERVICE ENTRY
// ============================================================================

async function bootstrap() {
    log('System', '>>> Template Resource Monitor By Prince Starting...');
    
    // Validate ENV
    if (!CONFIG.SITE.LOGIN_URL || !CONFIG.SITE.STOCK_URL) {
        log('Error', 'CRITICAL: SITE_LOGIN_URL or SITE_STOCK_URL not set.');
        return;
    }

    // Verify SMTP
    if (CONFIG.SMTP.ENABLED && mailTransporter) {
        try { await mailTransporter.verify(); log('SMTP', '✅ Connection Verified'); } 
        catch (e) { log('SMTP', `❌ Connection Error: ${e.message}`); }
    }

    // Self Test
    if (await performLogin()) {
        const $ = await fetchPage();
        if ($) {
            const count = $(CONFIG.SELECTOR.CARD).length;
            log('System', `✅ Self-test passed. Monitoring ${count} targets.`);
            await sendNotification(`🔵 **监控服务启动成功**\nAuthor: Prince\n监控数: ${count}\n时区: Asia/Shanghai`, '监控服务启动');
        }
    } else {
        log('Error', '❌ Initial Login Failed. Check Credentials.');
    }

    log('System', `Service Loop Started (Interval: ${CONFIG.STRATEGY.CHECK_INTERVAL}ms)`);
    runTask();
    setInterval(runTask, CONFIG.STRATEGY.CHECK_INTERVAL);
}

// Health Check Server
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Resource Monitor By Prince Running.\nTime: ${getBeijingTime().toLocaleString()}`);
}).listen(CONFIG.SYSTEM.PORT, () => {
    log('System', `Health Check Port ${CONFIG.SYSTEM.PORT} Listening`);
    bootstrap();
});
