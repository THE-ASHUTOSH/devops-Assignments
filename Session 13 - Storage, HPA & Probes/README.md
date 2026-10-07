# Session 13 - Kubernetes Storage, HPA & Probes

**Ashutosh Kumar** · **24bcs10111**

## Task 1 - Kubernetes Volumes

Full write-up with real output in [`01-kubernetes-volumes/README.md`](01-kubernetes-volumes/).

Covers emptyDir, hostPath, PersistentVolume, PersistentVolumeClaim, StorageClass and dynamic
provisioning, each with a manifest I actually applied.

Quick version:

| | lifetime | survives pod delete |
|---|---|---|
| emptyDir | the pod | no |
| hostPath | the node | no (tied to one node) |
| PVC/PV | its own | yes |

The one worth seeing is dynamic provisioning - I created only a PVC and a PV appeared by itself:

```
NAME                             STATUS   VOLUME                                     CAPACITY   STORAGECLASS
persistentvolumeclaim/data-pvc   Bound    pvc-aafd773a-59e1-40c2-bcc8-065f3d576bdf   100Mi      standard
persistentvolume/pvc-aafd773a-59e1-40c2-bcc8-065f3d576bdf   100Mi   Delete   Bound   default/data-pvc
```

And it genuinely persists - wrote a file, deleted the pod, recreated it, file was still there.

## Task 2 - HPA hands-on

[`hpa/hpa.yml`](hpa/hpa.yml) - deployment + service + HorizontalPodAutoscaler.

### 1. Deploy the application

The important part is the **resource request**, because HPA percentages are measured against it:

```yaml
resources:
  requests:
    cpu: 200m
  limits:
    cpu: 500m
```

No request = no percentage to calculate = HPA can't work at all.

### 2. Configure HPA

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

So: keep average CPU near 50% of 200m (= 100m), between 1 and 10 pods.

### 3. Verify HPA

```bash
kubectl get hpa
```

Right after creating it:

```
NAME         REFERENCE               TARGETS              MINPODS   MAXPODS   REPLICAS   AGE
php-apache   Deployment/php-apache   cpu: <unknown>/50%   1         10        1          57s
```

`<unknown>` for the first minute or so. The HPA events explain why:

```
Warning  FailedGetResourceMetric  failed to get cpu utilization: unable to get metrics
                                  for resource cpu: no metrics returned from resource metrics API
```

metrics-server hadn't scraped the new pod yet. It settled on its own:

```
NAME         REFERENCE               TARGETS       MINPODS   MAXPODS   REPLICAS   AGE
php-apache   Deployment/php-apache   cpu: 0%/50%   1         10        1          2m2s
```

Needs the metrics-server addon (`minikube addons enable metrics-server`), otherwise it stays
`<unknown>` forever. Checked it was working with:

```
$ kubectl top pods -l run=php-apache
NAME                          CPU(cores)   MEMORY(bytes)
php-apache-5899f79df5-fhdhr   1m           11Mi
```

### 4-7. Deploy load generator, watch it scale

[`hpa/load-generator.yml`](hpa/load-generator.yml) - a busybox pod in a `while true` wget loop
against the service.

```bash
kubectl apply -f hpa/load-generator.yml
```

Sampled every 30 seconds:

```
t+30s:  cpu=0%/50%    replicas=1   pods=1
t+60s:  cpu=183%/50%  replicas=1   pods=4
t+90s:  cpu=183%/50%  replicas=4   pods=4
t+120s: cpu=124%/50%  replicas=4   pods=5
t+150s: cpu=124%/50%  replicas=5   pods=5
t+180s: cpu=82%/50%   replicas=5   pods=9
t+210s: cpu=82%/50%   replicas=9   pods=9
t+240s: cpu=73%/50%   replicas=9   pods=9
t+300s: cpu=48%/50%   replicas=9   pods=9
```

CPU shot to **183%** of the request, and it scaled 1 → 4 → 5 → 9. Each step brought the average
down because the same load was spread over more pods, until 48% - just under the 50% target, so it
stopped.

