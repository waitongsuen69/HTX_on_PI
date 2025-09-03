# HTX Pi Monitor - Quick Start Guide

## 🚀 Boot Up Instructions

### Prerequisites
- Node.js 20+ installed
- HTX (Huobi) account with read-only API keys
- macOS/Linux (for development) or Raspberry Pi (for production)

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Configure Environment

Copy the example environment file and edit it with your HTX credentials:

```bash
cp .env.example .env
```

Edit `.env` file with your actual values:
```ini
# REQUIRED - HTX API Credentials (READ-ONLY)
HTX_ACCESS_KEY=your-access-key-here
HTX_SECRET_KEY=your-secret-key-here
HTX_ACCOUNT_ID=your-account-id-here

# Optional - Can use defaults
PORT=8080
BIND_ADDR=0.0.0.0
REF_FIAT=USD
PULL_INTERVAL_MS=60000
```

### How to Get HTX API Keys:
1. Log in to HTX (Huobi) exchange
2. Go to Account Settings → API Management
3. Create new API key with **READ-ONLY** permissions
4. Copy Access Key, Secret Key, and Account ID

## Step 3: Run Tests (Optional but Recommended)

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test suite
npm run test:unit
```

## Step 4: Start the System

### Development Mode (with auto-restart)
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

## Step 5: Access the Dashboard

Open your browser and navigate to:
- **Local**: http://localhost:8080
- **Network**: http://[your-ip]:8080

## 🎯 What You Should See

1. **Initial Load**: System will fetch data within 2 minutes
2. **Dashboard**: Shows total portfolio value and individual positions
3. **Real-time Updates**: Auto-refreshes every 60 seconds
4. **Touch Controls**: 
   - Tap to view details
   - Double-tap to pin
   - Long-press to hide
   - Pull down to refresh

## 📊 API Endpoints

Test the API endpoints directly:

```bash
# Check system health
curl http://localhost:8080/api/health

# Get latest portfolio snapshot
curl http://localhost:8080/api/snapshot

# Get historical data
curl http://localhost:8080/api/history?n=10

# Get system status
curl http://localhost:8080/api/status
```

## 🔧 Troubleshooting

### No Data Showing?
1. Check your HTX API credentials in `.env`
2. Ensure API keys have read permissions
3. Check logs: `npm run dev` shows detailed output

### Connection Issues?
```bash
# Test HTX connection
curl http://localhost:8080/api/health
```

### Port Already in Use?
Change the port in `.env`:
```ini
PORT=3000
```

## 🍓 Raspberry Pi Deployment

### Quick Deploy to Pi

1. **SSH into your Pi:**
```bash
ssh pi@raspberrypi.local
```

2. **Clone and Setup:**
```bash
git clone [your-repo-url] htx-monitor
cd htx-monitor
npm install
cp .env.example .env
nano .env  # Edit with your credentials
```

3. **Install as Service:**
```bash
sudo cp systemd/htx-monitor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable htx-monitor
sudo systemctl start htx-monitor
```

4. **Setup Kiosk Mode:**
```bash
chmod +x scripts/kiosk-setup.sh
./scripts/kiosk-setup.sh
```

5. **Reboot Pi:**
```bash
sudo reboot
```

The system will automatically start in kiosk mode on boot!

## 📝 Manual Cost Basis Entry

To track P/L, add your cost basis to `data/cost_basis_lots.json`:

```json
{
  "meta": { "last_id": 0 },
  "BTC": {
    "lots": [
      {
        "id": "000001",
        "action": "buy",
        "qty": 0.1,
        "unit_cost": 50000,
        "ts": "2024-01-01T00:00:00Z"
      }
    ]
  }
}
```

## 🎉 Success Indicators

✅ **Health Check OK**: `curl http://localhost:8080/api/health` returns `{"ok":true}`  
✅ **Data Flowing**: Portfolio values update every 60 seconds  
✅ **UI Responsive**: Touch gestures work smoothly  
✅ **Logs Clean**: No error messages in console  

## 📚 Next Steps

- Review the [README.md](README.md) for detailed documentation
- Check [TEST_SUMMARY.md](TEST_SUMMARY.md) for test coverage
- Monitor system performance with `/api/status` endpoint
- Customize refresh interval and other settings in `.env`

## Need Help?

- Check logs: `npm run dev` for detailed output
- Run tests: `npm test` to verify system integrity
- Review specs: See `IMPLEMENTATION_SPEC.md` for architecture details

---

**Happy Monitoring! 🚀**