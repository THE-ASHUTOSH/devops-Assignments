# Docker Networking & Volumes

Four tasks. Everything ran on Docker Desktop 29.7.2 on a Mac, which matters for task 2 - noted
there.

## Task 1 - three containers, three networks

```bash
docker network create frontnet
docker network create backnet
docker network create extranet

docker run -d --name web-front --network frontnet nginx:alpine
docker run -d --name app-back  --network frontnet alpine sleep infinity
docker run -d --name db-mysql  --network backnet -e MYSQL_ROOT_PASSWORD=secret123 -e MYSQL_DATABASE=appdb mysql:8

docker network connect backnet app-back
```

Where everything ended up:

| container | image | networks | IPs |
|---|---|---|---|
| web-front | nginx:alpine | frontnet | 172.19.0.2 |
| app-back | alpine | frontnet **and** backnet | 172.19.0.3, 172.20.0.3 |
| db-mysql | mysql:8 | backnet | 172.20.0.2 |
| (extranet) | - | created, empty at first | - |

The backend getting two networks is the interesting bit. `docker network connect` gave it a second
interface, so inside app-back:

```
$ hostname -i
172.19.0.3 172.20.0.3
    inet 172.19.0.3/16 ... scope global eth0
    inet 172.20.0.3/16 ... scope global eth1
```

One container, one process, two NICs - eth0 on frontnet and eth1 on backnet. That's the standard
way to put a service between a public tier and a private one.

### Connectivity results

| from | to | result |
|---|---|---|
| app-back | web-front | ping ok, `curl http://web-front` -> HTTP 200 |
| app-back | db-mysql | ping ok, `nc -zv db-mysql 3306` -> open, real SQL query works |
| web-front | app-back | ping ok (shared frontnet) |
| web-front | db-mysql | **fails - NXDOMAIN** |

The failure is the point. `nslookup db-mysql` from web-front returns
`** server can't find db-mysql: NXDOMAIN` and nc says `bad address`. It isn't a firewall rule -
the name doesn't resolve at all, because Docker's embedded DNS at 127.0.0.11 only answers for
containers you share a user-defined network with. No shared network, no DNS entry, no route.

That is also why containers on user-defined networks can talk by name while the default `bridge`
network needs `--link` or raw IPs.

Proof it's the network and not anything else - I attached both to the third network:

```
$ docker network connect extranet web-front
$ docker network connect extranet db-mysql
$ docker exec web-front nslookup db-mysql
Name: db-mysql
Address: 172.21.0.3
$ docker exec web-front nc -zv -w 3 db-mysql 3306
db-mysql (172.21.0.3:3306) open
```

Then disconnecting web-front from extranet puts it straight back to `bad address`. Note the IP it
resolved to is the 172.21.x one - the address depends on which network the two of them have in
common.

One snag worth writing down: alpine's `mysql-client` package is actually MariaDB's client, and it
can't authenticate against MySQL 8 - first a TLS error on the self-signed cert, then
`Plugin caching_sha2_password could not be loaded` once TLS was skipped. `nc -zv` already proved
the port was reachable, so for the real SQL I used a throwaway `mysql:8` container on backnet:

```
$ docker run --rm --network backnet mysql:8 mysql -h db-mysql -uroot -psecret123 -e 'select version(), current_user(), database();' appdb
version()	current_user()	database()
8.4.11	root@%	appdb
```

## Task 2 - host network

```bash
docker run -d --name apache-host --network host httpd:2.4
```

First try **failed**, and the failure is a better demonstration than a success would have been:

```
(98)Address already in use: AH00072: make_sock: could not bind to address 0.0.0.0:80
no listening sockets available, shutting down
```

Port 80 was already taken by another container of mine. With `--network host` there is no
`-p` to remap anything - the container is *in* the host's network namespace and binds the host's
real port 80. In bridge mode the same clash would have been trivially fixable with `-p 8080:80`.

So I ran the same thing again with apache told to listen on a free port:

