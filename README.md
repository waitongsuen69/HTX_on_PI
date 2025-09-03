# HTX Pi Monitor

A real-time cryptocurrency portfolio monitor designed for Raspberry Pi, featuring touch-optimized UI, LOFO (Lowest-First-Out) cost basis tracking, and P/L calculations.

![HTX Pi Monitor](https://img.shields.io/badge/Status-Production%20Ready-green.svg)
![Node.js](https://img.shields.io/badge/Node.js-v20%2B-brightgreen.svg)
![Platform](https://img.shields.io/badge/Platform-Raspberry%20Pi-red.svg)

## Features

### 🚀 Core Features
- **Real-time Portfolio Monitoring** - Track your HTX balances and values
- **LOFO Cost Basis Tracking** - Accurate P/L calculations using Lowest-First-Out accounting
- **Touch-Optimized Interface** - Designed for Raspberry Pi touchscreens
- **Automatic Data Pulls** - 60-second refresh cycles with error recovery
- **Offline Resilience** - Continues displaying last known data during outages

### 📊 Portfolio Features
- **Live Price Updates** - Real-time pricing from HTX API
- **P/L Calculations** - Profit/Loss tracking with cost basis integration
- **24h Change Tracking** - Portfolio and individual position performance
- **Position Sorting** - Multiple sorting options (value, symbol, change, P/L)
- **Asset Pinning** - Pin important positions to the top
- **Reconciliation Alerts** - Warnings for mismatched balances

### 🎛️ User Interface
- **Kiosk Mode** - Full-screen operation perfect for displays
- **Pull-to-Refresh** - Touch gesture support
- **Dark Theme** - High contrast design for Pi displays
- **Responsive Design** - Works on various screen sizes
- **Settings Panel** - Customizable refresh intervals and preferences
- **Status Indicators** - Connection status and last update time

### 🔧 Technical Features
- **Atomic File Operations** - Power-loss resistant data persistence
- **Memory Efficient** - Optimized for Pi's limited resources (<100MB)
- **Secure API Integration** - HMAC-SHA256 signed requests
- **Comprehensive Logging** - Detailed logs for troubleshooting
- **Health Monitoring** - Built-in health checks and metrics

## Quick Start

### Prerequisites
- Raspberry Pi 3B+ or newer
- Raspberry Pi OS (Bullseye or newer)
- Node.js 20+ installed
- HTX account with API access

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-repo/htx-pi-monitor.git
   cd htx-pi-monitor
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   nano .env
   ```

4. **Set up HTX API credentials** (see [API Setup](#api-setup))

5. **Test the application**
   ```bash
   npm start
   ```

6. **Access the interface**
   ```
   http://localhost:8080
   ```

## Installation Guide

### System Requirements

**Minimum Requirements:**
- Raspberry Pi 3B+ (1GB RAM)
- 8GB MicroSD Card (Class 10)
- Node.js 20.0+
- Network connection

**Recommended Setup:**
- Raspberry Pi 4 (4GB RAM)
- 32GB MicroSD Card (Class 10 or better)
- Official 7" Touchscreen or HDMI display
- Ethernet connection for reliability

### Step-by-Step Installation

#### 1. Prepare Raspberry Pi

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

#### 2. Install HTX Pi Monitor

```bash
# Clone repository
git clone https://github.com/your-repo/htx-pi-monitor.git
cd htx-pi-monitor

# Install dependencies
npm install

# Create data directory
mkdir -p data
```

#### 3. Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Edit configuration
nano .env
```

**Required Environment Variables:**
```bash
# HTX API Credentials
HTX_ACCESS_KEY=your_access_key_here
HTX_SECRET_KEY=your_secret_key_here
HTX_ACCOUNT_ID=your_account_id_here

# Server Configuration
PORT=8080
BIND_ADDR=0.0.0.0
PULL_INTERVAL_MS=60000

# Data Settings
MAX_HISTORY_SNAPSHOTS=50
DATA_DIR=./data
```

#### 4. Test Installation

```bash
# Test the application
npm start

# In another terminal, test the API
curl http://localhost:8080/api/health
```

#### 5. Install as System Service

```bash
# Install systemd service
sudo cp systemd/htx-monitor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable htx-monitor
sudo systemctl start htx-monitor

# Check service status
sudo systemctl status htx-monitor
```

### Kiosk Mode Setup

For full-screen kiosk operation:

```bash
# Run the automated setup script
./scripts/kiosk-setup.sh

# Or follow manual steps below...
```

**Manual Kiosk Configuration:**

1. **Install display packages**
   ```bash
   sudo apt install chromium-browser unclutter xdotool
   ```

2. **Configure auto-login**
   ```bash
   sudo raspi-config
   # Navigate to: Boot Options > Desktop / CLI > Desktop Autologin
   ```

3. **Create startup script**
   ```bash
   mkdir -p ~/.config/autostart
   cat > ~/.config/autostart/htx-kiosk.desktop << EOF
   [Desktop Entry]
   Type=Application
   Name=HTX Monitor Kiosk
   Exec=/home/pi/start-kiosk.sh
   Hidden=false
   NoDisplay=false
   X-GNOME-Autostart-enabled=true
   EOF
   ```

## API Setup

### Getting HTX API Credentials

1. **Log into HTX Account**
   - Visit [HTX](https://www.htx.com/)
   - Navigate to API Management

2. **Create API Key**
   - Generate new API key pair
   - **Important:** Select **READ ONLY** permissions
   - Enable IP whitelist if desired
   - Save Access Key, Secret Key, and Account ID

3. **Configure Permissions**
   - **Required:** Account read access
   - **Required:** Order read access (for balance data)
   - **Not required:** Trading permissions (read-only monitor)

### Security Best Practices

- **Use read-only API keys only**
- **Enable IP whitelisting** if possible
- **Rotate keys regularly**
- **Never commit .env file** to version control
- **Use secure file permissions** (600) for .env

```bash
# Set secure permissions
chmod 600 .env
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP server port |
| `BIND_ADDR` | `0.0.0.0` | Server bind address |
| `HTX_ACCESS_KEY` | - | HTX API access key |
| `HTX_SECRET_KEY` | - | HTX API secret key |
| `HTX_ACCOUNT_ID` | - | HTX account ID |
| `PULL_INTERVAL_MS` | `60000` | Data refresh interval (ms) |
| `MAX_HISTORY_SNAPSHOTS` | `50` | Maximum snapshots to keep |
| `DATA_DIR` | `./data` | Data storage directory |
| `REQUEST_TIMEOUT_MS` | `10000` | API request timeout |
| `MAX_RETRY_ATTEMPTS` | `3` | API retry attempts |

### Feature Flags

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_COST_MANUAL` | `true` | Manual cost basis entry |
| `ENABLE_LOTS_LOFO` | `true` | LOFO accounting |
| `ENABLE_HISTORY_PULL` | `false` | Historical data pulls |
| `ENABLE_FEES` | `false` | Trading fee tracking |

### Cost Basis Management

HTX Pi Monitor uses LOFO (Lowest-First-Out) accounting for accurate P/L calculations.

**Adding Cost Basis Entries:**

1. **Edit the lots file:**
   ```bash
   nano data/cost_basis_lots.json
   ```

2. **Add entries manually:**
   ```json
   {
     "meta": { "last_id": 2 },
     "BTC": {
       "lots": [
         {
           "id": "000001",
           "action": "buy",
           "qty": 0.1,
           "unit_cost": 45000,
           "ts": "2025-01-15T10:30:00Z"
         },
         {
           "id": "000002",
           "action": "deposit",
           "qty": 0.05,
           "unit_cost": null,
           "ts": "2025-02-01T14:20:00Z"
         }
       ]
     }
   }
   ```

**Action Types:**
- `buy` - Purchase with known cost
- `sell` - Sale (automatically applies LOFO)
- `deposit` - External deposit (unknown cost)
- `withdraw` - External withdrawal

## Usage

### Web Interface

Access the web interface at `http://your-pi-ip:8080`

**Main Features:**
- **Portfolio Overview** - Total value and 24h change
- **Position Cards** - Individual asset details
- **Touch Controls** - Tap to select, long-press to hide, double-tap to pin
- **Pull-to-Refresh** - Swipe down to refresh data
- **Settings Panel** - Configure refresh rate and preferences

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | System health check |
| `/api/snapshot` | GET | Latest portfolio snapshot |
| `/api/history?n=50` | GET | Historical snapshots |
| `/api/status` | GET | Detailed system status |
| `/api/refresh` | POST | Force immediate refresh |

**Example API Usage:**
```bash
# Get current portfolio
curl http://localhost:8080/api/snapshot

# Get system health
curl http://localhost:8080/api/health

# Get last 10 snapshots
curl http://localhost:8080/api/history?n=10

# Force refresh
curl -X POST http://localhost:8080/api/refresh
```

### Command Line Management

**Service Management:**
```bash
# Check status
sudo systemctl status htx-monitor

# View logs
sudo journalctl -u htx-monitor -f

# Restart service
sudo systemctl restart htx-monitor

# Stop service
sudo systemctl stop htx-monitor
```

**Kiosk Management:**
```bash
# Start kiosk mode
/home/pi/start-kiosk.sh

# Stop kiosk mode
/home/pi/stop-kiosk.sh

# Restart kiosk
/home/pi/restart-kiosk.sh

# Enter recovery mode
/home/pi/recovery-mode.sh
```

## Troubleshooting

### Common Issues

#### 1. Service Won't Start
```bash
# Check service logs
sudo journalctl -u htx-monitor -f

# Common causes:
# - Missing .env file
# - Invalid API credentials
# - Port already in use
# - Node.js version too old
```

#### 2. No Data Appearing
```bash
# Test API connection
curl http://localhost:8080/api/health

# Check HTX credentials
# Verify account has trading history
# Ensure read permissions on API key
```

#### 3. Kiosk Mode Issues
```bash
# Check if service is running
sudo systemctl status htx-monitor

# Verify Chromium installation
chromium-browser --version

# Check autostart configuration
ls -la ~/.config/autostart/
```

#### 4. Performance Issues
```bash
# Check memory usage
free -h

# Check CPU usage
htop

# Reduce history retention
# Edit .env: MAX_HISTORY_SNAPSHOTS=20
```

### Log Files

**System Logs:**
```bash
# Service logs
sudo journalctl -u htx-monitor -f

# System log file
tail -f /var/log/htx-monitor.log

# Chromium logs
ls ~/.config/chromium/crash*
```

### Recovery Procedures

#### Factory Reset
```bash
# Stop all services
sudo systemctl stop htx-monitor
/home/pi/stop-kiosk.sh

# Clear data (keeps config)
rm -rf data/*

# Restart service
sudo systemctl start htx-monitor
```

#### Emergency Access
```bash
# SSH into Pi
ssh pi@your-pi-ip

# Exit kiosk mode
/home/pi/stop-kiosk.sh

# Start desktop environment
startx
```

## Development

### Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test

# Run specific test suites
npm run test:unit
npm run test:integration
```

### Project Structure
```
htx-pi-monitor/
├── src/                    # Backend source code
│   ├── server.js          # Express server and main entry
│   ├── htx.js             # HTX API client
│   ├── state.js           # State management
│   ├── lots.js            # LOFO accounting
│   ├── calc.js            # Portfolio calculations
│   └── scheduler.js       # Data pull orchestration
├── public/                # Frontend assets
│   ├── index.html         # Main UI
│   ├── style.css          # Styles
│   └── script.js          # Frontend logic
├── data/                  # Runtime data (created automatically)
│   ├── state.json         # Portfolio snapshots
│   └── cost_basis_lots.json # LOFO cost basis data
├── systemd/               # System service files
├── scripts/               # Setup and management scripts
├── test/                  # Test suites
├── .env.example          # Environment template
├── package.json          # Node.js dependencies
└── README.md             # This file
```

### Contributing

1. **Fork the repository**
2. **Create feature branch:** `git checkout -b feature/amazing-feature`
3. **Commit changes:** `git commit -m 'Add amazing feature'`
4. **Push to branch:** `git push origin feature/amazing-feature`
5. **Open Pull Request**

### Testing

```bash
# Run all tests
npm test

# Unit tests only
npm run test:unit

# Integration tests
npm run test:integration

# End-to-end tests
npm run test:e2e

# Performance tests
npm run test:stress
```

## Performance

### Raspberry Pi Optimization

The system is optimized for Raspberry Pi constraints:

- **Memory Usage:** <100MB typical operation
- **CPU Usage:** <10% average, <50% during data pulls
- **Storage:** <50MB for application, data grows ~1MB per day
- **Network:** <1KB/min bandwidth usage

### Monitoring

**Built-in Metrics:**
- Response time monitoring
- Memory usage tracking
- Error rate statistics
- API call success rates

**Access Metrics:**
```bash
# Via API
curl http://localhost:8080/api/status

# Via logs
sudo journalctl -u htx-monitor | grep "Pull cycle"
```

## Security

### Security Features
- **Read-only API keys** - No trading permissions required
- **HTTPS support** - Can run behind reverse proxy
- **No sensitive data logging** - API keys never logged
- **Secure file permissions** - Restricted access to config files
- **Input validation** - All API inputs validated
- **Rate limiting** - Built-in API rate limiting

### Security Checklist
- [ ] Use read-only HTX API keys
- [ ] Set secure file permissions (`chmod 600 .env`)
- [ ] Enable firewall if needed (`sudo ufw enable`)
- [ ] Keep system updated (`sudo apt update && sudo apt upgrade`)
- [ ] Monitor logs for suspicious activity
- [ ] Rotate API keys regularly

## FAQ

### General Questions

**Q: Does this support other exchanges?**
A: Currently HTX only. The architecture supports adding other exchanges through new client implementations.

**Q: Can I run this on other platforms?**
A: Yes, it runs on any system with Node.js 20+. The Raspberry Pi optimizations are optional.

**Q: Is my API key safe?**
A: Yes, when using read-only keys. The application never logs sensitive credentials.

### Technical Questions

**Q: How accurate are the P/L calculations?**
A: Very accurate when cost basis data is complete. Uses professional LOFO accounting methods.

**Q: What happens during network outages?**
A: The system continues displaying last known data and resumes automatically when connectivity returns.

**Q: Can I customize the refresh rate?**
A: Yes, via the `PULL_INTERVAL_MS` environment variable or the web interface settings.

**Q: How much data does it store?**
A: Configurable via `MAX_HISTORY_SNAPSHOTS`. Default 50 snapshots ≈ 50KB storage.

### Troubleshooting FAQs

**Q: Service starts but no data appears**
A: Check API credentials, account permissions, and ensure the account has trading history.

**Q: High memory usage**
A: Reduce `MAX_HISTORY_SNAPSHOTS` or check for memory leaks in logs.

**Q: Touch interface not responding**
A: Ensure touchscreen drivers are installed and calibrated properly.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

### Getting Help
- **Documentation:** This README and inline code comments
- **Issues:** GitHub Issues tracker
- **Community:** GitHub Discussions

### Reporting Bugs
Please include:
- Raspberry Pi model and OS version
- Node.js version (`node --version`)
- Error logs (`sudo journalctl -u htx-monitor`)
- Steps to reproduce

### Feature Requests
Feature requests are welcome! Please describe:
- Use case and benefit
- Proposed implementation approach
- Any compatibility considerations

---

**HTX Pi Monitor** - Professional cryptocurrency portfolio monitoring for Raspberry Pi

*Made with ❤️ for the crypto community*