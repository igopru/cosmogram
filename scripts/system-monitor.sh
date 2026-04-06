#!/bin/bash
# System monitoring script for Cosmogram server

LOG_FILE="/opt/cosmogram/data/system-monitor.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# System resources
UPTIME=$(uptime -p)
LOAD_AVG=$(cat /proc/loadavg | awk '{print $1, $2, $3}')
MEMORY=$(free -h | grep Mem | awk '{printf "Total: %s, Used: %s, Available: %s", $2, $3, $7}')
DISK=$(df -h / | tail -1 | awk '{printf "Total: %s, Used: %s, Available: %s (%s)", $2, $3, $4, $5}')

# Process info
if systemctl is-active --quiet cosmogram; then
    COSMOMEM=$(systemctl show cosmogram --property=MemoryCurrent | cut -d= -f2)
    COSMOMEM_MB=$((COSMOMEM / 1024 / 1024))
    COSMOSTATUS="RUNNING (Memory: ${COSMOMEM_MB}MB)"
    COSMOUPTIME=$(systemctl show cosmogram --property=ActiveEnterTimestamp | cut -d= -f2)
else
    COSMOSTATUS="STOPPED"
    COSMOUPTIME="N/A"
fi

# IOWAIT
IOWAIT=$(iostat | grep -A1 "avg-cpu" | tail -1 | awk '{print $4}')

# Network connections to cosmogram
ACTIVE_CONNECTIONS=$(ss -tunap 2>/dev/null | grep ":8000" | wc -l)

# Top CPU processes
TOP_CPU=$(ps aux --sort=-%cpu | head -6 | tail -5)

# SQLite WAL size (can cause freezes if too large)
WAL_SIZE="N/A"
if [ -f "/opt/cosmogram/data/media.db-wal" ]; then
    WAL_SIZE=$(du -h /opt/cosmogram/data/media.db-wal | awk '{print $1}')
fi

log "=== SYSTEM STATUS ==="
log "Uptime: $UPTIME"
log "Load Average: $LOAD_AVG"
log "Memory: $MEMORY"
log "Disk: $DISK"
log "IOWait: ${IOWAIT}%"
log "Cosmogram: $COSMOSTATUS"
log "SQLite WAL: $WAL_SIZE"
log "Active Connections: $ACTIVE_CONNECTIONS"
log "Top CPU processes:"
echo "$TOP_CPU" | while read line; do log "  $line"; done
log "====================="

# Alert if issues found
IOWAIT_NUM=$(echo "$IOWAIT" | awk '{printf "%d", $1}')
if [ "$IOWAIT_NUM" -gt 10 ]; then
    log "⚠️ WARNING: High IOWAIT detected: ${IOWAIT}%"
fi

LOAD_NUM=$(echo "$LOAD_AVG" | awk '{printf "%d", $1}')
if [ "$LOAD_NUM" -gt 5 ]; then
    log "⚠️ WARNING: High load average: $LOAD_AVG"
fi

# Check for memory leaks (Cosmogram > 500MB)
if [ "$COSMOMEM_MB" -gt 500 ] 2>/dev/null; then
    log "⚠️ WARNING: Cosmogram memory leak suspected: ${COSMOMEM_MB}MB"
fi

# Check SQLite WAL size (should be < 100MB)
if [ "$WAL_SIZE" != "N/A" ]; then
    WAL_SIZE_MB=$(echo "$WAL_SIZE" | sed 's/M//' | awk '{printf "%d", $1}')
    if [ "$WAL_SIZE_MB" -gt 100 ] 2>/dev/null; then
        log "⚠️ WARNING: SQLite WAL file too large: $WAL_SIZE - may cause freezes"
    fi
fi

# Output last 20 lines of log
tail -20 "$LOG_FILE"
