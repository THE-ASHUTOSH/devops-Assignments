# Session 20 - Monitoring, Observability & GitOps

Ashutosh Kumar - 24bcs10111

## Task 1 - Monitoring

[`monitoring/metrics-demo.yml`](monitoring/metrics-demo.yml) is a deployment set up so it can
actually be monitored - resource requests, both probes, and Prometheus annotations.

### Metrics

```bash
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

This comes from metrics-server, which only keeps about the last minute in memory. It exists to feed
the HPA and `kubectl top`, not to be a monitoring system - no history, no alerting. For that you
run Prometheus.

`kubectl top` said `error: metrics not available yet` for the first 40 seconds. Same reason the HPA
showed `<unknown>` in Session 13, it scrapes on an interval.

### Why requests matter

```yaml
resources:
  requests: { cpu: 100m, memory: 32Mi }
  limits:   { cpu: 300m, memory: 128Mi }
```

Utilisation is measured against the **request**. At 2m CPU with a 100m request these pods are at
2%. No request means no percentage, which is why an HPA cannot work without one.

Requests also drive scheduling - the scheduler places pods by request, not actual use. That is why
`lc-pending` in Session 10 was never scheduled, it *requested* 500Gi even though it would have used
nothing.

The limit is the other half - go over the memory limit and the container is killed, go over the CPU
limit and it is throttled.

### Logs

```bash
kubectl logs -l app=monitored-app --tail=2
```
```
10.244.0.1 - - [07/Oct/2026:17:40:26 +0000] "GET / HTTP/1.1" 200 615 "-" "kube-probe/1.37" "-"
10.244.0.1 - - [07/Oct/2026:17:40:27 +0000] "GET / HTTP/1.1" 200 615 "-" "kube-probe/1.37" "-"
```

The only traffic is `kube-probe/1.37`, which is Kubernetes hitting the probes. Nice confirmation
they are running.

Kubernetes logging is minimal on purpose - logs go to stdout, the kubelet keeps them on the node,
and they are **lost when the pod is deleted**. Real clusters ship them off with Fluent Bit into
Loki or Elasticsearch.

### Health

```bash
kubectl get events --sort-by=.lastTimestamp
```
```
36s   Normal    Pulled      Container image "nginx:1.27-alpine" already present
36s   Normal    Created     Container created
36s   Normal    Started     Container started
36s   Warning   Unhealthy   Readiness probe failed: Get "http://10.244.0.117:80/":
                            dial tcp: connect: connection refused
```

That Unhealthy warning is real and expected, the probe fired before nginx finished binding to port
80. It passed a second later.

Useful to see because it is the difference between a startup warning and a real problem. A pod that
keeps logging Unhealthy is broken, one that logs it once at startup needs a startupProbe or a
longer initialDelaySeconds.

### Alerts

Nothing in core Kubernetes alerts. The usual stack is Prometheus scraping metrics and Alertmanager
sending to Slack, with rules like:

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
```

Alert on things users feel - error rate, latency - not on every metric. Alerting on "CPU > 80%"
gives you pages nobody acts on.

## Task 2 - Observability

### The three pillars

**Metrics** - numbers over time. Cheap, good for dashboards and alerts. Tell you *that* something
is wrong.

**Logs** - events with detail. Tell you *what* happened. Expensive at volume.

**Traces** - one request's path across every service with timing per hop. Tell you *where* the time
went. The one you cannot rebuild from the other two.

```
Metrics -> "checkout error rate jumped to 5%"          (something is wrong)
Logs    -> "connection timeout to payment-service"     (what happened)
Traces  -> "payment-service spent 4.8s in its DB call" (where)
```

### Why it is needed

Monitoring answers questions you thought of in advance. Observability is being able to answer ones
you did not, without shipping new code.

Microservices forced this. One slow page might touch eight services. Per-service CPU graphs will
not tell you which one, and a single log line will not either. You need to follow one request end
to end.

### Tools

| pillar | tools |
|---|---|
| Metrics | Prometheus, Grafana, metrics-server, CloudWatch |
| Logs | Loki, Elasticsearch, Fluent Bit |
| Traces | Jaeger, Tempo, Zipkin, X-Ray |
| All three | OpenTelemetry |

OpenTelemetry is the one worth knowing, it is becoming the standard way to emit all three so you can
change backend without redoing instrumentation.

### In Kubernetes

- **metrics-server** - what I used, last minute only, feeds HPA and `kubectl top`
- **kube-state-metrics** - metrics about Kubernetes objects (replica counts, pod phases, restarts)
  rather than resource usage
- **node-exporter** - node OS metrics, runs as a DaemonSet
- **kube-prometheus-stack** - the Helm chart that installs all of the above plus Grafana

Worth watching: pod restart counts, pods not Running, node conditions, PVC usage, and whether a
Deployment's ready replicas match desired.

## Task 3 - GitOps

[`gitops/application.yml`](gitops/application.yml) is an Argo CD Application.

### What is GitOps

Git holds the desired state and an agent **inside the cluster** keeps making reality match it. You
never run `kubectl apply` against production, you merge a PR.

### Git as source of truth

If it is not in git, it is not in the cluster. That gives you:

- an audit trail, every change is a commit with an author
- code review on infrastructure
- rollback is `git revert`
- a new cluster can be rebuilt by pointing the agent at the repo

The alternative, people running kubectl from laptops, means nobody can say what is actually
deployed. I did a small version of this myself - in Session 12 I patched a ConfigMap with
`kubectl patch`, and at that point my YAML file no longer matched the cluster.

### Reconciliation

This is the real difference from push-based CD:

```
Push (Session 16):  CI -> kubectl apply -> cluster    (once, on merge)
GitOps (pull):      agent in cluster -> polls git -> reconciles   (forever)
```

```yaml
syncPolicy:
  automated:
    prune: true      # delete things removed from git
    selfHeal: true   # revert manual kubectl changes
```

`selfHeal: true` is the interesting one. Someone runs `kubectl scale --replicas=10` by hand, and
within minutes Argo CD notices the drift and scales it back. Drift gets corrected instead of
building up.

`prune: true` is the matching one and the one to be careful with - delete a manifest from git and
the resource is deleted from the cluster.

### Workflow

```
PR changing kubernetes/deployment.yml
        |
review and merge to main
        |
Argo CD notices the commit
        |
compares git vs live cluster
        |
applies the difference
        |
keeps checking, forever
```

Nothing outside the cluster needs credentials **to** the cluster. That is a real security win over
push-based CD, where your CI system holds a kubeconfig with admin rights - which is exactly what the
deploy job in my Session 17 pipeline would need.

Tools are Argo CD (what I wrote the manifest for, has a UI) and Flux (lighter).