```bash
docker run -d --name apache-host --network host httpd:2.4 \
  sh -c "sed -i 's/^Listen 80/Listen 8600/' /usr/local/apache2/conf/httpd.conf && httpd-foreground"
```

and it serves, with **no port mapping at all**:

```
$ docker port apache-host
                                  <- empty
$ docker inspect -f '{{.HostConfig.NetworkMode}} / ports published: {{.NetworkSettings.Ports}}' apache-host
host / ports published: map[]

$ docker run --rm --network host alpine wget -qO- http://localhost:8600
<title>It works! Apache httpd</title>
<p>It works!</p>

$ docker run --rm --network host alpine netstat -tuln | grep 8600
tcp        0      0 :::8600     :::*      LISTEN
```

**The macOS caveat.** `curl http://localhost:8600` from the Mac itself gets nothing. On Docker
Desktop the "host" is the Linux VM, not macOS, and only `-p` published ports get forwarded out to
the Mac. So the container really is on the host network - just the VM's host network.
`docker exec apache-host hostname -i` returns `192.168.65.3`, the VM's own address, not a
172.x container address. On a native Linux box the very first command would have put the apache
page on port 80 with nothing else needed.

Host mode trade-offs: you skip the NAT/userland-proxy hop so it's a bit faster and the container
sees real client IPs, but you lose port remapping, you lose network isolation, and no two
containers can bind the same port.

## Task 3 - bind mount

```bash
docker run -d --name bind-nginx -p 9200:80 -v $(pwd)/site:/usr/share/nginx/html:ro nginx:alpine
```

`site/index.html` starts as `<h1>Hello students</h1>` and http://localhost:9200 serves exactly that.

```
$ docker inspect -f '{{range .Mounts}}{{.Type}} {{.Source}} -> {{.Destination}} (rw={{.RW}}){{end}}' bind-nginx
bind /Users/ashutosh/Documents/SST/devopsAssignment/Docker Network/site -> /usr/share/nginx/html (rw=false)
```

Then I edited the file on the Mac with sed and re-fetched **without touching the container**.
`docker ps` still says `Up 3 seconds` before and after, so it definitely wasn't restarted, and the
page now reads `Hello students - edited live at 23:29:11`. `docker exec bind-nginx cat` on the file
inside the container shows the new text too.

Dropping a completely new file in works the same way - `site/extra.html` appeared at
http://localhost:9200/extra.html straight away, no rebuild, no restart. That's the whole appeal of
a bind mount for local dev: the container is looking at your actual directory, not a copy baked
into the image at build time.

### Screenshots

http://localhost:9200 before the edit:

![before the edit](shots/bind-before.png)

and after editing `site/index.html` on the host, same container, no restart:

![after the edit](shots/bind-after.png)

Taken with playwright driving a real browser. To make the second one honest I put the file back to
plain `Hello students`, took the first shot, rewrote the file, then reloaded the same page - the
container was never touched:

```
$ docker inspect -f '{{.State.StartedAt}}  restarts={{.RestartCount}}' bind-nginx
2026-09-03T17:59:08.435112583Z  restarts=0     <- before
2026-09-03T17:59:08.435112583Z  restarts=0     <- after
```

Same start timestamp, zero restarts, different page.

Mounted with `:ro`, so the container can't write back:

```
$ docker exec bind-nginx sh -c 'echo hacked > /usr/share/nginx/html/index.html'
sh: can't create /usr/share/nginx/html/index.html: Read-only file system
```

Bind mount vs named volume, since they're easy to confuse: a bind mount points at a specific path
on the host and you manage it, which is great for dev and for config files. A named volume is
managed by Docker under `/var/lib/docker/volumes`, is portable between hosts, and is what you'd
actually use for database data.

### Why there are no screenshots for tasks 1 and 2

