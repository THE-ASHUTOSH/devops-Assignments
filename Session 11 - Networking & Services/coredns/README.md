# CoreDNS

## What is CoreDNS?

The DNS server that runs inside the cluster. It's a normal DNS server written in Go, built out of
plugins, and it happens to have a `kubernetes` plugin that reads Services from the API server.

In my cluster it's one pod in `kube-system`:

```
$ kubectl get pods -n kube-system -l k8s-app=kube-dns
NAME                       READY   STATUS    RESTARTS   AGE
coredns-559f6c778d-8lgc8   1/1     Running   0          25m
```

And it's fronted by a Service - which is the IP that ends up in every pod's resolv.conf:

```
$ kubectl get svc -n kube-system kube-dns
NAME       TYPE        CLUSTER-IP   PORT(S)                  AGE
kube-dns   ClusterIP   10.96.0.10   53/UDP,53/TCP,9153/TCP   25m
```

The Service is still called `kube-dns` even though CoreDNS replaced kube-dns years ago. Keeping the
name meant nothing had to be reconfigured.

## Why Kubernetes uses CoreDNS

It replaced kube-dns as the default in 1.13. kube-dns was three containers glued together
(`kube-dns`, `dnsmasq`, `sidecar`); CoreDNS is a single process.

- one binary instead of three containers
- plugin-based, so cluster DNS is just one plugin among many
- no dnsmasq, which had a history of CVEs
- exports Prometheus metrics on `:9153` out of the box
- it's a CNCF graduated project, used outside Kubernetes too

## How Service discovery works

Nobody registers anything. CoreDNS **watches the API server**:

1. I create a Service.
2. The API server stores it in etcd.
3. CoreDNS has a watch open on Services and EndpointSlices, so it's notified immediately.
4. It builds the records in memory - no zone file, nothing to reload.
5. A pod queries `10.96.0.10` and gets the answer.

The records it builds:

- **ClusterIP service** → A record pointing at the one virtual IP
- **Headless service** → one A record per pod IP
- **ExternalName** → a CNAME to the external host
- **SRV records** for named ports
- **PTR records** for reverse lookups

I saw all three main cases in Task 1 - a single address for ClusterIP, three addresses for headless,
and a CNAME for ExternalName.

## How DNS queries are resolved

From a pod:

```
$ kubectl exec netshoot -- cat /etc/resolv.conf
search default.svc.cluster.local svc.cluster.local cluster.local
nameserver 10.96.0.10
options ndots:5
```

The kubelet writes this file into every pod. So:

1. App asks for `web-clusterip`.
2. Fewer than 5 dots, so the search list is tried first:
   `web-clusterip.default.svc.cluster.local` → hit.
3. Query goes to `10.96.0.10` (the kube-dns Service).
4. kube-proxy forwards that to the real CoreDNS pod.
5. CoreDNS sees `cluster.local`, answers from its own records.

For an external name like `github.com`, CoreDNS doesn't know it, so the `forward` plugin sends it
to the upstream resolver from the **node's** `/etc/resolv.conf`.

## CoreDNS configuration

Config lives in a ConfigMap called `coredns` in `kube-system`, and the file inside it is the
**Corefile**:

```bash
kubectl get configmap coredns -n kube-system -o jsonpath='{.data.Corefile}'
```

```
.:53 {
    errors
    health {
       lameduck 5s
    }
    ready
    kubernetes cluster.local in-addr.arpa ip6.arpa {
       pods insecure
       fallthrough in-addr.arpa ip6.arpa
       ttl 30
    }
    prometheus :9153
    forward . /etc/resolv.conf {
       max_concurrent 1000
    }
    cache 30 {
       disable success cluster.local
       disable denial cluster.local
    }
    loop
    reload
    loadbalance
}
```

Line by line:

| directive | what it does |
|---|---|
| `.:53` | serve everything on port 53 |
| `errors` | log errors |
| `health` / `ready` | liveness and readiness endpoints |
| `kubernetes cluster.local ...` | **the important one** - answer for `cluster.local` from the API server |
| `ttl 30` | tell clients to cache answers 30s |
| `prometheus :9153` | metrics |
| `forward . /etc/resolv.conf` | anything not `cluster.local` goes upstream |
| `cache 30` | cache answers for 30s |
| `loop` | detect a forwarding loop and refuse to start |
| `reload` | pick up Corefile changes without a restart |
| `loadbalance` | shuffle A record order so clients spread out |

Note `cache 30 { disable success cluster.local }` - minikube turns caching **off** for cluster
names. Makes sense: in-cluster records change often and CoreDNS gets them from a watch anyway, so
caching would only serve stale endpoints.

To change it you edit the ConfigMap. The `reload` plugin picks it up in a minute or two, no restart
needed. Common edits: adding a stub zone for an internal domain, or pointing `forward` at a
specific DNS server instead of the node's.

## Troubleshooting DNS issues

What I'd actually run, roughly in order.

**1. Is CoreDNS even up?**

```bash
kubectl get pods -n kube-system -l k8s-app=kube-dns
```

If it's `Pending`, the cluster has a bigger problem. If `CrashLoopBackOff`, check its logs for a
`loop` plugin complaint - that means the node's resolv.conf points back at CoreDNS itself.

**2. Does the pod have the right resolv.conf?**

```bash
kubectl exec <pod> -- cat /etc/resolv.conf
```

Should be `nameserver 10.96.0.10` and the three search domains. If this is wrong the pod's
`dnsPolicy` is probably set oddly.

**3. Can it resolve anything?**

```bash
kubectl exec <pod> -- nslookup kubernetes.default.svc.cluster.local
```

`kubernetes.default` always exists, so this separates "DNS is broken" from "your service name is
wrong".

**4. Does the Service exist and have endpoints?**

```bash
kubectl get svc <name>
kubectl get endpoints <name>
```

**Empty endpoints is the single most common cause.** The name resolves fine but nothing answers.
It almost always means the Service selector doesn't match the pod labels - a typo, or pods not
Ready yet. This is also why a failing readinessProbe shows up as a DNS-looking problem.

**5. Read CoreDNS logs.**

```bash
kubectl logs -n kube-system -l k8s-app=kube-dns
```

Add the `log` plugin to the Corefile first if you want to see every query.

**6. Is it actually slow rather than broken?**

If external lookups are slow, it's probably `ndots:5` - every short external name gets tried
against three search domains first. Use a trailing dot (`github.com.`) or set `dnsConfig` on the
pod.

### The two failure modes worth separating

| symptom | likely cause |
|---|---|
| name doesn't resolve at all | CoreDNS down, wrong resolv.conf, wrong namespace in the name |
| resolves but connection refused/times out | endpoints empty, selector mismatch, wrong port, NetworkPolicy |

I hit the second one myself in Task 1 - `web-headless` resolved perfectly and still refused the
connection, because a headless service hands back pod IPs and I was using the service port (80)
instead of the pod's real port (8080). Resolving fine is not the same as reachable.
