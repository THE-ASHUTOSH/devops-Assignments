# CoreDNS

## What is CoreDNS

The DNS server inside the cluster. It is a normal DNS server made of plugins, and one of the
plugins reads Services from the apiserver.

```
$ kubectl get pods -n kube-system -l k8s-app=kube-dns
NAME                       READY   STATUS    AGE
coredns-559f6c778d-8lgc8   1/1     Running   25m
```

```
$ kubectl get svc -n kube-system kube-dns
NAME       TYPE        CLUSTER-IP   PORT(S)
kube-dns   ClusterIP   10.96.0.10   53/UDP,53/TCP,9153/TCP
```

The service is still called kube-dns even though CoreDNS replaced kube-dns years ago. Keeping the
name meant nothing had to be reconfigured.

## Why Kubernetes uses it

It replaced kube-dns as the default in 1.13.

- one binary instead of three containers
- plugin based
- no dnsmasq, which had security problems
- Prometheus metrics built in

## How service discovery works

Nobody registers anything. CoreDNS watches the apiserver:

1. I create a Service
2. apiserver stores it in etcd
3. CoreDNS has a watch open so it is told immediately
4. it builds the records in memory, no file to reload
5. a pod queries 10.96.0.10 and gets the answer

What it builds:

- ClusterIP service -> A record with the one IP
- Headless service -> one A record per pod IP
- ExternalName -> a CNAME
- SRV records for named ports

I saw all three in Task 1.

## How a query is resolved

```
$ kubectl exec netshoot -- cat /etc/resolv.conf
search default.svc.cluster.local svc.cluster.local cluster.local
nameserver 10.96.0.10
options ndots:5
```

The kubelet writes this into every pod. So:

1. app asks for `web-clusterip`
2. fewer than 5 dots, so search list first, `web-clusterip.default.svc.cluster.local` hits
3. query goes to 10.96.0.10
4. kube-proxy forwards it to the real CoreDNS pod
5. CoreDNS sees cluster.local and answers from its own records

For something like `github.com` it does not know it, so the forward plugin sends it to the node's
own resolver.

## Configuration

Config is a ConfigMap called `coredns` in kube-system, and the file is the Corefile:

```
.:53 {
    errors
    health { lameduck 5s }
    ready
    kubernetes cluster.local in-addr.arpa ip6.arpa {
       pods insecure
       fallthrough in-addr.arpa ip6.arpa
       ttl 30
    }
    prometheus :9153
    forward . /etc/resolv.conf { max_concurrent 1000 }
    cache 30 {
       disable success cluster.local
       disable denial cluster.local
    }
    loop
    reload
    loadbalance
}
```

| line | what it does |
|---|---|
| `.:53` | serve everything on port 53 |
| `kubernetes cluster.local` | the important one, answer from the apiserver |
| `forward .` | anything not cluster.local goes upstream |
| `cache 30` | cache answers 30s |
| `loop` | refuse to start if there is a forwarding loop |
| `reload` | pick up config changes without a restart |
| `loadbalance` | shuffle record order |

Note `disable success cluster.local` - minikube turns caching off for cluster names. Makes sense,
they change often and CoreDNS gets them from a watch anyway, so caching would just serve stale
endpoints.

To change it you edit the ConfigMap and the reload plugin picks it up in a minute or two.

## Troubleshooting DNS

**1. Is CoreDNS up?**

```bash
kubectl get pods -n kube-system -l k8s-app=kube-dns
```

If it is CrashLoopBackOff, check the logs for a `loop` complaint, which means the node's resolv.conf
points back at CoreDNS.

**2. Does the pod have the right resolv.conf?**

```bash
kubectl exec <pod> -- cat /etc/resolv.conf
```

**3. Can it resolve anything?**

```bash
kubectl exec <pod> -- nslookup kubernetes.default.svc.cluster.local
```

`kubernetes.default` always exists, so this separates "DNS is broken" from "my service name is
wrong".

**4. Does the service have endpoints?**

```bash
kubectl get endpoints <name>
```

Empty endpoints is the most common cause. The name resolves fine but nothing answers. Usually the
selector does not match the pod labels, or the pods are not Ready yet.

**5. CoreDNS logs**

```bash
kubectl logs -n kube-system -l k8s-app=kube-dns
```

**6. Slow rather than broken?**

That is `ndots:5`. Use a trailing dot or set dnsConfig on the pod.

### Two failure modes to keep apart

| symptom | cause |
|---|---|
| does not resolve at all | CoreDNS down, wrong resolv.conf, wrong namespace in the name |
| resolves but connection refused | endpoints empty, selector mismatch, wrong port |

I hit the second one in Task 1. `web-headless` resolved perfectly and still refused the connection,
because a headless service gives back pod IPs and I was using the service port instead of the pod's
real port. Resolving fine is not the same as reachable.
