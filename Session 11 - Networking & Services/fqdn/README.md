# FQDN in Kubernetes

## What is FQDN?

Fully Qualified Domain Name - the complete name of a host, all the way up to the root, with nothing
left to guess.

`web-clusterip` is a short name. `web-clusterip.default.svc.cluster.local` is the FQDN. The short
one only works if the resolver knows what to append; the FQDN works from anywhere.

## Kubernetes Service DNS

Every Service automatically gets a DNS record. I didn't configure anything - I created the Service
and it was resolvable:

```
$ kubectl exec netshoot -- nslookup web-clusterip.default.svc.cluster.local
Name:	web-clusterip.default.svc.cluster.local
Address: 10.104.92.31
```

This is why you never hardcode a pod IP. The Service name is stable, the pod IPs are not.

## Naming convention

```
<service-name>.<namespace>.svc.cluster.local
```

Reading it right to left:

| part | what it is |
|---|---|
| `cluster.local` | the cluster domain (configurable, this is the default) |
| `svc` | says this is a Service record |
| `default` | the namespace the Service is in |
| `web-clusterip` | the Service name |

For pods it's `<pod-ip-with-dashes>.<namespace>.pod.cluster.local`, e.g.
`10-244-0-76.default.pod.cluster.local`. Rarely used directly.

For a StatefulSet pod behind a headless Service you get a per-pod name:

```
<pod-name>.<service-name>.<namespace>.svc.cluster.local
db-0.web-headless.default.svc.cluster.local
```

That's the stable identity a StatefulSet promises.

## Namespace-based DNS

The short name only resolves inside the same namespace. This is because of the search list in every
pod's `/etc/resolv.conf`:

```
$ kubectl exec netshoot -- cat /etc/resolv.conf
search default.svc.cluster.local svc.cluster.local cluster.local
nameserver 10.96.0.10
options ndots:5
```

So from a pod in `default`:

| you type | resolver tries | works? |
|---|---|---|
| `web-clusterip` | `web-clusterip.default.svc.cluster.local` | yes |
| `web-clusterip.default` | `web-clusterip.default.svc.cluster.local` | yes |
| `web-clusterip.default.svc.cluster.local` | exactly that | yes |

From a pod in a *different* namespace, the short name fails - the first search entry would be
`<other-ns>.svc.cluster.local`. You need at least `<service>.<namespace>`.

Two details in that resolv.conf worth knowing:

- `nameserver 10.96.0.10` is the `kube-dns` Service ClusterIP. Confirmed:

  ```
  $ kubectl get svc -n kube-system kube-dns
  NAME       TYPE        CLUSTER-IP   PORT(S)
  kube-dns   ClusterIP   10.96.0.10   53/UDP,53/TCP,9153/TCP
  ```

- `options ndots:5` means any name with fewer than 5 dots gets the search list tried **first**.
  `google.com` has 1 dot, so the resolver first tries `google.com.default.svc.cluster.local`,
  `google.com.svc.cluster.local`, `google.com.cluster.local`, and only then `google.com`. Four
  failed lookups before every external call. It's a well-known source of DNS slowness, and the fix
  is a trailing dot (`google.com.`) or lowering ndots per-pod via `dnsConfig`.

## Pod-to-Service communication

What actually happens when one pod calls another by name:

1. App connects to `http://web-clusterip/`.
2. Resolver appends the search domains, asks CoreDNS at `10.96.0.10`.
3. CoreDNS answers with the Service ClusterIP, `10.104.92.31`.
4. App opens a TCP connection to that IP.
5. kube-proxy's iptables rules rewrite the destination to one real pod IP.
6. Packet reaches the pod.

Steps 1-3 are DNS, 4-6 are kube-proxy. Two separate mechanisms, which is why a service can fail in
two different ways - name doesn't resolve (DNS problem) vs resolves but connection refused
(endpoints/selector problem).

Verified it end to end:

```
$ kubectl exec netshoot -- wget -qO- http://web-clusterip/
hello from web
```

## Examples

```
web-clusterip.default.svc.cluster.local           ClusterIP service in default
kube-dns.kube-system.svc.cluster.local            CoreDNS itself
external-db.default.svc.cluster.local             ExternalName, returns a CNAME
db-0.web-headless.default.svc.cluster.local       one specific StatefulSet pod
10-244-0-76.default.pod.cluster.local             a pod by IP
```

The ExternalName one is a nice example of the FQDN resolving to something outside the cluster
entirely:

```
$ kubectl exec netshoot -- nslookup external-db.default.svc.cluster.local
external-db.default.svc.cluster.local	canonical name = example.com
Name:	example.com
Address: 172.66.147.243
```

And a headless FQDN returning several addresses instead of one:

```
$ kubectl exec netshoot -- nslookup web-headless.default.svc.cluster.local
Address: 10.244.0.78
Address: 10.244.0.76
Address: 10.244.0.77
```
