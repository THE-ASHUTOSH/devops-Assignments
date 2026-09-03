# Dockerfiles & Images - Multi-Stage Build

**Name:** Ashutosh Kumar
**Enrollment number:** 24bcs10111

The task said to clone the repo with the multi-stage Dockerfile, but no repo link came with it,
so I wrote the app and the Dockerfile myself. It serves
**Hello World from Docker multi-stage build** on **port 8080**, which is what had to be verified.

```
multistage/
├── main.go            small http server on 8080
├── go.mod
├── Dockerfile         multi-stage: golang builder -> alpine runtime
└── Dockerfile.single  same app in one stage, only there for the size comparison
```

## Task 1 - build, run, verify

```bash
docker build -t multistage-hello .
docker run -d --name ms-hello -p 8080:8080 multistage-hello
curl http://localhost:8080
docker ps
```

Verified:

- page shows `Hello World from Docker multi-stage build` (HTTP 200, 187 bytes)
- `docker ps` shows `0.0.0.0:8080->8080/tcp` for container ms-hello
- `docker port ms-hello` confirms `8080/tcp -> 0.0.0.0:8080`

Browser: http://localhost:8080

## How the multi-stage part works

```dockerfile
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod .
COPY main.go .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /out/server main.go

FROM alpine:3.20
RUN adduser -D -u 10001 appuser
COPY --from=build /out/server /usr/local/bin/server
USER appuser
EXPOSE 8080
CMD ["server"]
```

Two `FROM` lines means two stages. The first one is named `build` and has the whole Go toolchain in
it. The second starts fresh from alpine and pulls in **only** the compiled binary with
`COPY --from=build`. Everything else from the first stage - compiler, module cache, source code -
never makes it into the final image, because only the last stage gets tagged.

`CGO_ENABLED=0` matters here: it makes a statically linked binary, otherwise it would want glibc
and alpine ships musl, so the binary would fail to start. `-ldflags="-s -w"` drops the symbol table
and debug info to shave a bit more off.

### The size difference

| image | how it was built | size |
|---|---|---|
| singlestage-hello | one stage, `FROM golang:1.23-alpine` | **471MB** |
| multistage-hello | golang builder, then alpine | **20.6MB** |

Same application, 23x smaller. `docker history` shows where the 20.6MB goes: 9.49MB alpine base +
4.94MB binary + 41kB for the user, and nothing else.

Two other things I checked to prove the toolchain is really gone:

```
$ docker run --rm multistage-hello sh -c 'which go || echo "go compiler not present"'
go compiler not present

$ docker run --rm singlestage-hello sh -c 'go version'
go version go1.23.12 linux/arm64
```

So the single-stage image is shipping a compiler to production and the multi-stage one isn't. That
is the point of the exercise - smaller pull, faster deploys, and a much smaller attack surface,
since a compiler and package manager inside a running container are useful to an attacker.

Also added `USER appuser` so it doesn't run as root - `id` inside the container returns
`uid=10001(appuser)`.

## Task 3 - three different application types deployed

Node.js, Python and Java, all running at the same time. Source is in `../docker/`.

```bash
docker run -d --name node-hello -p 3000:3000 hw-nodejs-app
docker run -d --name py-hello   -p 5050:5000 hw-python-app
docker run -d --name java-hello -p 8200:8080 hw-java-app
```

| app | url | image | memory |
|---|---|---|---|
| Node.js | http://localhost:3000 | hw-nodejs-app | 33.2 MiB |
| Python (flask) | http://localhost:5050 | hw-python-app | 41.6 MiB |
| Java | http://localhost:8200 | hw-java-app | 51.86 MiB |
| Go (multi-stage) | http://localhost:8080 | multistage-hello | 1.75 MiB |

Threw the Go one into the same table because the memory number makes the point again - 1.75 MiB
against 33-52 MiB for the others.

## Output

