# Networking Fundamentals

Ran these in a container off ubuntu:24.04 with iproute2, net-tools, dnsutils, traceroute,
curl, wget, netcat, nmap, tcpdump, mtr and whois installed. tcpdump and traceroute needed
NET_ADMIN and NET_RAW to work.

Note on task 1: I didn't have access to the devops-hero repo, so I worked through the same
command set myself and wrote up what each one does below.

## What I got out of each command

**Interfaces and addresses**

- `ip addr show` / `ip -brief addr` - the modern way to see interfaces and their IPs. The
  container has lo (127.0.0.1) and eth0 on 172.17.0.6/16, which is Docker's default bridge.
  All the tunl0/gre0/sit0 entries are unconfigured tunnel devices the kernel exposes, they sit
  DOWN and can be ignored.
- `ifconfig` - the old net-tools version. Same info, different layout, plus RX/TX packet
  counters. Deprecated but still on every box.
- `ip link show` - layer 2 only, so MAC, MTU and up/down state, no IPs. Worth noticing
  `eth0@if439` - the @ifNNN means it's one end of a veth pair and the other end is on the host.
- `hostname -I` - just the IP, handy in scripts.

**Routing**

- `ip route` - the routing table. `default via 172.17.0.1` is the gateway, which is the docker0
  bridge on the host. The second line is the directly connected /16, no gateway needed for that.
- `route -n` - same table, old format. -n stops it doing reverse DNS on every row.
- `ip route get 8.8.8.8` - the useful one. Rather than reading the table and working it out
  yourself you ask the kernel which route it would actually pick and which source IP it'd use.

**Connectivity**

- `ping -c 4 8.8.8.8` - ICMP echo, 0% loss, avg 25ms. If IP pings work but names don't, it's DNS.
- `ping -c 3 google.com` - resolved to 142.251.221.238, reverse name pnbomb-bk-in-f14.1e100.net,
  so a Google edge node in Mumbai.
- ttl=63 in the replies: TTL starts at 64 and drops 1 per hop, so 63 means one hop (the NAT
  gateway) in between.
- `traceroute -m 8 8.8.8.8` - only hop 1 answered, rest are `* * *`. That's normal here rather
  than a fault, traceroute sends UDP probes by default and these routers drop them.
- `mtr -r -c 3 8.8.8.8` - traceroute plus ping in one, and it got through where traceroute didn't
  because it uses ICMP. Gives per-hop loss and jitter, better for "which hop is adding latency".

**DNS**

- `/etc/resolv.conf` - which resolver the box uses. Docker put 192.168.65.7 there, that's Docker
  Desktop's internal DNS.
- `dig google.com` - the full answer. `status: NOERROR` means it worked, ANSWER SECTION has the A
  record, 184 is the TTL in seconds, and it names the server that answered.
- `dig +short` - just the IP, for scripts.
- `dig google.com MX +short` - mail records, got `10 smtp.google.com` where 10 is the priority.
- `dig -x 8.8.8.8 +short` - reverse lookup, IP to name, gave dns.google.
- `nslookup github.com` - older tool. "Non-authoritative answer" only means it came from the
  resolver's cache, not from github's own nameservers.
- `host github.com` - simplest of the three, printed the MX record too.
- `/etc/nsswitch.conf` says `hosts: files dns`, so /etc/hosts wins before DNS is even asked.
  That's why a hosts entry can override a real domain.

**HTTP**

- `curl -I` - HEAD request, headers only. HTTP/2 200, served by cloudflare, and
  `cf-cache-status: HIT` means it came from the CDN cache instead of the origin.
- `curl -w` with the timing variables is the one worth memorising: dns=0.003s, connect=0.040s,
  tls=0.057s, total=0.075s. Splits a slow request into slow DNS vs slow TCP vs slow TLS vs slow
  server instead of guessing.
- `curl -s` / `wget -q -O-` - fetch the body. curl writes to stdout by default, wget saves to a
  file unless you pass -O-.

**Ports and sockets**

- Started a listener with `nc -l -p 9099` first so there'd be something to find.
- `ss -tulnp` - the one I'd actually reach for. t=tcp u=udp l=listening n=numeric p=process.
  Found nc on 0.0.0.0:9099 with its pid.
- `netstat -tulnp` - same flags, same answer, older tool. ss is faster because it reads netlink
  rather than parsing /proc.
- `lsof -i -P -n` - same thing from the file-descriptor side, better when you want everything one
  process has open.
