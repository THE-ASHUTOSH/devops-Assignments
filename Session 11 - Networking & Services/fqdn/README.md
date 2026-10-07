# FQDN

## What is FQDN

The full name of a host with nothing left to guess. `web-clusterip` is a short name,
`web-clusterip.default.svc.cluster.local` is the FQDN. The short one only works if the resolver
knows what to add.

## Service DNS

Every Service gets a DNS record automatically. I did not configure anything:

```
$ kubectl exec netshoot -- nslookup web-clusterip.default.svc.cluster.local
Name:	web-clusterip.default.svc.cluster.local
Address: 10.104.92.31
```

This is why you never hardcode a pod IP. The service name stays, the pod IPs do not.

## Naming convention

```
<service>.<namespace>.svc.cluster.local
```

Reading it backwards:

| part | what it is |
|---|---|
| cluster.local | the cluster domain |
| svc | says this is a Service |
| default | the namespace |
| web-clusterip | the service name |

For a StatefulSet pod behind a headless Service you also get a per-pod name:

```
db-0.web-headless.default.svc.cluster.local
```

That is the stable identity a StatefulSet gives you.

## Namespace DNS

The short name only works inside the same namespace, because of the search list in every pod:

```
$ kubectl exec netshoot -- cat /etc/resolv.conf
search default.svc.cluster.local svc.cluster.local cluster.local
nameserver 10.96.0.10
options ndots:5
```

So from a pod in `default`:

| you type | works? |
|---|---|
| `web-clusterip` | yes |
| `web-clusterip.default` | yes |
| full FQDN | yes |

From a different namespace the short name fails, you need at least `<service>.<namespace>`.

Two things in that file:

- `nameserver 10.96.0.10` is the kube-dns Service IP.
- `options ndots:5` means any name with fewer than 5 dots tries the search list first. So
  `google.com` gets tried as `google.com.default.svc.cluster.local` and two others before the real
  one. Four failed lookups before every external call, which is a known cause of slow DNS. Fix is a
  trailing dot (`google.com.`) or setting dnsConfig on the pod.

## Pod to Service

What happens when one pod calls another by name:

1. app connects to `http://web-clusterip/`
2. resolver adds the search domains, asks CoreDNS at 10.96.0.10
3. CoreDNS replies with the ClusterIP
4. app opens a connection to it
5. kube-proxy rewrites the destination to a real pod IP

Steps 1-3 are DNS, 4-5 are kube-proxy. Two separate things, which is why a service can fail two
ways - name does not resolve (DNS) or resolves but connection refused (endpoints/selector).

```
$ kubectl exec netshoot -- wget -qO- http://web-clusterip/
hello from web
```

## Examples

```
web-clusterip.default.svc.cluster.local      ClusterIP service
kube-dns.kube-system.svc.cluster.local       CoreDNS itself
external-db.default.svc.cluster.local        ExternalName, gives a CNAME
db-0.web-headless.default.svc.cluster.local  one StatefulSet pod
```

ExternalName resolving to something outside the cluster:

```
external-db.default.svc.cluster.local	canonical name = example.com
Address: 172.66.147.243
```

Headless giving several addresses instead of one:

```
Address: 10.244.0.78
Address: 10.244.0.76
Address: 10.244.0.77
```
