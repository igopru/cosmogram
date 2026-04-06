#!/bin/bash
# Diagnostic script for VM freezes - run when system is unresponsive

DIAG_LOG="/opt/cosmogram/data/diag-$(date '+%Y%m%d-%H%M%S').log"

{
echo "====================================="
echo "SYSTEM DIAGNOSTIC"
echo "Date: $(date)"
echo "====================================="

echo -e "\n=== UPTIME & LOAD ==="
uptime

echo -e "\n=== MEMORY ==="
free -h

echo -e "\n=== SWAP ==="
swapon --show

echo -e "\n=== TOP PROCESSES BY CPU ==="
ps aux --sort=-%cpu | head -10

echo -e "\n=== TOP PROCESSES BY MEMORY ==="
ps aux --sort=-%mem | head -10

echo -e "\n=== DISK I/O ==="
iostat

echo -e "\n=== DISK USAGE ==="
df -h

echo -e "\n=== SQLITE DATABASE ==="
ls -lh /opt/cosmogram/data/media.db* 2>/dev/null

echo -e "\n=== SYSTEM JOURNAL ERRORS ==="
journalctl -p err --no-pager --since "10 min ago" 2>/dev/null | tail -20

echo -e "\n=== DMESG WARNINGS ==="
dmesg --level=warn,err 2>/dev/null | tail -20

echo -e "\n=== COSMOGRAM STATUS ==="
systemctl status cosmogram --no-pager 2>/dev/null

echo -e "\n=== COSMOGRAM RECENT LOGS ==="
journalctl -u cosmogram --no-pager --since "10 min ago" 2>/dev/null | grep -E "SLOW|HEALTH|error|Error|crash" | tail -20

echo -e "\n=== NETWORK CONNECTIONS ==="
ss -tunap | head -30

echo -e "\n=== PROC LOADAVG ==="
cat /proc/loadavg

echo -e "\n=== VIRTUAL MEMORY STATISTICS ==="
cat /proc/vmstat | tail -20

echo -e "\n====================================="
echo "DIAGNOSTIC COMPLETE"
echo "====================================="
} | tee "$DIAG_LOG"

echo -e "\nDiagnostic saved to: $DIAG_LOG"