It didn't jump straight to 10. The HPA recalculates each cycle:

```
desired = ceil(current replicas × (current metric / target metric))
```

1 × (183/50) = 3.66 → 4. Then 4 × (124/50) = 9.9, capped by the scale-up rate. That's why it
stepped rather than jumping.

### 8. Capture the output

```bash
kubectl describe hpa php-apache
```

```
Metrics:                                               ( current / target )
  resource cpu on pods  (as a percentage of request):  48% (96m) / 50%
Min replicas:                                          1
Max replicas:                                          10
Deployment pods:                                       9 current / 9 desired
Conditions:
  Type            Status  Reason              Message
  AbleToScale     True    ReadyForNewScale    recommended size matches current size
  ScalingActive   True    ValidMetricFound    the HPA was able to successfully calculate a replica count
  ScalingLimited  False   DesiredWithinRange  the desired count is within the acceptable range
Events:
  Normal  SuccessfulRescale  New size: 4; reason: cpu resource utilization above target
  Normal  SuccessfulRescale  New size: 5; reason: cpu resource utilization above target
  Normal  SuccessfulRescale  New size: 9; reason: cpu resource utilization above target
```

### Scaling back down

Deleted the load generator and watched:

```
t+45s:  cpu=46%/50%  replicas=9
t+135s: cpu=2%/50%   replicas=9
t+180s: cpu=0%/50%   replicas=9
t+360s: cpu=0%/50%   replicas=9     <- still 9!
```

CPU was 0% for **six minutes** and it stayed at 9 pods. Then:

```
Normal  SuccessfulRescale  New size: 1; reason: All metrics below target
```

That delay is deliberate - `stabilizationWindowSeconds` defaults to **300s** for scale-down. It
scales up fast and down slow, so a brief dip in traffic doesn't kill pods you're about to need
again. Good thing to know before assuming the HPA is broken.

### Commands used

```bash
kubectl get hpa
kubectl get pods
kubectl top pods
kubectl describe hpa
```

## Task 3 - Mini project

[`mini-project/app.yml`](mini-project/app.yml) - one app that uses everything from this session at
once: a PVC, an init container, all three probe types, resource requests/limits, a Service and an
HPA.

```
$ kubectl apply -f mini-project/app.yml
persistentvolumeclaim/notes-pvc created
deployment.apps/notes created
service/notes created
horizontalpodautoscaler.autoscaling/notes created
deployment "notes" successfully rolled out
```

The init container seeds a page onto the PVC before nginx starts, and nginx serves it from there:

```
$ kubectl run t --image=busybox:1.36 --rm -i --restart=Never -- wget -qO- http://notes/
<h1>Notes app</h1><p>stored on a PVC</p>
```

So the content isn't baked into the image - it's on the persistent volume.

### The three probes

This is the part the task title mentions and it's worth being precise about, because they look
similar and do different things.

```yaml
startupProbe:
  httpGet: { path: /, port: 80 }
  failureThreshold: 10
  periodSeconds: 3
readinessProbe:
  httpGet: { path: /, port: 80 }
  periodSeconds: 5
livenessProbe:
  httpGet: { path: /, port: 80 }
  periodSeconds: 10
```

| probe | question | on failure |
|---|---|---|
| **startup** | has it finished booting? | keeps restarting until it passes; **blocks the other two** |
| **readiness** | can it take traffic? | removed from Service endpoints, **not** restarted |
| **liveness** | is it still alive? | container is **restarted** |

The ordering matters. `startupProbe` gets 10 × 3s = 30 seconds to pass, and liveness/readiness
don't even run until it does. Without it, a slow-starting app gets killed by its own liveness probe
before it ever finishes booting, forever. That's a classic CrashLoopBackOff that has nothing to do
with the app being broken.

And readiness is why a rolling update is zero-downtime - a new pod gets no traffic until readiness
passes, so the Service never sends a request to a pod that isn't ready.
