# Session 11 - Kubernetes Networking & Services

**Ashutosh Kumar** · **24bcs10111**

## Task 1 - All 5 Service types

One deployment ([`services/00-deployment.yml`](services/00-deployment.yml)) with 3 pods behind it,
then five different Services pointing at the same pods so the only variable is the Service type.

```bash
kubectl apply -f services/
```

```
NAME            TYPE           CLUSTER-IP      EXTERNAL-IP   PORT(S)        AGE
external-db     ExternalName   <none>          example.com   <none>         1s
kubernetes      ClusterIP      10.96.0.1       <none>        443/TCP        17s
web-clusterip   ClusterIP      10.104.92.31    <none>        80/TCP         1s
web-headless    ClusterIP      None            <none>        80/TCP         1s
web-lb          LoadBalancer   10.111.250.99   <pending>     80:31635/TCP   1s
web-nodeport    NodePort       10.108.6.234    <none>        80:30080/TCP   1s
```

Endpoints - four of them select the same 3 pods:

```
NAME            ENDPOINTS                                            AGE
web-clusterip   10.244.0.76:8080,10.244.0.77:8080,10.244.0.78:8080   1s
web-headless    10.244.0.76:8080,10.244.0.77:8080,10.244.0.78:8080   1s
web-lb          10.244.0.76:8080,10.244.0.77:8080,10.244.0.78:8080   1s
web-nodeport    10.244.0.76:8080,10.244.0.77:8080,10.244.0.78:8080   1s
```

`external-db` has no endpoints at all, because it has no selector.

### 1. ClusterIP

[`services/01-clusterip.yml`](services/01-clusterip.yml). The default. A virtual IP only reachable
from inside the cluster.

```
$ kubectl exec netshoot -- nslookup web-clusterip.default.svc.cluster.local
Name:	web-clusterip.default.svc.cluster.local
Address: 10.104.92.31
```

Works by short name and by FQDN:

```
$ kubectl exec netshoot -- wget -qO- http://web-clusterip/
hello from web
$ kubectl exec netshoot -- wget -qO- http://web-clusterip.default.svc.cluster.local/
hello from web
```

That `10.104.92.31` is not on any network interface anywhere. It's a fake IP that kube-proxy
rewrites to a real pod IP. Nothing actually "listens" on it.

Use it for anything internal - a backend API, a database the frontend talks to.

### 2. NodePort

[`services/02-nodeport.yml`](services/02-nodeport.yml). Opens the same port on every node, and
forwards to the service.

```
web-nodeport    NodePort    10.108.6.234    <none>    80:30080/TCP
```

The `80:30080` means port 80 inside the cluster, 30080 on the node. The range is fixed at
30000-32767 - I picked 30080 explicitly, otherwise you get a random one.

From inside the node:

```
$ minikube ssh "curl -s http://localhost:30080/"
hello from web
```

**From my laptop it did not work.** `curl http://192.168.49.2:30080/` just timed out:

```
node ip: 192.168.49.2
(timeout, exit 28)
```

That's not a Kubernetes problem - minikube is running in a Docker container on Windows, and the
`192.168.49.0/24` network is inside Docker's VM where my host has no route to it. On Linux it would
have worked straight away. The way around it is `minikube service web-nodeport --url`, which opens
a tunnel from the host.

A NodePort is still a ClusterIP underneath - it just adds the node port on top. Fine for a dev
cluster, but for real use you'd put a LoadBalancer or Ingress in front, since nobody wants to hand
out `http://node-ip:31234`.

### 3. LoadBalancer

[`services/03-loadbalancer.yml`](services/03-loadbalancer.yml). Asks the cloud provider for an
external load balancer.

Straight after applying:

```
web-lb    LoadBalancer    10.111.250.99    <pending>    80:31635/TCP
```

`<pending>` forever, because minikube isn't a cloud and there's no controller to answer the
request. On EKS/GKE this is where you'd get a real public IP.

minikube fakes it with `minikube tunnel`, run in a second terminal:

```bash
minikube tunnel
```

```
NAME     TYPE           CLUSTER-IP      EXTERNAL-IP   PORT(S)        AGE
web-lb   LoadBalancer   10.111.250.99   127.0.0.1     80:31635/TCP   94s
```

EXTERNAL-IP became `127.0.0.1`, and now it works from my actual machine:

```
$ curl http://127.0.0.1/
hello from web
```

Note it's a stack: LoadBalancer contains a NodePort (31635) which contains a ClusterIP
(10.111.250.99). Each type adds a layer.

The practical catch is **one LoadBalancer per Service = one cloud LB = one bill each**. Which is
exactly why Ingress exists (Session 12).

### 4. ExternalName

[`services/04-externalname.yml`](services/04-externalname.yml). The odd one out - no pods, no
selector, no cluster IP. It's purely a DNS CNAME.

```
external-db    ExternalName    <none>    example.com    <none>
```

```
$ kubectl exec netshoot -- nslookup external-db.default.svc.cluster.local
external-db.default.svc.cluster.local	canonical name = example.com
Name:	example.com
Address: 172.66.147.243
Name:	example.com
Address: 104.20.23.154
```

CoreDNS returned a CNAME to `example.com` and then resolved that.

No proxying happens - kube-proxy isn't involved at all. The point is indirection: your app connects
to `external-db` whether the real database is RDS in prod or a pod in dev, and you only change the
Service.

### 5. Headless

[`services/05-headless.yml`](services/05-headless.yml). `clusterIP: None`.

```
web-headless    ClusterIP    None    <none>    80/TCP
```

Instead of one virtual IP, DNS returns **every pod IP**:

