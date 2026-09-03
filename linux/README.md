# Linux Fundamentals

I ran all of this inside an ubuntu:24.04 container since my laptop is a Mac and
things like adduser / journalctl don't exist there. For the journalctl task I built
a container that boots systemd as PID 1, otherwise there is no journal to read.

## Task 1 - soft link vs hard link

A filename is not the file. The real file is the inode; a directory entry is just a
name pointing at an inode number. A hard link is a second name for the same inode.
A soft link is its own little file that just stores a path.

|  | hard link | soft link |
|---|---|---|
| own inode | no, shares the target's | yes, type `l` |
| link count on target | goes up to 2 | stays 1 |
| original deleted | data still there | link breaks |
| across filesystems | no | yes |
| point at a directory | no | yes |
| point at something missing | no | yes, and it heals later |

Commands:

```bash
ln file hardlink
ln -s file softlink
ls -li            # inode is col 1, link count is col 3
stat file
readlink -f softlink
find . -xtype l   # broken symlinks
```

Output:

```console
+ mkdir -p /lab
+ cd /lab
+ echo 'Hello DevOps'
+ ln -s original.txt softlink.txt
+ ln original.txt hardlink.txt
+ ls -li original.txt softlink.txt hardlink.txt
3387835 -rw-r--r-- 2 root root 13 Sep  3 17:06 hardlink.txt
3387835 -rw-r--r-- 2 root root 13 Sep  3 17:06 original.txt
3387843 lrwxrwxrwx 1 root root 12 Sep  3 17:06 softlink.txt -> original.txt
+ stat -c '%n inode=%i links=%h size=%s type=%F' original.txt softlink.txt hardlink.txt
original.txt inode=3387835 links=2 size=13 type=regular file
softlink.txt inode=3387843 links=1 size=12 type=symbolic link
hardlink.txt inode=3387835 links=2 size=13 type=regular file
+ cat softlink.txt
Hello DevOps
+ cat hardlink.txt
Hello DevOps
+ echo '--- appending via hardlink ---'
+ echo 'line added via hardlink'
+ cat original.txt
--- appending via hardlink ---
Hello DevOps
line added via hardlink
--- deleting the original ---
+ echo '--- deleting the original ---'
+ rm original.txt
+ ls -li softlink.txt hardlink.txt
3387835 -rw-r--r-- 1 root root 37 Sep  3 17:06 hardlink.txt
3387843 lrwxrwxrwx 1 root root 12 Sep  3 17:06 softlink.txt -> original.txt
+ cat hardlink.txt
Hello DevOps
line added via hardlink
+ cat softlink.txt
cat: softlink.txt: No such file or directory
+ echo '--- recreating original heals the softlink ---'
+ echo recreated
--- recreating original heals the softlink ---
+ cat softlink.txt
recreated
--- hard link to a directory is refused, symlink is allowed ---
+ echo '--- hard link to a directory is refused, symlink is allowed ---'
+ mkdir -p mydir
+ ln mydir dirhard
ln: mydir: hard link not allowed for directory
+ ln -s mydir dirsoft
+ ls -ld dirsoft
+ echo '--- deleting a symlink does not touch the target ---'
+ rm softlink.txt
lrwxrwxrwx 1 root root 5 Sep  3 17:06 dirsoft -> mydir
--- deleting a symlink does not touch the target ---
+ ls -l original.txt
-rw-r--r-- 1 root root 10 Sep  3 17:06 original.txt
```

Notes on what happened there:

- original.txt and hardlink.txt both sit on inode 3387835 with links=2. softlink.txt got
  its own inode and its size is 12, which is just the length of the string "original.txt".
- appending through the hard link changed the original, same inode.
- after deleting the original the hard link kept the data (count dropped to 1) but
  `cat softlink.txt` gave "No such file or directory".
- recreating a file with the same name fixed the symlink, because a symlink is resolved
  when you use it, not when you make it.
- `ln mydir dirhard` was refused, `ln -s mydir dirsoft` was fine.
- deleting the symlink did nothing to the target.

Interview version: hard link = another name on the same inode, data goes away only when
the link count hits 0. Soft link = a path stored in a file, resolved at access time, so it
can cross filesystems and point at directories but breaks if the target moves. Symlinks
are what you use for `current -> releases/2026-09-03` style deploys, hard links for
dedupe and snapshot backups.

## Task 2 - adduser vs useradd

useradd is the low level binary from the shadow package. adduser is a Perl script on
Debian/Ubuntu that calls useradd and does the rest of the job for you.

