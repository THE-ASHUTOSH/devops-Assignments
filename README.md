# DevOps Assignments

Homework for the DevOps sessions - Linux, shell scripting, networking, git and Docker.

**Ashutosh Kumar** · enrollment **24bcs10111**

Every section has its own folder with a README containing the commands I ran and the actual
output, not retyped examples. Where a task needed Linux specifically (adduser, journalctl,
ip/ss, systemctl) I ran it in a container, since I'm on a Mac.

| # | section | what's in it |
|---|---|---|
| 1 | [Linux Fundamental](Linux%20Fundamental/) | soft vs hard links, adduser vs useradd, journalctl, command cheat sheet |
| 2 | [Shell Scripting](Shell%20Scripting/) | `info.sh` - system info script with read -p, mkdir, touch and output redirection |
| 3 | [Netwroking Fundamentals](Netwroking%20Fundamentals/) | ip, routing, ping, traceroute, dig, curl, ss, tcpdump, nmap and what each showed |
| 4 | [Git-GitHub](Git-GitHub/) | `commit -m` vs `commit -a -m`, and a cherry-pick between branches |
| 5 | [Docker Fundamental](Docker%20Fundamental/) | six Hello World web apps - node, python, java, apache, react, nginx (+ screenshots) |
| 6 | [Dockerfiles & Images](Dockerfiles%20%26%20Images/) | multi-stage build on port 8080, 471MB down to 20.6MB (+ screenshot) |
| 7 | [Docker Network](Docker%20Network/) | 3 containers across 3 networks, host network, bind mount (+ screenshots), overlay notes |

## Layout

```
├── Linux Fundamental/
├── Shell Scripting/
│   └── info.sh
├── Netwroking Fundamentals/
├── Git-GitHub/
├── Docker Fundamental/
│   ├── nodejs-app/
│   ├── python-app/
│   ├── java-app/
│   ├── Apache-app/
│   ├── React-app/
│   └── nginx-app/
├── Dockerfiles & Images/
│   ├── main.go
│   ├── Dockerfile
│   └── Dockerfile.single
└── Docker Network/
    └── site/
```

Folder names are the section headings from the assignment doc, so they line up one-to-one with it.
Two had to bend slightly: `Git/GitHub` became `Git-GitHub` because a folder name can't contain a
slash, and `Netwroking Fundamentals` keeps the doc's spelling. The six app folders inside
`Docker Fundamental/` are named exactly as the doc lists them.

## A few things worth calling out

- The journalctl section runs against a container booting **systemd as PID 1**, so
  `systemctl status` and `journalctl -u nginx` give real output. I also broke the nginx config on
  purpose to show what a failed unit looks like in the journal.
- The multi-stage section builds the same Go app twice, one stage vs two, so the 471MB → 20.6MB
  difference is measured rather than quoted.
- The host-network task **failed the first time** because port 80 was already in use, and I left
  that in - it demonstrates what host mode actually does better than a clean run would.
- Ports on the left of `-p` are shifted off the defaults in a few places because 80, 5000 and
  8081-8091 were already taken on my machine.
- Screenshots were taken with playwright against the live containers, for the tasks that ask to
  see something in a browser. The rest of the tasks are terminal work, so those keep the actual
  command output instead.

## Ran on

macOS (Apple silicon), Docker Desktop 29.7.2, git 2.50.1. Linux bits inside ubuntu:24.04 containers.
