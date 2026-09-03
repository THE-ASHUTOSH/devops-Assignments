# Shell Scripting

`info.sh` - prints date, hostname, user, disk usage and running processes, asks where to
save, then dumps the process list into a file with output redirection.

## Run it

```bash
chmod +x info.sh
./info.sh
```

It asks two questions with `read -p` (folder name and file name). Both have defaults if you
just hit enter. I ran it inside an ubuntu container so the df/ps output is Linux, and fed the
answers in with printf instead of typing them:

```bash
printf 'sysreport\nprocesses.txt\n' | bash info.sh
```

## What the assignment asked for and where it is

| required | in the script |
|---|---|
| current date | `today=$(date)` |
| hostname | `host=$(hostname)` |
| username | `user=$(whoami)` |
| disk usage | `df -h` |
| running processes | `ps aux \| head -11` |
| variables | today, host, user, dirname, filename, report |
| read -p | two prompts for the folder and file name |
| mkdir | `mkdir -p "$dirname"` |
| touch | `touch "$dirname/$filename"` |
| > redirection | `echo ... > "$report"` then `ps aux >> "$report"` |

First write uses `>` so a rerun starts a fresh report, everything after that is `>>` so it
appends instead of wiping the file each line.

## Output

```console
==============================
     System Info Script
==============================
Date     : Thu Sep  3 17:14:59 UTC 2026
Hostname : fc2191ec585a
User     : root

----- Disk Usage -----
Filesystem      Size  Used Avail Use% Mounted on
overlay         911G  161G  705G  19% /
tmpfs            64M     0   64M   0% /dev
shm              64M     0   64M   0% /dev/shm
/dev/vda1       911G  161G  705G  19% /etc/hosts
tmpfs           3.2G   44K  3.2G   1% /run
tmpfs           5.0M     0  5.0M   0% /run/lock

----- Running Processes (top 10) -----
USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root           1  0.0  0.0  21012 11656 ?        Ss   17:07   0:00 /lib/systemd/systemd
root          23  0.0  0.0  33764 11860 ?        S<s  17:07   0:00 /usr/lib/systemd/systemd-journald
systemd+      72  0.0  0.0  21436 12384 ?        Ss   17:07   0:00 /usr/lib/systemd/systemd-resolved
message+      79  0.0  0.0   9512  4364 ?        Ss   17:07   0:00 @dbus-daemon --system --address=systemd: --nofork --nopidfile --systemd-activation --syslog-only
root          82  0.0  0.0  17268  7132 ?        Ss   17:07   0:00 /usr/lib/systemd/systemd-logind
root          87  0.0  0.0   2700  1716 tty1     Ss+  17:07   0:00 /sbin/agetty -o -p -- \u --noclear - linux
root         175  0.0  0.0  10460  1572 ?        Ss   17:08   0:00 nginx: master process /usr/sbin/nginx -g daemon on; master_process on;
www-data     176  0.0  0.0  12060  4156 ?        S    17:08   0:00 nginx: worker process
www-data     177  0.0  0.0  12060  4156 ?        S    17:08   0:00 nginx: worker process
www-data     178  0.0  0.0  12060  4140 ?        S    17:08   0:00 nginx: worker process


Saved to sysreport/processes.txt
Lines written: 40

----- First 20 lines of the report -----
Report generated on Thu Sep  3 17:14:59 UTC 2026
Host: fc2191ec585a
User: root

Disk usage:
Filesystem      Size  Used Avail Use% Mounted on
overlay         911G  161G  705G  19% /
tmpfs            64M     0   64M   0% /dev
shm              64M     0   64M   0% /dev/shm
/dev/vda1       911G  161G  705G  19% /etc/hosts
tmpfs           3.2G   44K  3.2G   1% /run
tmpfs           5.0M     0  5.0M   0% /run/lock

Running processes:
USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root           1  0.0  0.0  21012 11656 ?        Ss   17:07   0:00 /lib/systemd/systemd
root          23  0.0  0.0  33764 11860 ?        S<s  17:07   0:00 /usr/lib/systemd/systemd-journald
systemd+      72  0.0  0.0  21436 12384 ?        Ss   17:07   0:00 /usr/lib/systemd/systemd-resolved
message+      79  0.0  0.0   9512  4364 ?        Ss   17:07   0:00 @dbus-daemon --system --address=systemd: --nofork --nopidfile --systemd-activation --syslog-only
root          82  0.0  0.0  17268  7132 ?        Ss   17:07   0:00 /usr/lib/systemd/systemd-logind
```

## The file it created

```console
total 12
drwxr-xr-x 2 root root 4096 Sep  3 17:14 .
drwx------ 1 root root 4096 Sep  3 17:14 ..
-rw-r--r-- 1 root root 2922 Sep  3 17:14 processes.txt
---
www-data     191  0.0  0.0  12060  4156 ?        S    17:08   0:00 nginx: worker process
www-data     192  0.0  0.0  12060  4156 ?        S    17:08   0:00 nginx: worker process
root        1051  0.0  0.0   4044  3024 ?        Ss   17:14   0:00 bash -c printf 'sysreport\nprocesses.txt\n' | bash info.sh
root        1058  0.0  0.0   4044  3044 ?        S    17:14   0:00 bash info.sh
root        1068  0.0  0.0   7640  3660 ?        R    17:14   0:00 ps aux
```

40 lines in the report - header, df output, then the full `ps aux` (not the head -11 version,
the file gets everything).
