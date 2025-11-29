#  Inventory monitor for a custom-designed website

A robust, dockerized Node.js application to monitor  stock availability with session reuse, global cooldown, and multi-channel notifications.

## Features

*   **Session Reuse**: Minimizes login requests to prevent IP bans.
*   **Global Cooldown**: Prevents spam notification (defaults to 10 mins).
*   **Auto Discovery**: Automatically detects new products on the page.
*   **Log Rotation**: Keeps logs clean (7 days retention).
*   **Notifications**: Supports SMTP (Email) and Telegram.
*   **Dockerized**: Ready for 1Panel or any Docker environment.

## Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `SITE_USERNAME` | (Required) Website Email | - |
| `SITE_PASSWORD` | (Required) Website Password | - |
| `SMTP_ENABLED` | Enable Email | `false` |
| `SMTP_HOST` | SMTP Host | `smtp.qq.com` |
| `SMTP_PORT` | SMTP Port | `587` |
| `SMTP_USER` | SMTP Email Address | - |
| `SMTP_PASS` | SMTP Auth Code | - |
| `TG_ENABLED` | Enable Telegram | `false` |
| `TG_BOT_TOKEN` | Telegram Bot Token | - |
| `TG_CHAT_ID` | Telegram Chat ID | - |

## Deployment (Docker Compose)

1. Create a `docker-compose.yml` file:

```yaml
version: '3'
services:
  monitor:
    image: yourusername/vps-inventory-monitor-prince:latest
    container_name: vps_monitor
    restart: unless-stopped
    environment:
      - SITE_USERNAME=your@email.com
      - SITE_PASSWORD=yourpassword
      - SMTP_ENABLED=true
      - SMTP_USER=your@email.com
      - SMTP_PASS=yourcode
      - SMTP_RECEIVER=receiver@email.com
      - TG_ENABLED=true
      - TG_BOT_TOKEN=yourtoken
      - TG_CHAT_ID=yourid
    volumes:
      - ./logs:/app/logs
      - ./data:/app/data
