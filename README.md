# PerMonitorH

A lightweight, Node.js-based inventory monitor for WHMCS template sites. Features automated stock checking, email/Telegram notifications, and a real-time web dashboard.

## Environment Variables (`.env`)

Create a `.env` file in the root directory to configure the application.

### 1. Target Website (Required)

| Variable | Description | Example |
| :--- | :--- | :--- |
| `SITE_URL` | The URL of the page to monitor (e.g., cart/inventory page). | `https://site.com/cart` |
| `SITE_NAME` | Custom name for notifications. | `MyProvider` |
| `LOGIN_REQUIRED` | Set to `true` if login is required to view stock. | `false` |
| `LOGIN_URL` | The login submission URL (POST). Required if `LOGIN_REQUIRED=true`. | `https://site.com/login` |
| `SITE_USER` | Login username/email. | `user@email.com` |
| `SITE_PASS` | Login password. | `password123` |

### 2. Strategy & System (Optional)

| Variable | Description | Default |
| :--- | :--- | :--- |
| `CHECK_INTERVAL` | Interval between checks in milliseconds. | `40000` (40s) |
| `NOTIFY_GAP` | Cooldown period for restock notifications (ms). | `600000` (10m) |
| `DAILY_REPORT_TIME`| Hour to send daily report (0-23). | `12` |
| `SEND_TEST` | Send a test notification on startup (`true`/`false`). | `true` |
| `RESTOCK_NOTIFY` | Enable/Disable restock alerts (`true`/`false`). | `true` |
| `PORT` | Web dashboard port. | `3000` |

### 3. Notifications (Optional)

**SMTP (Email)**
| Variable | Description |
| :--- | :--- |
| `SMTP_ENABLED` | Set to `true` to enable. |
| `SMTP_HOST` | SMTP server host (e.g., `smtp.qq.com`). |
| `SMTP_PORT` | SMTP port (usually `587` or `465`). |
| `SMTP_SECURE` | `false` for port 587, `true` for 465. |
| `SMTP_USER` | SMTP username / sender email. |
| `SMTP_PASS` | SMTP password / app password. |
| `SMTP_RECEIVER` | Recipient email address. |

**Telegram**
| Variable | Description |
| :--- | :--- |
| `TG_ENABLED` | Set to `true` to enable. |
| `TG_BOT_TOKEN` | Telegram Bot Token. |
| `TG_CHAT_ID` | Telegram Chat ID. |

---

## Security Note

Upon first launch, the application will automatically **encrypt** your `.env` file into `.env.enc` and delete the plain text file. A `.secret.key` file will be generated for decryption. Keep this key file safe.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Create .env file
# (Paste variables from above)

# 3. Start
node server.js
```
