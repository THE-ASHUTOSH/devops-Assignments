# Session 20 - Monitoring, Observability & GitOps

**Ashutosh Kumar** · **24bcs10111**

## Task 1 - Monitoring

[`monitoring/metrics-demo.yml`](monitoring/metrics-demo.yml) - a deployment set up so it can
actually be monitored: resource requests, both probes, and Prometheus scrape annotations.

### Metrics

```bash
kubectl apply -f monitoring/metrics-demo.yml
kubectl top pods -l app=monitored-app
```

```
NAME                            CPU(cores)   MEMORY(bytes)
monitored-app-b96747fb5-2n6lj   2m           17Mi
monitored-app-b96747fb5-xjtj6   2m           21Mi
```

```bash
kubectl top nodes
```

```
NAME       CPU(cores)   CPU(%)   MEMORY(bytes)   MEMORY(%)
minikube   103m         0%       1031Mi          8%
```

This comes from **metrics-server**, which only keeps the last ~1 minute in memory. It exists to feed
the HPA and `kubectl top`, not to be a monitoring system - there's no history and no alerting. For
that you'd run Prometheus.

`kubectl top` said `error: metrics not available yet` for the first ~40 seconds after deploying.
Same thing that made the HPA show `<unknown>` in Session 13 - metrics-server scrapes on an interval.

### CPU and memory utilisation

The reason `requests` matter:

```yaml
resources:
  requests: { cpu: 100m, memory: 64Mi }
  limits:   { cpu: 300m, memory: 128Mi }
```

Utilisation is measured **against the request**. At 2m CPU with a 100m request, these pods are at
2%. No request means no percentage, which is why an HPA can't work without one.

Requests also drive scheduling - the scheduler places pods by request, not by actual use. That's why
`lc-pending` in Session 10 never got scheduled: it *requested* 500Gi, even though it would have used
almost nothing.

The limit is the other half: exceed the memory limit and the container is OOMKilled; exceed the CPU
limit and it's throttled, not killed.

### Logs

```bash
kubectl logs -l app=monitored-app --tail=2
```

```
10.244.0.1 - - [07/Oct/2026:17:40:26 +0000] "GET / HTTP/1.1" 200 615 "-" "kube-probe/1.37" "-"
10.244.0.1 - - [07/Oct/2026:17:40:27 +0000] "GET / HTTP/1.1" 200 615 "-" "kube-probe/1.37" "-"
```

The only traffic is `kube-probe/1.37` - that's Kubernetes itself hitting the readiness and liveness
probes. Nice confirmation the probes are actually running.

Kubernetes logging is deliberately minimal: logs go to stdout/stderr, the kubelet keeps them on the
node, and they're **lost when the pod is deleted**. Real clusters ship them off with Fluent Bit or
Promtail into Loki or Elasticsearch.

### Application health

```bash
kubectl get events --sort-by=.lastTimestamp
```

```
36s   Normal    Pulled      Container image "nginx:1.27-alpine" already present on machine
36s   Normal    Created     Container created
36s   Normal    Started     Container started
36s   Warning   Unhealthy   Readiness probe failed: Get "http://10.244.0.117:80/":
                            dial tcp 10.244.0.117:80: connect: connection refused
```

That `Unhealthy` warning is real and expected - the probe fired before nginx finished binding to
port 80. It passed a second later. Useful to see, because it's the difference between a transient
startup warning and a genuine problem: a pod that keeps logging Unhealthy is broken, one that logs
it once at startup needs a `startupProbe` or a longer `initialDelaySeconds`.

### Alerts

Nothing in core Kubernetes alerts. The usual stack is Prometheus scraping metrics → Alertmanager
routing to Slack/PagerDuty, with rules like:

```yaml
- alert: PodCrashLooping
  expr: rate(kube_pod_container_status_restarts_total[15m]) > 0
  for: 10m
```

The annotations in my manifest are how Prometheus finds targets:

```yaml
annotations:
  prometheus.io/scrape: "true"
  prometheus.io/port: "80"
  prometheus.io/path: "/metrics"
```

Prometheus discovers pods through the Kubernetes API and scrapes the ones marked like this. (Plain
nginx doesn't actually serve `/metrics` - you'd add an exporter sidecar.)

Alert on **symptoms users feel** - error rate, latency, saturation - not on every metric. Alerting on
"CPU > 80%" produces pages nobody acts on.

## Task 2 - Observability

### The three pillars

**Metrics** - numbers over time. Cheap, aggregatable, good for dashboards and alerts. Tell you
*that* something is wrong. `kubectl top` output above is metrics.

**Logs** - discrete events with detail. Tell you *what* happened. Expensive at volume. The nginx
access lines above are logs.

