#!/bin/bash
while true; do
    echo "=== $(date) ===" >> /var/log/vm-check.log
    # Процессы в uninterruptible sleep (часто причина фризов)
    ps aux | awk '$8 ~ /D/ {print $0}' >> /var/log/vm-check.log
    # I/O и Steal time
    iostat -xz 1 1 >> /var/log/vm-check.log 2>&1
    vmstat 1 1 >> /var/log/vm-check.log 2>&1
    sleep 5
done