|  | useradd | adduser |
|---|---|---|
| what it is | binary | perl wrapper around useradd |
| home directory | only with -m | yes |
| copies /etc/skel | only with -m | yes |
| shell | /bin/sh by default | /bin/bash |
| password | not set, account locked | prompts |
| interactive | no | yes |
| config | /etc/default/useradd, /etc/login.defs | /etc/adduser.conf |

On Ubuntu adduser is the preferred one - the useradd man page itself calls useradd a
"low level utility" and tells you to use adduser. Plain `useradd bob` leaves you a
half broken account with no home dir and no password, which is where the "why can't
this user log in" tickets come from. useradd is still the right choice inside scripts
and Dockerfiles because it is non interactive and exists on non Debian distros too.

Output:

```console
+ which adduser useradd
/usr/sbin/adduser
/usr/sbin/useradd
+ echo '===== useradd (low-level, no home dir, no shell, no password) ====='
+ useradd testuser-lowlevel
===== useradd (low-level, no home dir, no shell, no password) =====
+ grep '^testuser-lowlevel' /etc/passwd
testuser-lowlevel:x:1001:1001::/home/testuser-lowlevel:/bin/sh
+ ls -ld /home/testuser-lowlevel
ls: cannot access '/home/testuser-lowlevel': No such file or directory
===== adduser (recommended on Ubuntu: creates home, copies /etc/skel, sets shell) =====
+ echo '===== adduser (recommended on Ubuntu: creates home, copies /etc/skel, sets shell) ====='
+ adduser --disabled-password --gecos '' devopsuser
info: Adding user `devopsuser' ...
info: Selecting UID/GID from range 1000 to 59999 ...
info: Adding new group `devopsuser' (1002) ...
info: Adding new user `devopsuser' (1002) with group `devopsuser (1002)' ...
info: Creating home directory `/home/devopsuser' ...
info: Copying files from `/etc/skel' ...
info: Adding new user `devopsuser' to supplemental / extra groups `users' ...
info: Adding user `devopsuser' to group `users' ...
+ grep '^devopsuser' /etc/passwd
devopsuser:x:1002:1002:,,,:/home/devopsuser:/bin/bash
+ grep '^devopsuser' /etc/group
devopsuser:x:1002:
+ ls -la /home/devopsuser
total 20
drwxr-x--- 2 devopsuser devopsuser 4096 Sep  3 17:07 .
drwxr-xr-x 1 root       root       4096 Sep  3 17:07 ..
-rw-r--r-- 1 devopsuser devopsuser  220 Sep  3 17:07 .bash_logout
-rw-r--r-- 1 devopsuser devopsuser 3771 Sep  3 17:07 .bashrc
-rw-r--r-- 1 devopsuser devopsuser  807 Sep  3 17:07 .profile
+ id devopsuser
uid=1002(devopsuser) gid=1002(devopsuser) groups=1002(devopsuser),100(users)
+ echo '===== adduser is a perl wrapper around useradd ====='
===== adduser is a perl wrapper around useradd =====
++ which adduser
+ file /usr/sbin/adduser
/usr/sbin/adduser: Perl script text executable
++ which adduser
+ head -5 /usr/sbin/adduser
#! /usr/bin/perl

# Copyright (C) 2000-2004 Roland Bauerschmidt <rb@debian.org>
#               2005-2023 Marc Haber <mh+debian-packages@zugschlus.de>
#               2022 Benjamin Drung <benjamin.drung@canonical.com>
===== cleanup =====
+ echo '===== cleanup ====='
+ deluser --remove-home devopsuser
fatal: In order to use the --remove-home, --remove-all-files, and --backup features, you need to install the `perl' package. To accomplish that, run apt-get install perl.
+ userdel testuser-lowlevel
+ grep -c devopsuser /etc/passwd
1
```

- useradd made the passwd entry pointing at /home/testuser-lowlevel, but ls shows that
  directory was never created.
- adduser printed every step, made the group, made the home dir as drwxr-x---, copied
  .bashrc .profile .bash_logout out of /etc/skel and set /bin/bash.
- `file $(which adduser)` says "Perl script text executable", which is the whole point.
- the cleanup failed on purpose-ish: `deluser --remove-home` needs perl installed, and the
  minimal image didn't have it. Same dependency that makes adduser a script.

What I'd actually type:

```bash
sudo adduser devopsuser
sudo adduser --disabled-password --gecos "" svcuser   # scripted
sudo useradd -m -s /bin/bash bob && sudo passwd bob
sudo deluser --remove-home devopsuser
id bob
```

## Task 3 - journalctl

journalctl reads systemd's journal, which journald writes as a binary indexed store
instead of plain text files. Every entry carries fields (_SYSTEMD_UNIT, PRIORITY, _PID,
_BOOT_ID and so on), which is why you can filter by unit or severity or boot without
grepping strings. It picks up the kernel buffer, early boot, anything a service writes
to stdout/stderr, and syslog.