**Traces** - one request's path across every service, with timing per hop. Tell you *where* the time
went. This is the one you can't reconstruct from the other two in a microservice system.

```
Metrics → "checkout error rate jumped to 5%"        (something is wrong)
Logs    → "connection timeout to payment-service"   (what happened)
Traces  → "payment-service spent 4.8s in its DB call" (where)
```

### Why observability is required

Monitoring answers questions you thought of in advance - a dashboard for a failure you predicted.
Observability is being able to answer questions you **didn't** predict, without shipping new code.

Microservices forced the distinction. One slow page might touch eight services; per-service CPU
graphs won't tell you which one, and a log line in isolation won't either. You need to follow one
request end to end.

### Common tools

| pillar | tools |
|---|---|
| Metrics | Prometheus, Grafana, metrics-server, CloudWatch, Datadog |
| Logs | Loki, Elasticsearch/Kibana, Fluent Bit, CloudWatch Logs |
| Traces | Jaeger, Tempo, Zipkin, AWS X-Ray |
| All three | OpenTelemetry (the vendor-neutral standard), Datadog, New Relic |

OpenTelemetry is the one worth knowing - it's becoming the standard way to emit all three, so you
can change backend without re-instrumenting.

### Kubernetes observability

- **metrics-server** - what I used. Last ~1 minute only, feeds HPA and `kubectl top`.
- **kube-state-metrics** - metrics about Kubernetes objects themselves (replica counts, pod phases,
  restart counts) rather than resource usage.
- **node-exporter** - node-level OS metrics, runs as a DaemonSet.
- **kube-prometheus-stack** - the Helm chart that installs Prometheus, Grafana, Alertmanager and the
  above together. The normal starting point.

The things worth watching: pod restart counts, pods not in Running, node conditions, PVC usage,
and whether a Deployment's ready replicas match desired.

## Task 3 - GitOps

[`gitops/application.yml`](gitops/application.yml) - an Argo CD Application.

### What is GitOps?

Git holds the desired state of the system, and an agent **in the cluster** continuously makes
reality match it. You never run `kubectl apply` against production - you merge a PR.

### Git as the source of truth

If it isn't in git, it isn't in the cluster. That gives you:

- a full audit trail - every change is a commit with an author and a reason
- code review on infrastructure changes, same as application code
- rollback is `git revert`
- a new cluster can be rebuilt by pointing the agent at the repo

The alternative - people running `kubectl apply` from laptops - means nobody can say what's actually
deployed. I hit a small version of this myself: in Session 12 I patched a ConfigMap with
`kubectl patch`, and at that moment my YAML file no longer matched the cluster.

### Declarative configuration

GitOps only works because Kubernetes is declarative. You commit *what you want*, not steps to get
there. Everything in this repo - Deployments, Services, Ingress, HPAs, the Helm chart - is already
in that form.

### Continuous reconciliation

The important difference from CI/CD push-based deploys.

```
Push-based (Session 16):   CI → kubectl apply → cluster      (happens once, on merge)
GitOps (pull-based):       agent in cluster → polls git → reconciles   (forever, every few minutes)
```

```yaml
syncPolicy:
  automated:
    prune: true      # delete resources removed from git
    selfHeal: true   # revert manual kubectl changes
```

`selfHeal: true` is the interesting flag. Someone runs `kubectl scale deployment demo --replicas=10`
by hand; within minutes Argo CD notices the drift from git and scales it back. Configuration drift
gets corrected automatically instead of accumulating.

`prune: true` is the matching one, and the one to be careful with - delete a manifest from git and
the resource is deleted from the cluster.

### GitOps workflow

```
developer opens a PR changing kubernetes/deployment.yml
        ↓
review + merge to main
        ↓
Argo CD (running in the cluster) notices the commit
        ↓
compares git vs live cluster state
        ↓
applies the difference
        ↓
keeps checking, forever
```

Nothing outside the cluster needs credentials **to** the cluster. That's a real security win over
push-based CD, where your CI system holds a kubeconfig with admin rights - which is exactly what the
`deploy` job in my Session 17 pipeline would need.

### Kubernetes + GitOps

Tools: **Argo CD** (what I wrote the manifest for, has a good UI) and **Flux** (lighter, more
GitOps-toolkit style).

A common layout is two repos - application code in one, manifests in another - so a CI build updates
an image tag in the config repo, and the GitOps agent picks that up. Keeps "build" and "deploy"
separate.

## Deliverables

| | where |
|---|---|
| Monitoring demo | [`monitoring/metrics-demo.yml`](monitoring/metrics-demo.yml) + output above |
| Observability documentation | Task 2 |
| GitOps demo | [`gitops/application.yml`](gitops/application.yml) |
| Output | `kubectl top`, logs, events above |