- `nc -zv host port` - port check, -z means connect and quit. "succeeded" for local 9099 and for
  google.com 443, "Connection refused" for 9999. Refused vs timeout matters: refused means
  something actively said no so nothing is listening, a hang usually means a firewall dropped it.

**ARP**

- `ip neigh` / `arp -a` - IP to MAC for the local segment. Only entry is the gateway 172.17.0.1
  at be:6f:8a:cc:28:ae, REACHABLE. ARP is layer 2 so it only knows the local network, never
  anything past the router.

**Scan and firewall**

- `nmap -Pn -p 80,443 example.com` - both open. -Pn skips the ping probe, which matters because
  plenty of hosts drop ICMP and nmap would call them down otherwise. It also spotted that
  example.com has more than one A record.
- `iptables -L -n` - all three chains empty with policy ACCEPT, nothing being filtered in here.

**Packet capture**

- `tcpdump -i any -c 6 -n icmp` with a ping running in the background. You can watch the request
  go Out and the reply come In, matched by the id and seq fields. -n skips DNS on every packet,
  -c limits the count so it exits on its own.

**Misc**

- `/etc/hosts` - static local mappings, Docker adds a line for the container's own hostname.
- `whois example.com` - registration data. Created 1995, registrar is IANA because it's a
  reserved documentation domain.

## Output

