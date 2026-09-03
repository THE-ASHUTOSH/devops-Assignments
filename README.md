# DevOps Assignments

Homework for the DevOps sessions - Linux, shell scripting, networking, git and Docker.

**Ashutosh Kumar** · enrollment **24bcs10111**

Every section has its own folder with a README containing the commands I ran and the actual
output, not retyped examples. Where a task needed Linux specifically (adduser, journalctl,
ip/ss, systemctl) I ran it in a container, since I'm on a Mac.

| # | section | what's in it |
|---|---|---|
| 1 | [linux/](linux/) | soft vs hard links, adduser vs useradd, journalctl, command cheat sheet |
| 2 | [shell/](shell/) | `info.sh` - system info script with read -p, mkdir, touch and output redirection |
| 3 | [networking/](networking/) | ip, routing, ping, traceroute, dig, curl, ss, tcpdump, nmap and what each showed |
| 4 | [git/](git/) | `commit -m` vs `commit -a -m`, and a cherry-pick between branches |
| 5 | [docker/](docker/) | six Hello World web apps - node, python, java, apache, react, nginx |
| 6 | [multistage/](multistage/) | multi-stage build on port 8080, 471MB down to 20.6MB |
| 7 | [docker-network/](docker-network/) | 3 containers across 3 networks, host network, bind mount, overlay notes |

## Layout

```
├── linux/
├── shell/
│   └── info.sh
├── networking/
├── git/
├── docker/
│   ├── nodejs-app/
│   ├── python-app/
│   ├── java-app/
│   ├── Apache-app/
│   ├── React-app/
│   └── nginx-app/
├── multistage/
│   ├── main.go
│   ├── Dockerfile
│   └── Dockerfile.single
└── docker-network/
    └── site/
```

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

## Ran on

macOS (Apple silicon), Docker Desktop 29.7.2, git 2.50.1. Linux bits inside ubuntu:24.04 containers.