```bash
journalctl -n 50
journalctl -f                    # like tail -f
journalctl -u nginx              # one service
journalctl -xeu nginx.service    # end of one unit + explanations, the debugging one
journalctl -p err                # err and worse
journalctl -b / -b -1            # this boot / previous boot
journalctl --list-boots
journalctl --since "10 min ago"
journalctl -k                    # kernel only
journalctl -o json-pretty
journalctl -t mytag
journalctl --disk-usage
journalctl --vacuum-time=7d
```

Output:

```console
########## 1. journalctl --version / disk usage ##########
systemd 255 (255.4-1ubuntu8.17)
+PAM +AUDIT +SELINUX +APPARMOR +IMA +SMACK +SECCOMP +GCRYPT -GNUTLS +OPENSSL +ACL +BLKID +CURL +ELFUTILS +FIDO2 +IDN2 -IDN +IPTC +KMOD +LIBCRYPTSETUP +LIBFDISK +PCRE2 -PWQUALITY +P11KIT +QRENCODE +TPM2 +BZIP2 +LZ4 +XZ +ZLIB +ZSTD -BPF_FRAMEWORK -XKBCOMMON +UTMP +SYSVINIT default-hierarchy=unified
Archived and active journals take up 8.0M in the file system.

########## 2. Boot list (journalctl --list-boots) ##########
IDX BOOT ID                          FIRST ENTRY                 LAST ENTRY
  0 dfdd40b3f02a4a3b98ad4e208d31a469 Thu 2026-09-03 17:07:50 UTC Thu 2026-09-03 17:08:07 UTC

########## 3. Last 15 lines of the whole system journal (journalctl -n 15) ##########
Sep 03 17:07:50 fc2191ec585a systemd[1]: console-getty.service - Console Getty was skipped because of an unmet condition check (ConditionPathExists=/dev/console).
Sep 03 17:07:50 fc2191ec585a systemd[1]: Started getty@tty1.service - Getty on tty1.
Sep 03 17:07:50 fc2191ec585a systemd[1]: Reached target getty.target - Login Prompts.
Sep 03 17:07:50 fc2191ec585a systemd[1]: e2scrub_reap.service: Deactivated successfully.
Sep 03 17:07:50 fc2191ec585a systemd[1]: Finished e2scrub_reap.service - Remove Stale Online ext4 Metadata Check Snapshots.
Sep 03 17:07:50 fc2191ec585a systemd[1]: Started nginx.service - A high performance web server and a reverse proxy server.
Sep 03 17:07:50 fc2191ec585a systemd-logind[82]: New seat seat0.
Sep 03 17:07:50 fc2191ec585a systemd[1]: Started systemd-logind.service - User Login Management.
Sep 03 17:07:50 fc2191ec585a systemd[1]: Reached target multi-user.target - Multi-User System.
Sep 03 17:07:50 fc2191ec585a systemd[1]: Reached target graphical.target - Graphical Interface.
Sep 03 17:07:50 fc2191ec585a systemd[1]: Starting systemd-update-utmp-runlevel.service - Record Runlevel Change in UTMP...
Sep 03 17:07:50 fc2191ec585a systemd[1]: systemd-update-utmp-runlevel.service: Deactivated successfully.
Sep 03 17:07:50 fc2191ec585a systemd[1]: Finished systemd-update-utmp-runlevel.service - Record Runlevel Change in UTMP.
Sep 03 17:07:50 fc2191ec585a systemd[1]: Startup finished in 226ms.
Sep 03 17:08:07 fc2191ec585a systemd-resolved[72]: Clock change detected. Flushing caches.

########## 4. Logs for ONE service (journalctl -u nginx) ##########
Sep 03 17:07:50 fc2191ec585a systemd[1]: Starting nginx.service - A high performance web server and a reverse proxy server...
Sep 03 17:07:50 fc2191ec585a systemd[1]: Started nginx.service - A high performance web server and a reverse proxy server.

########## 5. Restart nginx, then show only new logs ##########
Sep 03 17:08:17 fc2191ec585a systemd[1]: Stopping nginx.service - A high performance web server and a reverse proxy server...
Sep 03 17:08:17 fc2191ec585a systemd[1]: nginx.service: Deactivated successfully.
Sep 03 17:08:17 fc2191ec585a systemd[1]: Stopped nginx.service - A high performance web server and a reverse proxy server.
Sep 03 17:08:17 fc2191ec585a systemd[1]: Starting nginx.service - A high performance web server and a reverse proxy server...
Sep 03 17:08:17 fc2191ec585a systemd[1]: Started nginx.service - A high performance web server and a reverse proxy server.

########## 6. Filter by priority (journalctl -p err -b) ##########
Sep 03 17:07:50 fc2191ec585a kernel: Out of memory: Killed process 11576 (python) total-vm:13348292kB, anon-rss:11097752kB, file-rss:4kB, shmem-rss:0kB, UID:0 pgtables:22272kB oom_score_adj:0

########## 7. Break nginx config on purpose and read the failure in the journal ##########
Job for nginx.service failed because the control process exited with error code.
See "systemctl status nginx.service" and "journalctl -xeu nginx.service" for details.
exit code of restart: 1
failed
Sep 03 17:07:50 fc2191ec585a systemd[1]: Starting nginx.service - A high performance web server and a reverse proxy server...
Sep 03 17:07:50 fc2191ec585a systemd[1]: Started nginx.service - A high performance web server and a reverse proxy server.
Sep 03 17:08:17 fc2191ec585a systemd[1]: Stopping nginx.service - A high performance web server and a reverse proxy server...
Sep 03 17:08:17 fc2191ec585a systemd[1]: nginx.service: Deactivated successfully.
Sep 03 17:08:17 fc2191ec585a systemd[1]: Stopped nginx.service - A high performance web server and a reverse proxy server.
Sep 03 17:08:17 fc2191ec585a systemd[1]: Starting nginx.service - A high performance web server and a reverse proxy server...
Sep 03 17:08:17 fc2191ec585a systemd[1]: Started nginx.service - A high performance web server and a reverse proxy server.
Sep 03 17:08:19 fc2191ec585a systemd[1]: Stopping nginx.service - A high performance web server and a reverse proxy server...
Sep 03 17:08:19 fc2191ec585a systemd[1]: nginx.service: Deactivated successfully.
Sep 03 17:08:19 fc2191ec585a systemd[1]: Stopped nginx.service - A high performance web server and a reverse proxy server.
Sep 03 17:08:19 fc2191ec585a systemd[1]: Starting nginx.service - A high performance web server and a reverse proxy server...
Sep 03 17:08:19 fc2191ec585a nginx[166]: 2026/09/03 17:08:19 [emerg] 166#166: unexpected end of file, expecting ";" or "}" in /etc/nginx/conf.d/broken.conf:2
Sep 03 17:08:19 fc2191ec585a nginx[166]: nginx: configuration file /etc/nginx/nginx.conf test failed
Sep 03 17:08:19 fc2191ec585a systemd[1]: nginx.service: Control process exited, code=exited, status=1/FAILURE
Sep 03 17:08:19 fc2191ec585a systemd[1]: nginx.service: Failed with result 'exit-code'.
Sep 03 17:08:19 fc2191ec585a systemd[1]: Failed to start nginx.service - A high performance web server and a reverse proxy server.
--- fix it back ---
active

########## 8. Kernel messages only (journalctl -k) ##########
Sep 03 17:07:50 fc2191ec585a kernel: vethe84e427: entered allmulticast mode
Sep 03 17:07:50 fc2191ec585a kernel: vethe84e427: entered promiscuous mode
Sep 03 17:07:50 fc2191ec585a kernel: eth0: renamed from veth2f2db96
Sep 03 17:07:50 fc2191ec585a kernel: docker0: port 2(vethe84e427) entered blocking state
Sep 03 17:07:50 fc2191ec585a kernel: docker0: port 2(vethe84e427) entered forwarding state
Sep 03 17:07:50 fc2191ec585a kernel: docker0: port 2(vethe84e427) entered disabled state
Sep 03 17:07:50 fc2191ec585a kernel: veth2f2db96: renamed from eth0
Sep 03 17:07:50 fc2191ec585a kernel: docker0: port 2(vethe84e427) entered disabled state
Sep 03 17:07:50 fc2191ec585a kernel: vethe84e427 (unregistering): left allmulticast mode
Sep 03 17:07:50 fc2191ec585a kernel: vethe84e427 (unregistering): left promiscuous mode

########## 9. JSON output for one entry (journalctl -u nginx -n 1 -o json-pretty) ##########
{
	"JOB_TYPE" : "start",
	"_CMDLINE" : "/lib/systemd/systemd",
	"_TRANSPORT" : "journal",
	"__CURSOR" : "s=5048c5639c1d4a208ada1624be1f5311;i=f27;b=dfdd40b3f02a4a3b98ad4e208d31a469;m=e0475e9b7;t=65a9732d89d13;x=c10fb52eb08f1023",
	"__REALTIME_TIMESTAMP" : "1788455299882259",
	"SYSLOG_IDENTIFIER" : "systemd",
	"__SEQNUM" : "3879",
	"_EXE" : "/usr/lib/systemd/systemd",
	"_SOURCE_REALTIME_TIMESTAMP" : "1788455299882232",
	"_SYSTEMD_UNIT" : "init.scope",
	"_CAP_EFFECTIVE" : "1ffffffffff",
	"_MACHINE_ID" : "427a5a93193040448ec52c22edc9aa58",
	"CODE_FILE" : "src/core/job.c",
	"_UID" : "0",
	"_RUNTIME_SCOPE" : "system",
	"__MONOTONIC_TIMESTAMP" : "60204378551",
	"JOB_ID" : "228",
	"CODE_LINE" : "796",
	"_BOOT_ID" : "dfdd40b3f02a4a3b98ad4e208d31a469",
	"TID" : "1",
	"_SYSTEMD_SLICE" : "-.slice",
	"PRIORITY" : "6",
	"_COMM" : "systemd",
	"_HOSTNAME" : "fc2191ec585a",
	"JOB_RESULT" : "done",
	"UNIT" : "nginx.service",
	"_PID" : "1",
	"INVOCATION_ID" : "c21e056de43e4b87b019ea0f2ede498e",
	"CODE_FUNC" : "job_emit_done_message",
	"_GID" : "0",
	"MESSAGE_ID" : "39f53479d3a045ac8e11786248231fbf",
	"_SYSTEMD_CGROUP" : "/init.scope",
	"MESSAGE" : "Started nginx.service - A high performance web server and a reverse proxy server.",
	"SYSLOG_FACILITY" : "3",
	"__SEQNUM_ID" : "5048c5639c1d4a208ada1624be1f5311"
}

########## 10. Write a custom log with systemd-cat and read it back by tag ##########
Sep 03 17:08:19 fc2191ec585a devops-homework[197]: Ashutosh: hello from systemd-cat
```