Task 1 is all terminal work - ping, nslookup, nc between containers - so there is no page to
photograph and the command output above is the evidence. Task 2's apache is on the host network
inside the Docker Desktop VM, which macOS `localhost` cannot reach, so a browser on my Mac has
nothing to load there either. That one is verified with `wget` from inside the same network
namespace instead.

## Task 4 - overlay networks

Didn't run this one - a real overlay needs swarm mode or a multi-node setup, and I wasn't going to
flip my only Docker host into a swarm for a homework task. Notes from reading up on it:

**What it is.** `bridge` only exists on one host - two containers on two different machines can't
see each other on it. An overlay network is a single virtual L2 network that spans several Docker
hosts, so a container on host A talks to a container on host B by container name, as if they were
on the same switch.

**How it works.** Traffic is wrapped in **VXLAN** (UDP 4789), so an ethernet frame from the
container gets encapsulated in a UDP packet, sent across the real physical network to the other
host, unwrapped there, and delivered into the destination container's namespace. Each overlay gets
its own VXLAN network ID, which is what keeps two overlays isolated from each other over the same
physical link.

The bits Docker manages for you:

- a distributed key-value store (built into swarm's raft) that keeps every node's copy of "which
  container has which IP on which host" in sync
- IPAM, so IPs stay unique across the whole cluster instead of per host
- DNS-based service discovery, plus a virtual IP per service so `mysql:3306` load balances across
  every replica
- optional `--opt encrypted`, which puts IPSec around the VXLAN traffic between nodes

**Ports that have to be open between hosts:** 2377/tcp for cluster management, 7946/tcp+udp for
node-to-node gossip, 4789/udp for the VXLAN data itself.

**When you'd use one:** anything multi-host - a swarm stack spread over several nodes, services
that need to find each other by name across machines, or an internal-only network (`--internal`)
that spans hosts. If everything is on one machine a plain bridge network is simpler and faster,
since there's no encapsulation overhead. Kubernetes solves the same problem but with its own CNI
plugins (flannel, calico, cilium) rather than Docker overlay.

**Roughly what it looks like:**

```bash
# on the manager
docker swarm init --advertise-addr <manager-ip>
docker network create -d overlay --attachable app-overlay

# on each worker
docker swarm join --token <token> <manager-ip>:2377

# now this spreads across nodes and the tasks reach each other by name
docker service create --name api --network app-overlay --replicas 3 my-api:latest
```

`--attachable` is the flag that lets plain `docker run` containers join, not just swarm services.

## Cleanup

```bash
docker rm -f web-front app-back db-mysql apache-host bind-nginx
docker network rm frontnet backnet extranet
```

## Output

### Task 1 - setup

```console
########## the three networks ##########
$ docker network create frontnet && docker network create backnet && docker network create extranet
(created above)

$ docker network ls
NETWORK ID     NAME            DRIVER    SCOPE
f80fd44e41f1   backnet         bridge    local
f7e9394dbd4b   bridge          bridge    local
bc60db03de71   extranet        bridge    local
e0ca85e2f028   frontnet        bridge    local
2b356a257a04   host            host      local
67d84a231619   none            null      local
a786df42d3ed   orbit_default   bridge    local

########## the three containers ##########
$ docker run -d --name web-front --network frontnet nginx:alpine
$ docker run -d --name app-back --network frontnet alpine sleep infinity
76f3eb0c7549c62f6805eecde0841005ab36ba25aef39b9c0a3c9ecdc7eba963
$ docker run -d --name db-mysql --network backnet -e MYSQL_ROOT_PASSWORD=secret123 -e MYSQL_DATABASE=appdb mysql:8

########## backend joins a SECOND network ##########
$ docker network connect backnet app-back

$ docker inspect -f '{{.Name}} -> networks' web-front app-back db-mysql
/web-front -> frontnet=172.19.0.2 
/app-back -> backnet=172.20.0.3 frontnet=172.19.0.3 
/db-mysql -> backnet=172.20.0.2 

$ docker network inspect frontnet -f '{{range .Containers}}{{.Name}} {{.IPv4Address}}{{println}}{{end}}'
web-front 172.19.0.2/16
app-back 172.19.0.3/16

$ docker network inspect backnet -f '{{range .Containers}}{{.Name}} {{.IPv4Address}}{{println}}{{end}}'
app-back 172.20.0.3/16
db-mysql 172.20.0.2/16

$ docker network inspect extranet -f '{{range .Containers}}{{.Name}} {{.IPv4Address}}{{println}}{{end}}'

(extranet has no members yet)
```

### Task 1 - connectivity

```console
########## backend sits on frontnet AND backnet, so it reaches both sides ##########

$ docker exec app-back sh -c 'hostname -i; ip addr show | grep 'inet ''
172.19.0.3 172.20.0.3
    inet 127.0.0.1/8 scope host lo
    inet 172.19.0.3/16 brd 172.19.255.255 scope global eth0
    inet 172.20.0.3/16 brd 172.20.255.255 scope global eth1

$ docker exec app-back sh -c 'ping -c 2 web-front'
PING web-front (172.19.0.2): 56 data bytes
64 bytes from 172.19.0.2: seq=0 ttl=64 time=0.186 ms
64 bytes from 172.19.0.2: seq=1 ttl=64 time=0.179 ms

--- web-front ping statistics ---
2 packets transmitted, 2 packets received, 0% packet loss
round-trip min/avg/max = 0.179/0.182/0.186 ms

$ docker exec app-back sh -c 'curl -s -o /dev/null -w 'frontend HTTP %{http_code}
' http://web-front'
frontend HTTP 200

$ docker exec app-back sh -c 'nslookup web-front'
Server:		127.0.0.11
Address:	127.0.0.11#53

Non-authoritative answer:
Name:	web-front
Address: 172.19.0.2


$ docker exec app-back sh -c 'ping -c 2 db-mysql'
PING db-mysql (172.20.0.2): 56 data bytes
64 bytes from 172.20.0.2: seq=0 ttl=64 time=0.098 ms
64 bytes from 172.20.0.2: seq=1 ttl=64 time=0.261 ms

--- db-mysql ping statistics ---
2 packets transmitted, 2 packets received, 0% packet loss
round-trip min/avg/max = 0.098/0.179/0.261 ms

$ docker exec app-back sh -c 'nc -zv -w 3 db-mysql 3306'
db-mysql (172.20.0.2:3306) open

--- alpine's mysql-client is mariadb and can't do mysql 8's caching_sha2_password,
--- so the actual SQL check runs from a throwaway mysql:8 client on backnet ---
$ docker run --rm --network backnet mysql:8 mysql -h db-mysql -uroot -psecret123 -e 'select version(), current_user(), database();' appdb
version()	current_user()	database()
8.4.11	root@%	appdb

$ docker run --rm --network backnet mysql:8 mysql -h db-mysql -uroot -psecret123 -e 'create table if not exists hits(id int); insert into hits values (1); select count(*) as rows_in_hits from hits;' appdb
rows_in_hits
1

########## frontend is only on frontnet ##########

$ docker exec web-front sh -c 'hostname -i; ip addr show | grep 'inet ''
172.19.0.2
    inet 127.0.0.1/8 scope host lo
    inet 172.19.0.2/16 brd 172.19.255.255 scope global eth0

$ docker exec web-front sh -c 'ping -c 2 app-back'
PING app-back (172.19.0.3): 56 data bytes
64 bytes from 172.19.0.3: seq=0 ttl=64 time=0.042 ms
64 bytes from 172.19.0.3: seq=1 ttl=64 time=0.115 ms

--- app-back ping statistics ---
2 packets transmitted, 2 packets received, 0% packet loss
round-trip min/avg/max = 0.042/0.078/0.115 ms

--- frontend -> database should FAIL, they share no network ---

$ docker exec web-front sh -c 'nslookup db-mysql'
Server:		127.0.0.11
Address:	127.0.0.11#53

** server can't find db-mysql: NXDOMAIN


$ docker exec web-front sh -c 'nc -zv -w 3 db-mysql 3306'
nc: bad address 'db-mysql'

########## put both on the third network and try again ##########
$ docker network connect extranet web-front
$ docker network connect extranet db-mysql

$ docker exec web-front sh -c 'hostname -i'
172.19.0.2 172.21.0.2

$ docker exec web-front sh -c 'nslookup db-mysql'
Server:		127.0.0.11
Address:	127.0.0.11#53

Non-authoritative answer:
Name:	db-mysql
Address: 172.21.0.3


$ docker exec web-front sh -c 'nc -zv -w 3 db-mysql 3306'
db-mysql (172.21.0.3:3306) open

$ docker network inspect extranet -f '{{range .Containers}}{{.Name}} {{.IPv4Address}}{{println}}{{end}}'
web-front 172.21.0.2/16
db-mysql 172.21.0.3/16

--- disconnect and the isolation is back ---
$ docker network disconnect extranet web-front

$ docker exec web-front sh -c 'nc -zv -w 3 db-mysql 3306'
nc: bad address 'db-mysql'
```

### Task 2 - host network

```console
########## Task 2: Apache2 on the host network ##########
$ docker pull httpd:2.4    (apache2 image from docker hub)
REPOSITORY                                 TAG           SIZE
httpd                                      2.4           207MB

--- attempt 1: straight onto host port 80 ---
$ docker ps --format '{{.Names}} {{.Ports}}' | grep ':80->'
suite-verify 0.0.0.0:80->80/tcp, [::]:80->80/tcp, 0.0.0.0:8081-8091->8081-8091/tcp, [::]:8081-8091->8081-8091/tcp

$ docker run -d --name apache-host --network host httpd:2.4
d46bcd42f1c79212c02aa78ac41290021227e576013dc0458c69de30cc9473e4

$ docker ps -a --filter name=apache-host
NAMES         STATUS                     PORTS     NETWORKS
apache-host   Exited (1) 4 seconds ago             host

$ docker logs apache-host
AH00558: httpd: Could not reliably determine the server's fully qualified domain name, using 192.168.65.3. Set the 'ServerName' directive globally to suppress this message
(98)Address already in use: AH00072: make_sock: could not bind to address [::]:80
(98)Address already in use: AH00072: make_sock: could not bind to address 0.0.0.0:80
no listening sockets available, shutting down
AH00015: Unable to open logs

(port 80 on this machine is already held by another container of mine, and because
 host networking binds the host's port directly there is no -p to remap it, so apache
 could not start. that failure IS the demonstration of how host mode works.)

--- attempt 2: same host network, apache told to listen on a free port instead ---
$ docker run -d --name apache-host --network host httpd:2.4 sh -c "sed -i 's/^Listen 80/Listen 8600/' /usr/local/apache2/conf/httpd.conf && httpd-foreground"
443b1ee741a3cc6663e1a0d9d3ed8c0f8af5957970ff7c12e26d0f3a51d399ed

$ docker ps --filter name=apache-host
NAMES         STATUS         PORTS     NETWORKS
apache-host   Up 4 seconds             host

$ docker port apache-host
(empty - host mode publishes nothing, there is nothing to map)

$ docker inspect -f '{{.HostConfig.NetworkMode}} / ports published: {{.NetworkSettings.Ports}}' apache-host
host / ports published: map[]

$ curl -i http://localhost:8600

$ docker exec apache-host hostname -i
192.168.65.3
(that is the host's own IP inside the VM, not a 172.x container IP)

$ curl -s -o /dev/null -w 'from macOS: HTTP %{http_code}
' http://localhost:8600
from macOS: HTTP 000
from macOS: no response

(nothing. on docker desktop --network host joins the LINUX VM's network namespace,
 and only -p published ports get forwarded out to macOS. so it is serving on the
 VM's port, not on my mac's. checking from inside that same namespace:)

$ docker run --rm --network host alpine wget -qO- http://localhost:8600
<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd">
<html>
<head>
<title>It works! Apache httpd</title>
</head>
<body>
<p>It works!</p>
</body>
</html>

$ docker run --rm --network host alpine wget -qS -O /dev/null http://192.168.65.3:8600
  HTTP/1.1 200 OK
  Date: Thu, 03 Sep 2026 17:33:33 GMT
  Server: Apache/2.4.68 (Unix)
  Last-Modified: Fri, 07 Nov 2025 08:23:08 GMT
  ETag: "bf-642fce432f300"
  Accept-Ranges: bytes
  Content-Length: 191
  Connection: close

$ docker run --rm --network host alpine netstat -tuln | grep 8600
tcp        0      0 :::8600                 :::*                    LISTEN      

$ docker exec apache-host grep '^Listen' /usr/local/apache2/conf/httpd.conf
Listen 8600
```

### Task 3 - bind mount

```console
########## Task 3: bind mount ##########
$ cat site/index.html
<!doctype html>
<html>
  <head>
    <title>Bind mount demo</title>
  </head>
  <body>
    <h1>Hello students</h1>
  </body>
</html>

$ docker run -d --name bind-nginx -p 9200:80 -v "$(pwd)/site:/usr/share/nginx/html:ro" nginx:alpine
02932a882868aa31b5e9188e98403ba05b8127c78ecec050d63554ea86b58e08

$ docker ps --filter name=bind-nginx
NAMES        STATUS         PORTS
bind-nginx   Up 3 seconds   0.0.0.0:9200->80/tcp, [::]:9200->80/tcp

$ docker inspect -f '{{range .Mounts}}{{.Type}} {{.Source}} -> {{.Destination}} (rw={{.RW}}){{end}}' bind-nginx
bind /Users/ashutosh/Documents/SST/devopsAssignment/Docker Network/site -> /usr/share/nginx/html (rw=false)

$ docker inspect -f '{{.State.StartedAt}} restarts={{.RestartCount}}' bind-nginx
2026-09-03T17:59:08.435112583Z restarts=0

$ curl -s http://localhost:9200
<!doctype html>
<html>
  <head>
    <title>Bind mount demo</title>
  </head>
  <body>
    <h1>Hello students</h1>
  </body>
</html>

--- edit the file on the host, container is NOT restarted ---
$ sed -i '' 's|<h1>Hello students</h1>|<h1>Hello students - edited live at 23:29:11</h1>|' site/index.html
$ curl -s -w '
[%{size_download} bytes, HTTP %{http_code}]
' http://localhost:9200
<!doctype html>
<html>
  <head>
    <title>Bind mount demo</title>
  </head>
  <body>
    <h1>Hello students - edited live at 23:29:11</h1>
  </body>
</html>

[158 bytes, HTTP 200]

$ docker inspect -f '{{.State.StartedAt}} restarts={{.RestartCount}}' bind-nginx   (unchanged)
2026-09-03T17:59:08.435112583Z restarts=0

$ docker exec bind-nginx cat /usr/share/nginx/html/index.html
<!doctype html>
<html>
  <head>
    <title>Bind mount demo</title>
  </head>
  <body>
    <h1>Hello students - edited live at 23:29:11</h1>
  </body>
</html>

--- a brand new file on the host shows up straight away ---
$ echo '<h1>a brand new page</h1>' > site/extra.html
$ curl -s http://localhost:9200/extra.html
<h1>a brand new page</h1>
$ docker exec bind-nginx ls -l /usr/share/nginx/html
total 8
-rw-r--r--    1 root     root            26 Sep  3 17:59 extra.html
-rw-r--r--    1 root     root           158 Sep  3 17:59 index.html

--- mounted :ro so the container cannot write back ---
$ docker exec bind-nginx sh -c 'echo hacked > /usr/share/nginx/html/index.html'
sh: can't create /usr/share/nginx/html/index.html: Read-only file system
```
