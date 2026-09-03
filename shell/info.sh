#!/bin/bash

echo "=============================="
echo "     System Info Script"
echo "=============================="

today=$(date)
host=$(hostname)
user=$(whoami)

echo "Date     : $today"
echo "Hostname : $host"
echo "User     : $user"

echo
echo "----- Disk Usage -----"
df -h

echo
echo "----- Running Processes (top 10) -----"
ps aux | head -11

echo
read -p "Where should I save the report? " dirname
read -p "Name for the report file? " filename

if [ -z "$dirname" ]; then
    dirname="sysreport"
fi

if [ -z "$filename" ]; then
    filename="processes.txt"
fi

mkdir -p "$dirname"
touch "$dirname/$filename"

report="$dirname/$filename"

echo "Report generated on $today" > "$report"
echo "Host: $host" >> "$report"
echo "User: $user" >> "$report"
echo "" >> "$report"
echo "Disk usage:" >> "$report"
df -h >> "$report"
echo "" >> "$report"
echo "Running processes:" >> "$report"
ps aux >> "$report"

echo
echo "Saved to $report"
echo "Lines written: $(wc -l < "$report")"
echo
echo "----- First 20 lines of the report -----"
head -20 "$report"