The bit that matters is step 7. I dropped a junk file into /etc/nginx/conf.d, restarted,
got exit code 1, and the journal had the actual reason:

```
nginx[166]: [emerg] unexpected end of file, expecting ";" or "}" in /etc/nginx/conf.d/broken.conf:2
nginx.service: Failed with result 'exit-code'.
```

That is the normal loop - service won't start, run `journalctl -xeu <unit>`, read the emerg
line. `-p err` cut everything down to one real kernel OOM kill. `-o json-pretty` shows the
fields behind a single line, which is what makes all the filtering possible.

One gotcha: on a lot of systems the journal lives in /run/log/journal which is tmpfs, so it
is gone after a reboot and `journalctl -b -1` has nothing. Fix:

```bash
sudo mkdir -p /var/log/journal
sudo systemd-tmpfiles --create --prefix /var/log/journal
sudo systemctl restart systemd-journald
```

## Task 4 - command cheat sheet

Ran everything below, output is at the bottom.

| area | commands |
|---|---|
| basics | pwd, ls -lah, cd, whoami, id, hostname, uname -a, uptime, date |
| files | mkdir -p, touch, cat, head, tail, wc, cp, mv, rm, du -sh, find |
| permissions | chmod (octal and symbolic), chown, umask |
| text | grep, awk, sed, cut, sort, uniq, tr |
| processes | ps aux, ps -ef, top -b, pgrep, pkill, &, free -h |
| disk | df -h, du --max-depth, lsblk, mount |
| archives | tar -czf/-tzf/-xzf, gzip, gunzip |
| search | find by name/type/size, which, type |
| services | systemctl is-active / list-units, dpkg -l, apt list --installed |
| redirection | >, >>, 2>, 2>&1, pipes, tee |
| env | echo $VAR, export, printenv |

