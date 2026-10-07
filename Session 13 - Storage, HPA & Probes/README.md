# Session 13 - Storage, HPA & Probes

Ashutosh Kumar - 24bcs10111

## Task 1 - Volumes

Full write-up in [`01-kubernetes-volumes/README.md`](01-kubernetes-volumes/).

| | lifetime | survives pod delete |
|---|---|---|
| emptyDir | the pod | no |
| hostPath | the node | no, tied to one node |
| PVC/PV | its own | yes |

The one worth seeing is dynamic provisioning. I created only a PVC and a PV appeared on its own:

```
persistentvolumeclaim/data-pvc   Bound   pvc-aafd773a-...   100Mi   standard
persistentvolume/pvc-aafd773a-...   100Mi   Delete   Bound   default/data-pvc
```

And it really persists - wrote a file, deleted the pod, made it again, file was still there.

## Task 2 - HPA

[`hpa/hpa.yml`](hpa/hpa.yml) is the deployment, service and HPA.

The important bit is the resource request, because HPA percentages are measured against it:

```yaml
resources:
  requests:
    cpu: 200m
```

No request means no percentage, so HPA cannot work at all.

```yaml
minReplicas: 1
maxReplicas: 10
metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 50
```

Keep average CPU near 50% of 200m, between 1 and 10 pods.

### Verify

Right after creating it:

```
NAME         REFERENCE               TARGETS              MINPODS   MAXPODS   REPLICAS
php-apache   Deployment/php-apache   cpu: <unknown>/50%   1         10        1
```

`<unknown>` for about a minute. The events said why:

```
Warning  FailedGetResourceMetric  failed to get cpu utilization:
  no metrics returned from resource metrics API
```

metrics-server had not scraped the new pod yet. It sorted itself out:

```
php-apache   Deployment/php-apache   cpu: 0%/50%   1   10   1
```

Needs the metrics-server addon, otherwise it stays `<unknown>` forever.

### Load test

[`hpa/load-generator.yml`](hpa/load-generator.yml) is a busybox pod in a `while true` wget loop.
Sampled every 30 seconds:

```
t+30s:  cpu=0%/50%    replicas=1   pods=1
t+60s:  cpu=183%/50%  replicas=1   pods=4
t+90s:  cpu=183%/50%  replicas=4   pods=4
t+120s: cpu=124%/50%  replicas=4   pods=5
t+150s: cpu=124%/50%  replicas=5   pods=5
t+180s: cpu=82%/50%   replicas=5   pods=9
t+240s: cpu=73%/50%   replicas=9   pods=9
t+300s: cpu=48%/50%   replicas=9   pods=9
```

CPU went to 183% of the request and it scaled 1 to 4 to 5 to 9. Each step brought the average down
because the same load spread over more pods, until 48% which is under the target so it stopped.

It did not jump straight to 10 because it recalculates each cycle:

```
desired = ceil(replicas x (current / target))
```

1 x (183/50) = 3.66 -> 4. That is why it stepped.

```
$ kubectl describe hpa php-apache
Metrics:    resource cpu on pods: 48% (96m) / 50%
Deployment pods:  9 current / 9 desired
Conditions:
  AbleToScale     True    ReadyForNewScale
  ScalingActive   True    ValidMetricFound
  ScalingLimited  False   DesiredWithinRange
Events:
  SuccessfulRescale  New size: 4; reason: cpu utilization above target
  SuccessfulRescale  New size: 5; reason: cpu utilization above target
  SuccessfulRescale  New size: 9; reason: cpu utilization above target
```

### Scaling back down

Deleted the load generator:

```
t+45s:  cpu=46%/50%  replicas=9
t+135s: cpu=2%/50%   replicas=9
t+180s: cpu=0%/50%   replicas=9
t+360s: cpu=0%/50%   replicas=9     <- still 9
```

CPU was 0% for six minutes and it stayed at 9. Then:

```
SuccessfulRescale  New size: 1; reason: All metrics below target
```

That delay is on purpose. The scale-down stabilization window defaults to 300s. It scales up fast
and down slow so a short dip does not kill pods you are about to need again. Worth knowing before
assuming the HPA is broken.

### Commands

```bash
kubectl get hpa
kubectl get pods
kubectl top pods
kubectl describe hpa
```

## Task 3 - Mini project

[`mini-project/app.yml`](mini-project/app.yml) uses everything from this session at once - a PVC, an
init container, all three probes, requests and limits, a Service and an HPA.

```
$ kubectl apply -f mini-project/app.yml
persistentvolumeclaim/notes-pvc created
deployment.apps/notes created
service/notes created
horizontalpodautoscaler.autoscaling/notes created
deployment "notes" successfully rolled out
```

The init container writes a page onto the PVC before nginx starts, and nginx serves it from there:

```
$ kubectl run t --image=busybox:1.36 --rm -i --restart=Never -- wget -qO- http://notes/
<h1>Notes app</h1><p>stored on a PVC</p>
```

So the content is not baked into the image, it is on the volume.

### The three probes

```yaml
startupProbe:
  httpGet: { path: /, port: 80 }
  failureThreshold: 10
  periodSeconds: 3
readinessProbe:
  httpGet: { path: /, port: 80 }
livenessProbe:
  httpGet: { path: /, port: 80 }
```

| probe | question | on failure |
|---|---|---|
| startup | has it finished booting? | keeps trying, **blocks the other two** |
| readiness | can it take traffic? | removed from the Service, not restarted |
| liveness | is it alive? | container is **restarted** |

The order matters. startupProbe gets 10 x 3s = 30 seconds, and the other two do not run until it
passes. Without it a slow starting app gets killed by its own liveness probe before it finishes
booting, forever. That is a CrashLoopBackOff that has nothing to do with the app being broken.

Readiness is also why a rolling update is zero downtime - a new pod gets no traffic until readiness
passes.
