#!/bin/bash

# HTX Pi Monitor Kiosk Setup Script
# Configures Raspberry Pi for full-screen kiosk mode

set -e

echo "HTX Pi Monitor Kiosk Setup"
echo "=========================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
MONITOR_DIR="/home/pi/htx-pi-monitor"
SERVICE_FILE="htx-monitor.service"
AUTOSTART_DIR="/home/pi/.config/autostart"
KIOSK_DESKTOP_FILE="htx-kiosk.desktop"

# Functions
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_root() {
    if [[ $EUID -eq 0 ]]; then
        print_error "This script should not be run as root"
        print_error "Run as pi user: ./scripts/kiosk-setup.sh"
        exit 1
    fi
}

check_pi_user() {
    if [[ "$USER" != "pi" ]]; then
        print_warning "This script is designed for the 'pi' user"
        print_warning "Current user: $USER"
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
}

install_dependencies() {
    print_status "Installing system dependencies..."
    
    # Update package list
    sudo apt-get update -qq
    
    # Install required packages
    sudo apt-get install -y \
        chromium-browser \
        unclutter \
        xdotool \
        x11-xserver-utils \
        xinit \
        lightdm \
        openbox
    
    print_success "Dependencies installed"
}

configure_boot() {
    print_status "Configuring boot settings..."
    
    # Enable auto-login for pi user
    sudo systemctl set-default graphical.target
    
    # Configure lightdm for auto-login
    sudo tee /etc/lightdm/lightdm.conf > /dev/null << EOF
[Seat:*]
autologin-user=pi
autologin-user-timeout=0
user-session=openbox
EOF

    print_success "Boot settings configured"
}

configure_openbox() {
    print_status "Configuring Openbox window manager..."
    
    # Create openbox config directory
    mkdir -p /home/pi/.config/openbox
    
    # Create openbox autostart
    cat > /home/pi/.config/openbox/autostart << 'EOF'
#!/bin/bash

# HTX Pi Monitor Kiosk Autostart

# Wait for desktop to load
sleep 5

# Disable screen blanking and power management
xset s off
xset -dpms
xset s noblank

# Hide cursor after 5 seconds of inactivity
unclutter -idle 5 &

# Wait for network
sleep 10

# Start HTX Monitor service
systemctl --user start htx-monitor.service || sudo systemctl start htx-monitor

# Wait for service to start
sleep 5

# Start Chromium in kiosk mode
chromium-browser \
    --kiosk \
    --incognito \
    --no-first-run \
    --fast \
    --fast-start \
    --disable-infobars \
    --disable-features=TranslateUI \
    --disable-ipc-flooding-protection \
    --disable-renderer-backgrounding \
    --disable-backgrounding-occluded-windows \
    --disable-background-timer-throttling \
    --disable-background-networking \
    --disable-client-side-phishing-detection \
    --disable-default-apps \
    --disable-extensions \
    --disable-hang-monitor \
    --disable-popup-blocking \
    --disable-prompt-on-repost \
    --disable-sync \
    --disable-translate \
    --disable-web-security \
    --memory-pressure-off \
    --max_old_space_size=256 \
    --aggressive-cache-discard \
    --no-sandbox \
    --disable-gpu \
    --window-size=1920,1080 \
    --start-fullscreen \
    --app=http://localhost:8080
EOF

    chmod +x /home/pi/.config/openbox/autostart
    
    print_success "Openbox configured"
}

install_htx_service() {
    print_status "Installing HTX Monitor service..."
    
    # Copy service file to systemd directory
    if [[ -f "$MONITOR_DIR/systemd/$SERVICE_FILE" ]]; then
        sudo cp "$MONITOR_DIR/systemd/$SERVICE_FILE" /etc/systemd/system/
        
        # Create log file with proper permissions
        sudo touch /var/log/htx-monitor.log
        sudo chown pi:pi /var/log/htx-monitor.log
        
        # Reload systemd and enable service
        sudo systemctl daemon-reload
        sudo systemctl enable htx-monitor.service
        
        print_success "HTX Monitor service installed and enabled"
    else
        print_error "Service file not found: $MONITOR_DIR/systemd/$SERVICE_FILE"
        exit 1
    fi
}