```
$ kubectl exec netshoot -- nslookup web-headless.default.svc.cluster.local
Name:	web-headless.default.svc.cluster.local
Address: 10.244.0.78
Name:	web-headless.default.svc.cluster.local
Address: 10.244.0.76
Name:	web-headless.default.svc.cluster.local
Address: 10.244.0.77
```

Compare to ClusterIP, which returned exactly one address. Here the client gets all three and
decides for itself which to talk to.

**This tripped me up:** connecting on port 80 failed.

```
$ kubectl exec netshoot -- wget -qO- http://web-headless/
wget: can't connect to remote host (10.244.0.78): Connection refused
```

Because DNS handed back a **pod IP**, not a service IP - so there's no kube-proxy in the path doing
the `80 → 8080` mapping. You have to use the port the pod actually listens on:

```
$ kubectl exec netshoot -- wget -qO- http://web-headless:8080/
hello from web
```

Good lesson: with a headless service the `port`/`targetPort` mapping does nothing. There's no proxy.

Used for StatefulSets (so each pod gets a stable DNS name like `db-0.web-headless`), and for
clients that do their own load balancing, like a Cassandra or Kafka driver.

### Summary

| type | cluster IP | reachable from | what DNS returns |
|---|---|---|---|
| ClusterIP | yes, virtual | inside only | the one service IP |
| NodePort | yes | `<node-ip>:30000-32767` | the service IP |
| LoadBalancer | yes | external IP from cloud | the service IP |
| ExternalName | none | n/a, it's a CNAME | a CNAME to an external host |
| Headless | `None` | inside only | every pod IP |

## Task 2 - Object comparison

### Deployment vs ReplicaSet

**Purpose.** A ReplicaSet keeps N identical pods running, nothing more. A Deployment manages
ReplicaSets and adds versioning on top.

**Pod management.** Neither one creates pods directly as a one-off - both work by the controller
loop watching "desired vs actual". The ReplicaSet owns the pods; the Deployment owns the ReplicaSet.

**Scaling.** Both can scale. `kubectl scale` works on either. But you should always scale the
Deployment, because if you scale the ReplicaSet the Deployment will just set it back.

**Rolling updates.** This is the whole difference. A ReplicaSet **cannot** do a rolling update - if
you change its pod template, existing pods are left alone. A Deployment handles it by making a
*second* ReplicaSet and shifting replicas across, which I saw directly in Session 10:

```
web-rolling-7b866d8545   3   3   3   49s    <- old RS
web-rolling-85d6f9cf5f   2   2   0   7s     <- new RS
```

**Relationship.** Deployment → ReplicaSet → Pod. One Deployment ends up with several ReplicaSets
over time, one per revision, and the old ones are kept at 0 replicas. That's what makes
`kubectl rollout undo` instant.

In practice you never write a ReplicaSet yourself. You write a Deployment and it makes them.

### Deployment vs DaemonSet vs StatefulSet

| | Deployment | DaemonSet | StatefulSet |
|---|---|---|---|
| **use case** | stateless apps | one agent per node | stateful apps needing identity |
| **pod creation** | N pods anywhere the scheduler fits them | exactly one per node, automatically | ordered: 0, then 1, then 2 |
| **scaling** | any number, `--replicas` | can't set a number, it follows the node count | ordered, scale down removes highest first |
| **networking** | random pod names, no stable identity | one per node | stable name + stable DNS per pod |
| **storage** | usually none or shared | host paths | its own PVC per pod, kept on reschedule |
| **examples** | web app, REST API | log collector, node exporter, CNI | MySQL, Kafka, Elasticsearch |

**Deployment** - the default. Pods are interchangeable, names are random
(`web-7b866d8545-4g7sx`), any pod can serve any request.

**DaemonSet** - you don't say how many. Add a node, it gets a pod; remove a node, that pod goes.
`kindnet` and `kube-proxy` in my cluster are DaemonSets, which is why there's exactly one of each
on my one node.

**StatefulSet** - for things where pods are *not* interchangeable. Pods get ordinal names
(`db-0`, `db-1`), they're created in order and waited on one at a time, and each keeps its own
PersistentVolumeClaim across a reschedule. Paired with a headless Service so each pod gets its own
DNS name - which is why headless exists at all.

The quick test: if you could delete any pod and nobody would notice, use a Deployment.

### ReplicaSet vs Service

These get compared but they do completely unrelated jobs.

**ReplicaSet responsibility** - *how many* pods exist. It watches the count and creates or deletes
pods to match. It has no idea about networking.

**Service responsibility** - *how to reach* pods. A stable IP and DNS name, plus load balancing. It
has no idea how many pods there should be, and it doesn't create any.

**Why a Service is required.** Pod IPs are not stable. Every one of these happened to me:

- scaling up gave 3 brand new IPs
- a rolling update replaced every pod and every IP with it
- a crashed pod came back with a different IP

If a frontend hardcoded a backend pod IP it would break on the next restart. The Service IP never
changes for the life of the Service.

**How traffic reaches pods.**

1. Service is created, gets a ClusterIP (`10.104.92.31`).
2. The endpoints controller watches for pods matching the Service selector and keeps an
   EndpointSlice updated with their IPs.
3. kube-proxy on each node watches that list and writes iptables/IPVS rules.
4. A pod connects to the ClusterIP; the kernel rewrites the destination to one of the real pod IPs.
5. A pod dies → endpoints updated → rules updated. Nothing above notices.

The link between them is **labels, not ownership**. The Service selects `app: web`; the ReplicaSet
happens to produce pods with that label. Neither knows the other exists. That's exactly why
blue-green works by editing the Service selector - it just starts matching a different set of pods.

## Task 3 - FQDN

See [`fqdn/README.md`](fqdn/).

## Task 4 - CoreDNS

See [`coredns/README.md`](coredns/).