Short version of what each does:

- pwd where am I, ls -lah long listing with dotfiles and readable sizes, cd is a shell
  builtin (that's why `type cd` says so), whoami vs id for name vs uid/gid/groups,
  uname -a for kernel and arch, uptime also gives 1/5/15 min load averages.
- mkdir -p makes parents and doesn't complain if it exists. touch creates empty or bumps
  mtime. head/tail -n, tail -f follows a log. cp -r and rm -r for directories. df is about
  filesystems, du is about directories - easy to mix up.
- chmod 750 = owner rwx, group r-x, others nothing. chmod u+x,g-r is the symbolic form.
  umask 0022 is why new files come out 644 and new dirs 755.
- grep -n/-r/-i/-v, awk -F: '{print $1,$3}' to pull fields, sed 's/a/b/g' (-i to edit in
  place), cut -d: -f1,7, sort then uniq -c because uniq only collapses adjacent lines,
  tr ' ' '\n' to split a line into words.
- ps aux and ps -ef are just two output formats. top -b -n 1 makes top scriptable.
  pgrep -a to find, pkill to signal. cmd & backgrounds it and $! is its pid. kill is TERM,
  kill -9 is KILL and should be the last resort.
- df -h is the "disk is full" command, du -h --max-depth=1 /var tells you which dir did it.
- tar czf create, tzf list without extracting, xzf extract, -C to pick where.
- find /path -name '*.md', plus -type f/d, -size -1k, -mtime -7. which = where on PATH,
  type = what the shell will really run (builtin/alias/function/file).
- systemctl start/stop/restart/status/enable/is-active, enable means at boot.
- > overwrite, >> append, 2> stderr only, 2>&1 stderr to wherever stdout went, tee writes
  to a file and passes the data on.
- export puts a var in the environment so children inherit it. In the output $USER is empty
  because login shells set it and I ran through `bash -c`.

Output:

```console
==================== NAVIGATION & INSPECTION ====================

$ pwd
/cheat

$ ls -lah /etc | head -6
total 520K
drwxr-xr-x 1 root root   4.0K Sep  3 17:08 .
drwxr-xr-x 1 root root   4.0K Sep  3 17:11 ..
-rw------- 1 root root      0 Aug 10 14:49 .pwd.lock
-rw-r--r-- 1 root root    208 Aug 10 14:49 .updated
drwxr-xr-x 3 root root   4.0K Sep  3 17:07 X11

$ cd /tmp && pwd && cd /cheat
/tmp

$ whoami
root

$ id
uid=0(root) gid=0(root) groups=0(root)

$ hostname
fc2191ec585a

$ uname -a
Linux fc2191ec585a 7.0.12-linuxkit #1 SMP PREEMPT Fri Aug 14 16:27:59 UTC 2026 aarch64 aarch64 aarch64 GNU/Linux

$ uptime
 17:11:55 up 16:47,  0 user,  load average: 0.18, 0.35, 0.54

$ date
Thu Sep  3 17:11:55 UTC 2026

==================== FILES & DIRECTORIES ====================

$ mkdir -p project/{src,docs}

$ find project -type d
project
project/docs
project/src

$ touch project/src/app.py project/docs/notes.md

$ printf 'line one\nline two\nline three\n' > project/docs/notes.md

$ cat project/docs/notes.md
line one
line two
line three

$ head -2 project/docs/notes.md
line one
line two

$ tail -1 project/docs/notes.md
line three

$ wc -l project/docs/notes.md
3 project/docs/notes.md

$ cp project/docs/notes.md project/docs/notes-backup.md

$ mv project/docs/notes-backup.md project/docs/old-notes.md

$ ls project/docs
notes.md
old-notes.md

$ rm project/docs/old-notes.md && ls project/docs
notes.md

$ du -sh project
16K	project

$ tree project || find project
bash: line 1: tree: command not found
project
project/docs
project/docs/notes.md
project/src
project/src/app.py

==================== PERMISSIONS & OWNERSHIP ====================

$ ls -l project/src/app.py
-rw-r--r-- 1 root root 0 Sep  3 17:11 project/src/app.py

$ chmod 750 project/src/app.py && ls -l project/src/app.py
-rwxr-x--- 1 root root 0 Sep  3 17:11 project/src/app.py

$ chmod u+x,g-r project/src/app.py && ls -l project/src/app.py
-rwx--x--- 1 root root 0 Sep  3 17:11 project/src/app.py

$ useradd -m appuser 2>/dev/null; chown appuser:appuser project/src/app.py && ls -l project/src/app.py
-rwx--x--- 1 appuser appuser 0 Sep  3 17:11 project/src/app.py

$ umask
0022

==================== TEXT PROCESSING ====================

$ grep -n 'two' project/docs/notes.md
2:line two

$ grep -ri 'root' /etc/passwd
root:x:0:0:root:/root:/bin/bash

$ awk -F: '{print $1, $3}' /etc/passwd | head -5
root 0
daemon 1
bin 2
sys 3
sync 4

$ sed 's/line/LINE/g' project/docs/notes.md
LINE one
LINE two
LINE three

$ cut -d: -f1,7 /etc/passwd | head -5
root:/bin/bash
daemon:/usr/sbin/nologin
bin:/usr/sbin/nologin
sys:/usr/sbin/nologin
sync:/bin/sync

$ sort -r project/docs/notes.md
line two
line three
line one

$ cat /etc/passwd | wc -l
24

$ echo 'a b a c a' | tr ' ' '\n' | sort | uniq -c
      3 a
      1 b
      1 c

==================== PROCESSES ====================

$ ps aux | head -6
USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root           1  0.0  0.0  21012 11656 ?        Ss   17:07   0:00 /lib/systemd/systemd
root          23  0.0  0.0  33764 11860 ?        S<s  17:07   0:00 /usr/lib/systemd/systemd-journald
systemd+      72  0.0  0.0  21436 12384 ?        Ss   17:07   0:00 /usr/lib/systemd/systemd-resolved
message+      79  0.0  0.0   9512  4364 ?        Ss   17:07   0:00 @dbus-daemon --system --address=systemd: --nofork --nopidfile --systemd-activation --syslog-only
root          82  0.0  0.0  17268  7132 ?        Ss   17:07   0:00 /usr/lib/systemd/systemd-logind

$ ps -ef | grep nginx | grep -v grep
root         175       1  0 17:08 ?        00:00:00 nginx: master process /usr/sbin/nginx -g daemon on; master_process on;
www-data     176     175  0 17:08 ?        00:00:00 nginx: worker process
www-data     177     175  0 17:08 ?        00:00:00 nginx: worker process
www-data     178     175  0 17:08 ?        00:00:00 nginx: worker process
www-data     179     175  0 17:08 ?        00:00:00 nginx: worker process
www-data     180     175  0 17:08 ?        00:00:00 nginx: worker process
www-data     182     175  0 17:08 ?        00:00:00 nginx: worker process
www-data     183     175  0 17:08 ?        00:00:00 nginx: worker process
www-data     185     175  0 17:08 ?        00:00:00 nginx: worker process
www-data     186     175  0 17:08 ?        00:00:00 nginx: worker process
www-data     187     175  0 17:08 ?        00:00:00 nginx: worker process
www-data     188     175  0 17:08 ?        00:00:00 nginx: worker process
www-data     189     175  0 17:08 ?        00:00:00 nginx: worker process
www-data     190     175  0 17:08 ?        00:00:00 nginx: worker process

$ top -b -n 1 | head -8
top - 17:11:56 up 16:47,  0 user,  load average: 0.18, 0.35, 0.54
Tasks:  28 total,   1 running,  27 sleeping,   0 stopped,   0 zombie
%Cpu(s):  0.6 us,  0.0 sy,  0.0 ni, 99.4 id,  0.0 wa,  0.0 hi,  0.0 si,  0.0 st 
MiB Mem :  16220.9 total,   1479.9 free,   8680.4 used,   6494.4 buff/cache     
MiB Swap:   4096.0 total,   1521.4 free,   2574.6 used.   7540.5 avail Mem 

    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND
      1 root      20   0   21012  11656   8920 S   0.0   0.1   0:00.20 systemd

$ pgrep -a nginx
175 nginx: master process /usr/sbin/nginx -g daemon on; master_process on;
176 nginx: worker process
177 nginx: worker process
178 nginx: worker process
179 nginx: worker process
180 nginx: worker process
182 nginx: worker process
183 nginx: worker process
185 nginx: worker process
186 nginx: worker process
187 nginx: worker process
188 nginx: worker process
189 nginx: worker process
190 nginx: worker process

$ sleep 300 >/dev/null 2>&1 & echo started background sleep with PID $!; sleep 1; pgrep -a sleep
started background sleep with PID 917
917 sleep 300

$ pkill -f 'sleep 300' && echo killed the background sleep

$ free -h
               total        used        free      shared  buff/cache   available
Mem:            15Gi       8.5Gi       1.4Gi       181Mi       6.3Gi       7.4Gi
Swap:          4.0Gi       2.5Gi       1.5Gi

==================== DISK ====================

$ df -h | head -5
Filesystem      Size  Used Avail Use% Mounted on
overlay         911G  161G  705G  19% /
tmpfs            64M     0   64M   0% /dev
shm              64M     0   64M   0% /dev/shm
/dev/vda1       911G  161G  705G  19% /etc/hosts

$ du -h --max-depth=1 /var | head -6
4.0K	/var/opt
20K	/var/tmp
8.4M	/var/log
4.0K	/var/spool
4.0K	/var/backups
4.0K	/var/mail

$ lsblk 2>/dev/null || echo 'lsblk not available in container'
NAME   MAJ:MIN RM   SIZE RO TYPE MOUNTPOINTS
nbd0    43:0    0     0B  0 disk 
nbd1    43:32   0     0B  0 disk 
nbd2    43:64   0     0B  0 disk 
nbd3    43:96   0     0B  0 disk 
nbd4    43:128  0     0B  0 disk 
nbd5    43:160  0     0B  0 disk 
nbd6    43:192  0     0B  0 disk 
nbd7    43:224  0     0B  0 disk 
vda    254:0    0 926.3G  0 disk 
`-vda1 254:1    0 926.3G  0 part /etc/hosts
                                 /etc/hostname
                                 /etc/resolv.conf
vdb    254:16   0   644M  1 disk 

$ mount | head -5
overlay on / type overlay (rw,relatime,lowerdir=/var/lib/desktop-containerd/daemon/io.containerd.snapshotter.v1.overlayfs/snapshots/5198/fs:/var/lib/desktop-containerd/daemon/io.containerd.snapshotter.v1.overlayfs/snapshots/5197/fs:/var/lib/desktop-containerd/daemon/io.containerd.snapshotter.v1.overlayfs/snapshots/5185/fs,upperdir=/var/lib/desktop-containerd/daemon/io.containerd.snapshotter.v1.overlayfs/snapshots/5199/fs,workdir=/var/lib/desktop-containerd/daemon/io.containerd.snapshotter.v1.overlayfs/snapshots/5199/work,nouserxattr)
proc on /proc type proc (rw,nosuid,nodev,noexec,relatime)
tmpfs on /dev type tmpfs (rw,nosuid,size=65536k,mode=755)
devpts on /dev/pts type devpts (rw,nosuid,noexec,relatime,gid=5,mode=620,ptmxmode=666)
sysfs on /sys type sysfs (rw,nosuid,nodev,noexec,relatime)

==================== ARCHIVE & COMPRESS ====================

$ tar -czf project.tar.gz project && ls -lh project.tar.gz
-rw-r--r-- 1 root root 242 Sep  3 17:11 project.tar.gz

$ tar -tzf project.tar.gz | head -5
project/
project/docs/
project/docs/notes.md
project/src/
project/src/app.py

$ mkdir -p restore && tar -xzf project.tar.gz -C restore && find restore -type f
restore/project/docs/notes.md
restore/project/src/app.py

$ gzip -k project/docs/notes.md && ls project/docs
notes.md
notes.md.gz

$ gunzip project/docs/notes.md.gz && ls project/docs
gzip: project/docs/notes.md already exists;	not overwritten

==================== SEARCH ====================

$ find /etc /usr -maxdepth 2 -name 'passwd' 2>/dev/null
/etc/pam.d/passwd
/etc/passwd
/usr/bin/passwd

$ find /cheat -name '*.md'
/cheat/restore/project/docs/notes.md
/cheat/project/docs/notes.md

$ find /cheat -type f -size -1k | head -5
/cheat/restore/project/src/app.py
/cheat/project/src/app.py

$ which bash grep
/usr/bin/bash
/usr/bin/grep

$ type cd
cd is a shell builtin

==================== SERVICES & PACKAGES ====================

$ systemctl is-active nginx
active

$ systemctl list-units --type=service --state=running --no-pager | head -8
  UNIT                     LOAD   ACTIVE SUB     DESCRIPTION
  dbus.service             loaded active running D-Bus System Message Bus
  getty@tty1.service       loaded active running Getty on tty1
  nginx.service            loaded active running A high performance web server and a reverse proxy server
  systemd-journald.service loaded active running Journal Service
  systemd-logind.service   loaded active running User Login Management
  systemd-resolved.service loaded active running Network Name Resolution


$ dpkg -l | grep nginx | head -3
ii  nginx                         1.24.0-2ubuntu7.17                arm64        small, powerful, scalable web/proxy server
ii  nginx-common                  1.24.0-2ubuntu7.17                all          small, powerful, scalable web/proxy server - common files

$ apt list --installed 2>/dev/null | head -5
Listing...
adduser/now 3.137ubuntu1 all [installed,local]
apt/now 2.8.3 arm64 [installed,local]
base-files/now 13ubuntu10.4 arm64 [installed,local]
base-passwd/now 3.6.3build1 arm64 [installed,local]

==================== REDIRECTION & PIPES ====================

$ echo 'stdout goes to a file' > out.txt && cat out.txt
stdout goes to a file

$ echo 'appended line' >> out.txt && cat out.txt
stdout goes to a file
appended line

$ ls /does-not-exist 2> err.txt; cat err.txt
ls: cannot access '/does-not-exist': No such file or directory

$ ls /etc /does-not-exist > both.txt 2>&1; tail -3 both.txt
vconsole.conf
xattr.conf
xdg

$ cat /etc/passwd | grep root | cut -d: -f1
root

$ echo 'piped into a file' | tee tee-out.txt
piped into a file

==================== ENV & VARIABLES ====================

$ echo $HOME $USER $SHELL
/root /bin/bash

$ export MY_VAR='devops' && echo $MY_VAR
devops

$ printenv PATH
/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

$ history 2>/dev/null | tail -3 || echo 'history is interactive-shell only'
```
