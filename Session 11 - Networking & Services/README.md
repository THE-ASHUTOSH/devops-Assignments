# Session 11 - Kubernetes Networking & Services

Ashutosh Kumar - 24bcs10111

## Task 1 - All 5 Service types

One deployment with 3 pods, then five Services pointing at the same pods so only the type changes.

```
NAME            TYPE           CLUSTER-IP      EXTERNAL-IP   PORT(S)
external-db     ExternalName   <none>          example.com   <none>
web-clusterip   ClusterIP      10.104.92.31    <none>        80/TCP
web-headless    ClusterIP      None            <none>        80/TCP
web-lb          LoadBalancer   10.111.250.99   <pending>     80:31635/TCP
web-nodeport    NodePort       10.108.6.234    <none>        80:30080/TCP
```

Four of them pick the same 3 pods:

```
web-clusterip   10.244.0.76:8080,10.244.0.77:8080,10.244.0.78:8080
web-headless    10.244.0.76:8080,10.244.0.77:8080,10.244.0.78:8080
web-lb          10.244.0.76:8080,10.244.0.77:8080,10.244.0.78:8080
web-nodeport    10.244.0.76:8080,10.244.0.77:8080,10.244.0.78:8080
```

`external-db` has none because it has no selector.

### 1. ClusterIP

Default. Only reachable inside the cluster.

```
$ kubectl exec netshoot -- wget -qO- http://web-clusterip/
hello from web
```

That 10.104.92.31 is not on any network card. It is a fake IP kube-proxy rewrites to a real pod IP.

### 2. NodePort

Opens a port on every node. `80:30080` means 80 inside, 30080 on the node. Range is 30000-32767.

```
$ minikube ssh "curl -s http://localhost:30080/"
hello from web
```

From my laptop it timed out. minikube runs in a docker container on Windows so my laptop has no
route to 192.168.49.0/24. On Linux it would have worked. Workaround is
`minikube service web-nodeport --url`.

### 3. LoadBalancer

```
web-lb    LoadBalancer    10.111.250.99    <pending>    80:31635/TCP
```

Stuck on `<pending>` because minikube is not a cloud. `minikube tunnel` fakes it:

```
web-lb   LoadBalancer   10.111.250.99   127.0.0.1   80:31635/TCP
```
```
$ curl http://127.0.0.1/
hello from web
```

It is a stack - LoadBalancer contains a NodePort contains a ClusterIP.

One LoadBalancer per Service means one cloud load balancer and one bill each. That is why Ingress
exists.

### 4. ExternalName

No pods, no selector, no IP. Just a DNS CNAME.

```
$ kubectl exec netshoot -- nslookup external-db.default.svc.cluster.local
external-db.default.svc.cluster.local	canonical name = example.com
Address: 172.66.147.243
```

No proxying, kube-proxy is not involved. The point is your app connects to `external-db` whether
the real DB is RDS in prod or a pod in dev.

### 5. Headless

`clusterIP: None`. DNS gives back every pod IP instead of one:

```
Address: 10.244.0.78
Address: 10.244.0.76
Address: 10.244.0.77
```

This caught me out - port 80 failed:

```
$ kubectl exec netshoot -- wget -qO- http://web-headless/
wget: can't connect to remote host (10.244.0.78): Connection refused
```

Because DNS gave a pod IP, not a service IP, so there is no kube-proxy doing the 80 to 8080
mapping. Had to use the real port:

```
$ kubectl exec netshoot -- wget -qO- http://web-headless:8080/
hello from web
```

With headless, port and targetPort do nothing. Used for StatefulSets so each pod gets a stable DNS
name.

### Summary

| type | cluster IP | reachable from | DNS gives back |
|---|---|---|---|
| ClusterIP | fake IP | inside only | one IP |
| NodePort | yes | node-ip:30000-32767 | service IP |
| LoadBalancer | yes | external IP | service IP |
| ExternalName | none | n/a | a CNAME |
| Headless | None | inside only | every pod IP |

## Task 2 - Object comparison

### Deployment vs ReplicaSet

A ReplicaSet keeps N pods running, that is all. A Deployment manages ReplicaSets and adds versions.

The real difference is rolling updates. A ReplicaSet cannot do one - change its template and
existing pods are left alone. A Deployment makes a second ReplicaSet and shifts replicas across,
which I saw in Session 10:

```
web-rolling-7b866d8545   3   3   3   49s    <- old
web-rolling-85d6f9cf5f   2   2   0   7s     <- new
```

Chain is Deployment -> ReplicaSet -> Pod. Old ReplicaSets are kept at 0, which is why rollback is
instant. You never write a ReplicaSet yourself.

### Deployment vs DaemonSet vs StatefulSet

| | Deployment | DaemonSet | StatefulSet |
|---|---|---|---|
| use case | stateless apps | one agent per node | needs identity |
| pod creation | anywhere they fit | one per node | in order: 0, 1, 2 |
| scaling | any number | follows node count | ordered |
| names | random | one per node | stable (db-0, db-1) |
| storage | usually none | host paths | own PVC per pod |
| example | web app | log collector, CNI | MySQL, Kafka |

`kindnet` and `kube-proxy` in my cluster are DaemonSets, which is why there is exactly one of each
on my one node.

StatefulSets pair with a headless Service so each pod gets its own DNS name.

Quick test: if you could delete any pod and nobody would notice, use a Deployment.

### ReplicaSet vs Service

Completely different jobs. ReplicaSet controls **how many** pods exist. Service controls **how to
reach** them.

Why you need a Service - pod IPs change. All of these happened to me:

- scaling up gave 3 new IPs
- a rolling update replaced every pod and IP
- a crashed pod came back with a different IP

The Service IP never changes.

How traffic gets there:

1. Service gets a ClusterIP
2. endpoints controller watches for pods matching the selector, keeps their IPs in a list
3. kube-proxy turns that list into iptables rules
4. a pod connects to the ClusterIP, the kernel rewrites it to a real pod IP

The link between them is **labels, not ownership**. Neither knows the other exists. That is exactly
why blue-green works by editing the selector - it just starts matching different pods.

## Task 3 - FQDN

See [`fqdn/README.md`](fqdn/).

## Task 4 - CoreDNS

See [`coredns/README.md`](coredns/).