configure_network() {
    print_status "Configuring network settings..."
    
    # Disable WiFi power management to prevent disconnections
    if ! grep -q "wifi.powersave" /etc/NetworkManager/conf.d/default-wifi-powersave-on.conf 2>/dev/null; then
        sudo mkdir -p /etc/NetworkManager/conf.d/
        echo -e "[connection]\nwifi.powersave = 2" | sudo tee /etc/NetworkManager/conf.d/default-wifi-powersave-on.conf > /dev/null
    fi
    
    print_success "Network settings configured"
}

configure_display() {
    print_status "Configuring display settings..."
    
    # Create script to configure display on boot
    cat > /home/pi/setup-display.sh << 'EOF'
#!/bin/bash
# Configure display for optimal viewing

# Set resolution (adjust as needed for your display)
xrandr --output HDMI-1 --mode 1920x1080 --rate 60 2>/dev/null || true
xrandr --output HDMI-2 --mode 1920x1080 --rate 60 2>/dev/null || true

# Disable screen blanking
xset s off
xset -dpms
xset s noblank

# Set background to black
xsetroot -solid "#000000"
EOF

    chmod +x /home/pi/setup-display.sh
    
    # Add to openbox autostart
    sed -i '/# Wait for desktop to load/a /home/pi/setup-display.sh &' /home/pi/.config/openbox/autostart
    
    print_success "Display settings configured"
}

create_management_scripts() {
    print_status "Creating management scripts..."
    
    # Start kiosk script
    cat > /home/pi/start-kiosk.sh << 'EOF'
#!/bin/bash
# Start HTX Monitor in kiosk mode

echo "Starting HTX Monitor Kiosk Mode..."

# Stop any existing chromium processes
pkill -f chromium-browser || true
sleep 2

# Setup display
/home/pi/setup-display.sh

# Start service if not running
if ! systemctl is-active --quiet htx-monitor; then
    echo "Starting HTX Monitor service..."
    sudo systemctl start htx-monitor
fi

# Wait for service
sleep 5

# Hide cursor
unclutter -idle 5 &

# Start chromium in kiosk mode
exec chromium-browser \
    --kiosk \
    --incognito \
    --no-first-run \
    --disable-infobars \
    --app=http://localhost:8080
EOF

    # Stop kiosk script
    cat > /home/pi/stop-kiosk.sh << 'EOF'
#!/bin/bash
# Stop HTX Monitor kiosk mode

echo "Stopping HTX Monitor Kiosk Mode..."

# Kill chromium
pkill -f chromium-browser || true

# Kill unclutter
pkill -f unclutter || true

# Optionally stop the service
# sudo systemctl stop htx-monitor

echo "Kiosk mode stopped"
EOF

    # Restart kiosk script
    cat > /home/pi/restart-kiosk.sh << 'EOF'
#!/bin/bash
# Restart HTX Monitor kiosk

echo "Restarting HTX Monitor..."

/home/pi/stop-kiosk.sh
sleep 3
/home/pi/start-kiosk.sh
EOF

    # Make scripts executable
    chmod +x /home/pi/start-kiosk.sh
    chmod +x /home/pi/stop-kiosk.sh
    chmod +x /home/pi/restart-kiosk.sh
    
    print_success "Management scripts created"
    print_status "  - /home/pi/start-kiosk.sh - Start kiosk mode"
    print_status "  - /home/pi/stop-kiosk.sh - Stop kiosk mode"
    print_status "  - /home/pi/restart-kiosk.sh - Restart kiosk mode"
}

configure_chromium() {
    print_status "Configuring Chromium browser..."
    
    # Create chromium config directory
    mkdir -p /home/pi/.config/chromium/Default
    
    # Create preferences to disable various prompts and features
    cat > /home/pi/.config/chromium/Default/Preferences << 'EOF'
{
    "profile": {
        "default_content_setting_values": {
            "notifications": 2
        },
        "default_content_settings": {
            "popups": 2
        }
    },
    "browser": {
        "show_home_button": false,
        "check_default_browser": false
    },
    "distribution": {
        "skip_first_run_ui": true,
        "show_welcome_page": false,
        "import_bookmarks": false,
        "import_history": false,
        "import_search_engine": false,
        "make_chrome_default": false,
        "make_chrome_default_for_user": false,
        "suppress_first_run_bubble": true
    },
    "first_run_tabs": [],
    "homepage": "http://localhost:8080",
    "homepage_is_newtabpage": false
}
EOF

    print_success "Chromium configured"
}