```console
########## INTERFACES & ADDRESSES ##########

$ ip addr show
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
    inet 127.0.0.1/8 scope host lo
       valid_lft forever preferred_lft forever
    inet6 ::1/128 scope host 
       valid_lft forever preferred_lft forever
2: tunl0@NONE: <NOARP> mtu 1480 qdisc noop state DOWN group default qlen 1000
    link/ipip 0.0.0.0 brd 0.0.0.0
3: gre0@NONE: <NOARP> mtu 1476 qdisc noop state DOWN group default qlen 1000
    link/gre 0.0.0.0 brd 0.0.0.0
4: gretap0@NONE: <BROADCAST,MULTICAST> mtu 1462 qdisc noop state DOWN group default qlen 1000
    link/ether 00:00:00:00:00:00 brd ff:ff:ff:ff:ff:ff
5: erspan0@NONE: <BROADCAST,MULTICAST> mtu 1450 qdisc noop state DOWN group default qlen 1000
    link/ether 00:00:00:00:00:00 brd ff:ff:ff:ff:ff:ff
6: ip_vti0@NONE: <NOARP> mtu 1480 qdisc noop state DOWN group default qlen 1000
    link/ipip 0.0.0.0 brd 0.0.0.0
7: ip6_vti0@NONE: <NOARP> mtu 1428 qdisc noop state DOWN group default qlen 1000
    link/tunnel6 :: brd :: permaddr 6e99:94d1:e7f6::
8: sit0@NONE: <NOARP> mtu 1480 qdisc noop state DOWN group default qlen 1000
    link/sit 0.0.0.0 brd 0.0.0.0
9: ip6tnl0@NONE: <NOARP> mtu 1452 qdisc noop state DOWN group default qlen 1000
    link/tunnel6 :: brd :: permaddr 9aab:f866:a247::

$ ip -brief addr
lo               UNKNOWN        127.0.0.1/8 ::1/128 
tunl0@NONE       DOWN           
gre0@NONE        DOWN           
gretap0@NONE     DOWN           
erspan0@NONE     DOWN           
ip_vti0@NONE     DOWN           
ip6_vti0@NONE    DOWN           
sit0@NONE        DOWN           
ip6tnl0@NONE     DOWN           
ip6gre0@NONE     DOWN           
eth0@if439       UP             172.17.0.6/16 

$ ifconfig
eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 65535
        inet 172.17.0.6  netmask 255.255.0.0  broadcast 172.17.255.255
        ether 4a:00:c2:d9:db:10  txqueuelen 0  (Ethernet)
        RX packets 2  bytes 152 (152.0 B)
        RX errors 0  dropped 0  overruns 0  frame 0
        TX packets 1  bytes 42 (42.0 B)
        TX errors 0  dropped 0 overruns 0  carrier 0  collisions 0

lo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536
        inet 127.0.0.1  netmask 255.0.0.0
        inet6 ::1  prefixlen 128  scopeid 0x10<host>
        loop  txqueuelen 1000  (Local Loopback)
        RX packets 0  bytes 0 (0.0 B)
        RX errors 0  dropped 0  overruns 0  frame 0
        TX packets 0  bytes 0 (0.0 B)
        TX errors 0  dropped 0 overruns 0  carrier 0  collisions 0


$ hostname -I
172.17.0.6 

$ ip link show
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
2: tunl0@NONE: <NOARP> mtu 1480 qdisc noop state DOWN mode DEFAULT group default qlen 1000
    link/ipip 0.0.0.0 brd 0.0.0.0
3: gre0@NONE: <NOARP> mtu 1476 qdisc noop state DOWN mode DEFAULT group default qlen 1000
    link/gre 0.0.0.0 brd 0.0.0.0
4: gretap0@NONE: <BROADCAST,MULTICAST> mtu 1462 qdisc noop state DOWN mode DEFAULT group default qlen 1000
    link/ether 00:00:00:00:00:00 brd ff:ff:ff:ff:ff:ff
5: erspan0@NONE: <BROADCAST,MULTICAST> mtu 1450 qdisc noop state DOWN mode DEFAULT group default qlen 1000
    link/ether 00:00:00:00:00:00 brd ff:ff:ff:ff:ff:ff
6: ip_vti0@NONE: <NOARP> mtu 1480 qdisc noop state DOWN mode DEFAULT group default qlen 1000
    link/ipip 0.0.0.0 brd 0.0.0.0
7: ip6_vti0@NONE: <NOARP> mtu 1428 qdisc noop state DOWN mode DEFAULT group default qlen 1000
    link/tunnel6 :: brd :: permaddr 6e99:94d1:e7f6::
8: sit0@NONE: <NOARP> mtu 1480 qdisc noop state DOWN mode DEFAULT group default qlen 1000
    link/sit 0.0.0.0 brd 0.0.0.0
9: ip6tnl0@NONE: <NOARP> mtu 1452 qdisc noop state DOWN mode DEFAULT group default qlen 1000
    link/tunnel6 :: brd :: permaddr 9aab:f866:a247::
10: ip6gre0@NONE: <NOARP> mtu 1448 qdisc noop state DOWN mode DEFAULT group default qlen 1000
    link/gre6 :: brd :: permaddr e20b:3c90:b601::
11: eth0@if439: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 65535 qdisc noqueue state UP mode DEFAULT group default 
    link/ether 4a:00:c2:d9:db:10 brd ff:ff:ff:ff:ff:ff link-netnsid 0

########## ROUTING ##########

$ ip route
default via 172.17.0.1 dev eth0 
172.17.0.0/16 dev eth0 proto kernel scope link src 172.17.0.6 

$ route -n
Kernel IP routing table
Destination     Gateway         Genmask         Flags Metric Ref    Use Iface
0.0.0.0         172.17.0.1      0.0.0.0         UG    0      0        0 eth0
172.17.0.0      0.0.0.0         255.255.0.0     U     0      0        0 eth0

$ ip route get 8.8.8.8
8.8.8.8 via 172.17.0.1 dev eth0 src 172.17.0.6 uid 0 
    cache 

########## CONNECTIVITY ##########

$ ping -c 4 8.8.8.8
PING 8.8.8.8 (8.8.8.8) 56(84) bytes of data.
64 bytes from 8.8.8.8: icmp_seq=1 ttl=63 time=15.3 ms
64 bytes from 8.8.8.8: icmp_seq=2 ttl=63 time=25.4 ms
64 bytes from 8.8.8.8: icmp_seq=3 ttl=63 time=42.1 ms
64 bytes from 8.8.8.8: icmp_seq=4 ttl=63 time=18.5 ms

--- 8.8.8.8 ping statistics ---
4 packets transmitted, 4 received, 0% packet loss, time 3006ms
rtt min/avg/max/mdev = 15.345/25.341/42.116/10.338 ms

$ ping -c 3 google.com
PING google.com (142.251.221.238) 56(84) bytes of data.
64 bytes from pnbomb-bk-in-f14.1e100.net (142.251.221.238): icmp_seq=1 ttl=63 time=28.1 ms
64 bytes from pnbomb-bk-in-f14.1e100.net (142.251.221.238): icmp_seq=2 ttl=63 time=30.2 ms
64 bytes from pnbomb-bk-in-f14.1e100.net (142.251.221.238): icmp_seq=3 ttl=63 time=31.0 ms

--- google.com ping statistics ---
3 packets transmitted, 3 received, 0% packet loss, time 4108ms
rtt min/avg/max/mdev = 28.142/29.771/30.978/1.195 ms

$ traceroute -m 8 8.8.8.8
traceroute to 8.8.8.8 (8.8.8.8), 8 hops max, 60 byte packets
 1  172.17.0.1 (172.17.0.1)  0.643 ms  0.021 ms  0.012 ms
 2  * * *
 3  * * *
 4  * * *
 5  * * *
 6  * * *
 7  * * *
 8  * * *

$ mtr -r -c 3 8.8.8.8
Start: 2026-09-03T17:17:00+0000
HOST: 3792602945c5                Loss%   Snt   Last   Avg  Best  Wrst StDev
  1.|-- 172.17.0.1                 0.0%     3    0.2   0.2   0.2   0.2   0.0
  2.|-- dns.google                 0.0%     3   20.5  16.7  13.2  20.5   3.7

########## DNS ##########

$ cat /etc/resolv.conf
# Generated by Docker Engine.
# This file can be edited; Docker Engine will not make further changes once it
# has been modified.

nameserver 192.168.65.7

# Based on host file: '/etc/resolv.conf' (legacy)
# Overrides: []

$ dig google.com

; <<>> DiG 9.18.39-0ubuntu0.24.04.7-Ubuntu <<>> google.com
;; global options: +cmd
;; Got answer:
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 31124
;; flags: qr rd ra; QUERY: 1, ANSWER: 1, AUTHORITY: 0, ADDITIONAL: 0

;; QUESTION SECTION:
;google.com.			IN	A

;; ANSWER SECTION:
google.com.		184	IN	A	142.251.221.238

;; Query time: 2 msec
;; SERVER: 192.168.65.7#53(192.168.65.7) (UDP)
;; WHEN: Thu Sep 03 17:17:09 UTC 2026
;; MSG SIZE  rcvd: 54


$ dig +short google.com
142.251.221.238

$ dig google.com MX +short
10 smtp.google.com.

$ dig -x 8.8.8.8 +short
dns.google.

$ nslookup github.com
Server:		192.168.65.7
Address:	192.168.65.7#53

Non-authoritative answer:
Name:	github.com
Address: 20.207.73.82


$ host github.com
github.com has address 20.207.73.82
github.com mail is handled by 0 github-com.mail.protection.outlook.com.

########## HTTP ##########

$ curl -I https://example.com
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
  0     0    0     0    0     0      0      0 --:--:-- --:--:-- --:--:--     0  0     0    0     0    0     0      0      0 --:--:-- --:--:-- --:--:--     0  0     0    0     0    0     0      0      0 --:--:--  0:00:01 --:--:--     0  0     0    0     0    0     0      0      0 --:--:--  0:00:02 --:--:--     0
HTTP/2 200 
date: Thu, 03 Sep 2026 17:17:11 GMT
content-type: text/html
server: cloudflare
last-modified: Sun, 30 Aug 2026 04:11:49 GMT
allow: GET, HEAD
accept-ranges: bytes
age: 3362
cf-cache-status: HIT
cf-ray: a35668123b7fb72a-MAA


$ curl -s -o /dev/null -w 'code=%{http_code} dns=%{time_namelookup}s connect=%{time_connect}s tls=%{time_appconnect}s total=%{time_total}s\n' https://example.com
code=200 dns=0.003179s connect=0.040131s tls=0.057397s total=0.075399s

$ curl -s https://example.com | head -8
<!doctype html><html lang="en"><head><title>Example Domain</title><link rel="icon" href="data:,"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{background:#eee;width:60vw;margin:15vh auto;font-family:system-ui,sans-serif}h1{font-size:1.5em}div{opacity:0.8}a:link,a:visited{color:#348}</style></head><body><div><h1>Example Domain</h1><p>This domain is for use in documentation examples without needing permission. Avoid use in operations.</p><p><a href="https://iana.org/domains/example">Learn more</a></p></div></body></html>

$ wget -q -O- https://example.com | head -5
<!doctype html><html lang="en"><head><title>Example Domain</title><link rel="icon" href="data:,"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{background:#eee;width:60vw;margin:15vh auto;font-family:system-ui,sans-serif}h1{font-size:1.5em}div{opacity:0.8}a:link,a:visited{color:#348}</style></head><body><div><h1>Example Domain</h1><p>This domain is for use in documentation examples without needing permission. Avoid use in operations.</p><p><a href="https://iana.org/domains/example">Learn more</a></p></div></body></html>

########## PORTS & SOCKETS ##########

$ (nc -l -p 9099 >/dev/null 2>&1 &) ; sleep 1; ss -tulnp
Netid State  Recv-Q Send-Q Local Address:Port Peer Address:PortProcess
tcp   LISTEN 0      1            0.0.0.0:9099      0.0.0.0:*    users:(("nc",pid=101,fd=3))

$ netstat -tulnp
Active Internet connections (only servers)
Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name    
tcp        0      0 0.0.0.0:9099            0.0.0.0:*               LISTEN      101/nc              

$ ss -tan state listening
Recv-Q Send-Q Local Address:Port Peer Address:PortProcess
0      1            0.0.0.0:9099      0.0.0.0:*          

$ lsof -i -P -n | head -10
COMMAND PID USER   FD   TYPE  DEVICE SIZE/OFF NODE NAME
nc      101 root    3u  IPv4 1419578      0t0  TCP *:9099 (LISTEN)

$ nc -zv 127.0.0.1 9099
Connection to 127.0.0.1 9099 port [tcp/*] succeeded!

$ nc -zv google.com 443
Connection to google.com (142.251.221.238) 443 port [tcp/https] succeeded!

$ nc -zv 127.0.0.1 9999
nc: connect to 127.0.0.1 port 9999 (tcp) failed: Connection refused

########## ARP / NEIGHBOURS ##########

$ ip neigh
172.17.0.1 dev eth0 lladdr be:6f:8a:cc:28:ae REACHABLE 

$ arp -a
? (172.17.0.1) at be:6f:8a:cc:28:ae [ether] on eth0

########## SCAN & FIREWALL ##########

$ nmap -Pn -p 80,443 example.com
Starting Nmap 7.94SVN ( https://nmap.org ) at 2026-09-03 17:17 UTC
Nmap scan report for example.com (172.66.147.243)
Host is up (0.013s latency).
Other addresses for example.com (not scanned): 104.20.23.154

PORT    STATE SERVICE
80/tcp  open  http
443/tcp open  https

Nmap done: 1 IP address (1 host up) scanned in 1.15 seconds

$ iptables -L -n
Chain INPUT (policy ACCEPT)
target     prot opt source               destination         

Chain FORWARD (policy ACCEPT)
target     prot opt source               destination         

Chain OUTPUT (policy ACCEPT)
target     prot opt source               destination         

########## PACKET CAPTURE ##########

$ (ping -c 3 8.8.8.8 >/dev/null 2>&1 &); tcpdump -i any -c 6 -n icmp
tcpdump: data link type LINUX_SLL2
tcpdump: verbose output suppressed, use -v[v]... for full protocol decode
listening on any, link-type LINUX_SLL2 (Linux cooked v2), snapshot length 262144 bytes
17:17:13.865949 eth0  In  IP 8.8.8.8 > 172.17.0.6: ICMP echo reply, id 47123, seq 1, length 64
17:17:14.853464 eth0  Out IP 172.17.0.6 > 8.8.8.8: ICMP echo request, id 47123, seq 2, length 64
17:17:14.874576 eth0  In  IP 8.8.8.8 > 172.17.0.6: ICMP echo reply, id 47123, seq 2, length 64
17:17:15.857126 eth0  Out IP 172.17.0.6 > 8.8.8.8: ICMP echo request, id 47123, seq 3, length 64
17:17:15.870406 eth0  In  IP 8.8.8.8 > 172.17.0.6: ICMP echo reply, id 47123, seq 3, length 64

5 packets captured
5 packets received by filter
0 packets dropped by kernel

########## FILES & MISC ##########

$ cat /etc/hosts
127.0.0.1	localhost
::1	localhost ip6-localhost ip6-loopback
fe00::	ip6-localnet
ff00::	ip6-mcastprefix
ff02::1	ip6-allnodes
ff02::2	ip6-allrouters
172.17.0.6	3792602945c5

$ cat /etc/nsswitch.conf | grep hosts
hosts:          files dns

$ whois example.com | head -12
   Domain Name: EXAMPLE.COM
   Registry Domain ID: 2336799_DOMAIN_COM-VRSN
   Registrar WHOIS Server: whois.iana.org
   Registrar URL: http://res-dom.iana.org
   Updated Date: 2026-08-14T08:01:43Z
   Creation Date: 1995-08-14T04:00:00Z
   Registry Expiry Date: 2027-08-13T04:00:00Z
   Registrar: RESERVED-Internet Assigned Numbers Authority
   Registrar IANA ID: 376
   Registrar Abuse Contact Email:
   Registrar Abuse Contact Phone:
   Domain Status: clientDeleteProhibited https://icann.org/epp#clientDeleteProhibited
```