```console
########## 1. Build the multi-stage image ##########
$ docker build -t multistage-hello .
#1 [internal] load build definition from Dockerfile
#1 DONE 0.0s
#2 [internal] load metadata for docker.io/library/golang:1.23-alpine
#2 DONE 0.4s
#3 [internal] load metadata for docker.io/library/alpine:3.20
#3 DONE 5.0s
#4 [internal] load .dockerignore
#4 DONE 0.0s
#5 [build 1/5] FROM docker.io/library/golang:1.23-alpine@sha256:383395b794dffa5b53012a212365d40c8e37109a626ca30d6151c8348d380b5f
#5 DONE 0.0s
#6 [stage-1 1/3] FROM docker.io/library/alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc
#6 DONE 0.0s
#7 [internal] load build context
#7 DONE 0.0s
#8 [stage-1 2/3] RUN adduser -D -u 10001 appuser
#9 [build 4/5] COPY main.go .
#10 [build 5/5] RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /out/server main.go
#11 [build 2/5] WORKDIR /src
#12 [build 3/5] COPY go.mod .
#13 [stage-1 3/3] COPY --from=build /out/server /usr/local/bin/server
#14 naming to docker.io/library/multistage-hello:latest done
#14 DONE 0.0s

########## 2. Size: multi-stage vs the same app in a single stage ##########
$ docker images | grep -E 'multistage-hello|singlestage-hello'
REPOSITORY                                 TAG           SIZE
singlestage-hello                          latest        471MB
multistage-hello                           latest        20.6MB

########## 3. Run it on port 8080 ##########
$ docker run -d --name ms-hello -p 8080:8080 multistage-hello
3c81f4fbcc87cacac6052e12bf092ebbe891f1ee23b3bc7f6c8d8df2c1b28bc9

########## 4. docker ps (port 8080) ##########
$ docker ps --filter name=ms-hello
CONTAINER ID   IMAGE              COMMAND    CREATED         STATUS         PORTS                                         NAMES
3c81f4fbcc87   multistage-hello   "server"   3 seconds ago   Up 3 seconds   0.0.0.0:8080->8080/tcp, [::]:8080->8080/tcp   ms-hello

$ docker port ms-hello
8080/tcp -> 0.0.0.0:8080
8080/tcp -> [::]:8080

########## 5. Access the application ##########
$ curl -i http://localhost:8080
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
  0     0    0     0    0     0      0      0 --:--:-- --:--:-- --:--:--     0100   187  100   187    0     0    99k      0 --:--:-- --:--:-- --:--:--  182k
HTTP/1.1 200 OK
Content-Type: text/html
Date: Thu, 03 Sep 2026 17:25:58 GMT
Content-Length: 187

<!doctype html>
<html>
  <head><title>Multi-stage build</title></head>
  <body>
    <h1>Hello World from Docker multi-stage build</h1>
    <p>container: 3c81f4fbcc87</p>
  </body>
</html>

$ curl -s http://localhost:8080 | grep -o 'Hello World from Docker multi-stage build'
Hello World from Docker multi-stage build

$ curl -s http://localhost:8080/health
ok

########## 6. Proof the toolchain is gone from the final image ##########
$ docker run --rm multistage-hello sh -c 'which go || echo "go compiler not present"'
go compiler not present
$ docker run --rm singlestage-hello sh -c 'go version'
go version go1.23.12 linux/arm64

$ docker run --rm multistage-hello sh -c 'ls -lh /usr/local/bin/server; id'
-rwxr-xr-x    1 root     root        4.7M Sep  3 17:25 /usr/local/bin/server
uid=10001(appuser) gid=10001(appuser) groups=10001(appuser)

$ docker history multistage-hello
CREATED BY                                      SIZE
CMD ["server"]                                  0B
EXPOSE [8080/tcp]                               0B
USER appuser                                    0B
COPY /out/server /usr/local/bin/server # bui…   4.94MB
RUN /bin/sh -c adduser -D -u 10001 appuser #…   41kB
CMD ["/bin/sh"]                                 0B
ADD alpine-minirootfs-3.20.10-aarch64.tar.gz…   9.49MB
```

### Task 3 output

```console
$ docker ps --filter name=node-hello --filter name=py-hello --filter name=java-hello --filter name=ms-hello
NAMES        IMAGE              STATUS          PORTS
ms-hello     multistage-hello   Up 17 seconds   0.0.0.0:8080->8080/tcp, [::]:8080->8080/tcp
java-hello   hw-java-app        Up 2 minutes    0.0.0.0:8200->8080/tcp, [::]:8200->8080/tcp
py-hello     hw-python-app      Up 2 minutes    0.0.0.0:5050->5000/tcp, [::]:5050->5000/tcp
node-hello   hw-nodejs-app      Up 2 minutes    0.0.0.0:3000->3000/tcp, [::]:3000->3000/tcp

--- Node.js on http://localhost:3000 ---
$ curl -s http://localhost:3000 | grep -o 'Hello World from [A-Za-z.]*'
Hello World from Node.js
--- Python on http://localhost:5050 ---
$ curl -s http://localhost:5050 | grep -o 'Hello World from [A-Za-z.]*'
Hello World from Python
--- Java on http://localhost:8200 ---
$ curl -s http://localhost:8200 | grep -o 'Hello World from [A-Za-z.]*'
Hello World from Java

$ docker stats --no-stream --format 'table {{.Name}}	{{.CPUPerc}}	{{.MemUsage}}' node-hello py-hello java-hello ms-hello
NAME         CPU %     MEM USAGE / LIMIT
node-hello   0.00%     33.2MiB / 15.84GiB
py-hello     0.02%     41.6MiB / 15.84GiB
java-hello   0.13%     51.86MiB / 15.84GiB
ms-hello     0.00%     1.75MiB / 15.84GiB
```