create_recovery_mode() {
    print_status "Setting up recovery mode..."
    
    # Create a recovery script that can be triggered via SSH
    cat > /home/pi/recovery-mode.sh << 'EOF'
#!/bin/bash
# Recovery mode - exits kiosk and provides desktop access

echo "Entering recovery mode..."

# Stop kiosk
/home/pi/stop-kiosk.sh

# Kill openbox session to return to desktop
pkill -f openbox || true

# Start desktop environment
DISPLAY=:0 startx /usr/bin/openbox-session &

echo "Recovery mode active. Desktop should be available."
echo "To restart kiosk: /home/pi/restart-kiosk.sh"
EOF

    chmod +x /home/pi/recovery-mode.sh
    
    print_success "Recovery mode script created: /home/pi/recovery-mode.sh"
}

verify_installation() {
    print_status "Verifying installation..."
    
    # Check if service file exists
    if [[ -f "/etc/systemd/system/$SERVICE_FILE" ]]; then
        print_success "Service file installed"
    else
        print_error "Service file missing"
        return 1
    fi
    
    # Check if HTX Monitor directory exists
    if [[ -d "$MONITOR_DIR" ]]; then
        print_success "HTX Monitor directory found"
    else
        print_error "HTX Monitor directory not found"
        return 1
    fi
    
    # Check if scripts are executable
    for script in start-kiosk.sh stop-kiosk.sh restart-kiosk.sh setup-display.sh recovery-mode.sh; do
        if [[ -x "/home/pi/$script" ]]; then
            print_success "$script is executable"
        else
            print_warning "$script is not executable"
        fi
    done
    
    print_success "Installation verification complete"
}

show_completion() {
    echo ""
    echo "================================================"
    print_success "HTX Pi Monitor Kiosk Setup Complete!"
    echo "================================================"
    echo ""
    print_status "Next steps:"
    echo "  1. Configure your .env file with HTX API credentials"
    echo "  2. Test the service: sudo systemctl start htx-monitor"
    echo "  3. Test kiosk mode: /home/pi/start-kiosk.sh"
    echo "  4. Reboot to enable auto-start: sudo reboot"
    echo ""
    print_status "Management commands:"
    echo "  Start kiosk:     /home/pi/start-kiosk.sh"
    echo "  Stop kiosk:      /home/pi/stop-kiosk.sh"
    echo "  Restart kiosk:   /home/pi/restart-kiosk.sh"
    echo "  Recovery mode:   /home/pi/recovery-mode.sh"
    echo ""
    print_status "Service commands:"
    echo "  Status:  sudo systemctl status htx-monitor"
    echo "  Logs:    sudo journalctl -u htx-monitor -f"
    echo "  Start:   sudo systemctl start htx-monitor"
    echo "  Stop:    sudo systemctl stop htx-monitor"
    echo ""
    print_warning "Remember to:"
    echo "  - Set up your .env file with HTX credentials"
    echo "  - Test everything before rebooting"
    echo "  - Use SSH for remote access after kiosk mode is active"
    echo ""
}

# Main execution
main() {
    check_root
    check_pi_user
    
    echo ""
    print_status "Starting HTX Pi Monitor kiosk setup..."
    print_warning "This will configure your Pi for full-screen kiosk mode"
    print_warning "Make sure you have SSH enabled for remote access"
    echo ""
    
    read -p "Continue with kiosk setup? (y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_status "Setup cancelled"
        exit 0
    fi
    
    install_dependencies
    configure_boot
    configure_openbox
    install_htx_service
    configure_network
    configure_display
    create_management_scripts
    configure_chromium
    create_recovery_mode
    verify_installation
    show_completion
}

# Handle script arguments
case "${1:-}" in
    --help|-h)
        echo "HTX Pi Monitor Kiosk Setup Script"
        echo ""
        echo "Usage: $0 [options]"
        echo ""
        echo "Options:"
        echo "  --help, -h     Show this help message"
        echo "  --verify       Verify installation only"
        echo ""
        echo "This script configures a Raspberry Pi for HTX Monitor kiosk mode."
        exit 0
        ;;
    --verify)
        verify_installation
        exit $?
        ;;
    *)
        main
        ;;
esac