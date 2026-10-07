# Monitoring

## What is collected

| | how |
|---|---|
| Metrics | metrics-server for `kubectl top` and the HPA; Prometheus for history + alerts |
| Logs | stdout/stderr from the app, shipped by Fluent Bit in a real cluster |
| Health | `/health` (liveness) and `/ready` (readiness) on the app itself |

The app exposes `/health` returning `{"status":"ok","visits":N}`, which is what both probes hit.

## Commands

```bash
kubectl top pods -l app=visitor-app
kubectl top nodes
kubectl get hpa visitor-app
kubectl logs -l app=visitor-app --tail=20
kubectl get events --sort-by=.lastTimestamp
```

## Alert rules worth having

```yaml
- alert: PodCrashLooping
  expr: rate(kube_pod_container_status_restarts_total[15m]) > 0
  for: 10m

- alert: DeploymentNotFullyAvailable
  expr: kube_deployment_status_replicas_available < kube_deployment_spec_replicas
  for: 10m

- alert: HighErrorRate
  expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
  for: 5m
```

Alert on symptoms users feel, not on every metric.
