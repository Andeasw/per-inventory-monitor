# Template Resource Monitor

[![Docker](https://img.shields.io/badge/Docker-Supported-blue.svg)](https://hub.docker.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Author](https://img.shields.io/badge/Author-Prince-orange.svg)]()

A robust, dockerized Node.js application designed to monitor resource availability on WHMCS-based template websites. Features **Session Reuse**, **Global Cooldown**, **Auto-Discovery**, and multi-channel notifications.

---

## ✨ Key Features

*   **Session Persistence**: Reuses login cookies to prevent IP bans and reduce server load (1 login/day).
*   **Global Cooldown**: Intelligent spam prevention. If stock is found, it notifies once and then waits (default 10m) before notifying again.
*   **Auto-Discovery**: Automatically detects new products on the target page without code changes.
*   **Log Rotation**: Built-in log management (7-day retention, 15MB limit) to prevent disk overflow.
*   **UTF-8 Support**: Full support for Chinese characters in notifications and logs.
*   **Docker Ready**: Fully configurable via Environment Variables.

---

## 🚀 Quick Start (Docker Compose)

Create a `docker-compose.yml` file and run `docker-compose up -d`.

```yaml
version: '3'

services:
  monitor:
    image: your_username/template-resource-monitor-prince:latest
    container_name: resource_monitor
    restart: unless-stopped
    environment:
      # --- Target Website Config (Required) ---
      - SITE_LOGIN_URL=https://example.com/login
      - SITE_STOCK_URL=https://example.com/cart
      - SITE_USERNAME=your_email@example.com
      - SITE_PASSWORD=your_password
      
      # --- Strategy Config (Optional) ---
      - CHECK_INTERVAL=60000          # Check every 60s
      - NOTIFY_COOLDOWN=600000        # 10m cooldown after notification
      
      # --- SMTP Notification (Optional) ---
      - SMTP_ENABLED=true
      - SMTP_HOST=smtp.qq.com
      - SMTP_PORT=587
      - SMTP_SECURE=false
      - SMTP_USER=your_email@qq.com
      - SMTP_PASS=your_auth_code
      - SMTP_RECEIVER=receiver@email.com
      
      # --- Telegram Notification (Optional) ---
      - TG_ENABLED=true
      - TG_BOT_TOKEN=123456:ABC-DEF...
      - TG_CHAT_ID=123456789

    volumes:
      - ./logs:/app/logs
      - ./data:/app/data
```

---

## ⚙️ Environment Variables

### 1. Target Configuration (Required)

| Variable | Description | Example |
| :--- | :--- | :--- |
| `SITE_LOGIN_URL` | The login page URL (POST target). | `https://site.com/login` |
| `SITE_STOCK_URL` | The page where inventory is displayed. | `https://site.com/cart` |
| `SITE_USERNAME` | Account email/username. | `admin@test.com` |
| `SITE_PASSWORD` | Account password. | `123456` |

### 2. Monitoring Strategy (Optional)

| Variable | Description | Default |
| :--- | :--- | :--- |
| `CHECK_INTERVAL` | Interval between checks (in ms). | `60000` (60s) |
| `NOTIFY_COOLDOWN` | Silence period after a notification (in ms). | `600000` (10m) |
| `DAILY_REPORT_HOUR` | Hour to send daily health report (0-23). | `12` (12:00 PM) |

### 3. Notification - SMTP Email (Optional)

| Variable | Description | Default |
| :--- | :--- | :--- |
| `SMTP_ENABLED` | Enable Email notifications (`true`/`false`). | `false` |
| `SMTP_HOST` | SMTP Server Host. | `smtp.qq.com` |
| `SMTP_PORT` | SMTP Server Port. | `587` |
| `SMTP_SECURE` | Use SSL? Set `false` for port 587. | `false` |
| `SMTP_USER` | SMTP Username / Email. | - |
| `SMTP_PASS` | SMTP Password / Auth Code. | - |
| `SMTP_RECEIVER` | Email address to receive alerts. | - |

### 4. Notification - Telegram (Optional)

| Variable | Description | Default |
| :--- | :--- | :--- |
| `TG_ENABLED` | Enable Telegram notifications. | `false` |
| `TG_BOT_TOKEN` | Your Bot Token from @BotFather. | - |
| `TG_CHAT_ID` | Your User ID or Channel ID. | - |

### 5. Advanced Selector Config (Optional)

*Only change if the target website template is different.*

| Variable | Description | Default |
| :--- | :--- | :--- |
| `SEL_CARD` | CSS selector for the product card. | `.card.cartitem` |
| `SEL_NAME` | CSS selector for product name inside card. | `h4` |
| `SEL_INVENTORY` | CSS selector for inventory text. | `p.card-text` |

---

## 📂 Volume Mapping

*   `/app/logs`: Stores application logs (rotated daily, 7-day retention).
*   `/app/data`: Stores `monitor_state.json` (cool-down timers and session state).

## 📄 License

MIT License © [Prince]
