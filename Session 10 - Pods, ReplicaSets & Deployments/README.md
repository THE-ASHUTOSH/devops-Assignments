# Session 10 - Kubernetes Pods, ReplicaSets & Deployments

**Ashutosh Kumar** · **24bcs10111**

minikube, Kubernetes v1.37.0. All four deployment strategies plus the pod lifecycle, run for real.

## Task 1 - Deployment strategies

### 01. Rolling update

[`01-rolling-update/deployment.yml`](01-rolling-update/deployment.yml) - 4 replicas of
`nginx:1.25-alpine`, with:

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1
    maxUnavailable: 1
```

`maxSurge: 1` lets it run a 5th pod temporarily, `maxUnavailable: 1` says at most 1 of the 4 can be
down. So there are always at least 3 serving.

Deployed it, then changed the image:

```bash
kubectl apply -f 01-rolling-update/deployment.yml
kubectl set image deployment/web-rolling nginx=nginx:1.27-alpine
```

I ran `get rs` **while the rollout was happening** and this is the interesting bit:

```
NAME                     DESIRED   CURRENT   READY   AGE
web-rolling-7b866d8545   3         3         3       49s     <- old, scaling down
web-rolling-85d6f9cf5f   2         2         0       7s      <- new, scaling up
```

```
NAME                           READY   STATUS              RESTARTS   AGE
web-rolling-7b866d8545-4g7sx   1/1     Running             0          49s
web-rolling-7b866d8545-r4cmm   1/1     Running             0          49s
web-rolling-7b866d8545-xh2dh   1/1     Running             0          49s
web-rolling-85d6f9cf5f-2lmbr   0/1     ContainerCreating   0          7s
web-rolling-85d6f9cf5f-b4768   0/1     ContainerCreating   0          7s
```

**Two ReplicaSets at once.** That's the whole mechanism - a Deployment doesn't modify pods, it
creates a second ReplicaSet and shifts replicas from one to the other a few at a time. 3 old + 2
new = 5, which is the `maxSurge: 1` above 4.

`kubectl rollout status` narrating it:

```
Waiting for deployment "web-rolling" rollout to finish: 2 out of 4 new replicas have been updated...
Waiting for deployment "web-rolling" rollout to finish: 3 out of 4 new replicas have been updated...
Waiting for deployment "web-rolling" rollout to finish: 1 old replicas are pending termination...
Waiting for deployment "web-rolling" rollout to finish: 3 of 4 updated replicas are available...
deployment "web-rolling" successfully rolled out
```

After:

```
NAME                     DESIRED   CURRENT   READY   AGE
web-rolling-7b866d8545   0         0         0       69s
web-rolling-85d6f9cf5f   4         4         4       27s
```

The old ReplicaSet is kept at 0, not deleted. **That's what makes rollback instant** - the old one
is still sitting there ready to scale back up:

```bash
kubectl rollout history deployment/web-rolling
```
```
REVISION  CHANGE-CAUSE
1         <none>
2         <none>
```

```bash
kubectl rollout undo deployment/web-rolling
```
```
deployment.apps/web-rolling rolled back

NAME                     DESIRED   CURRENT   READY   AGE
web-rolling-7b866d8545   4         4         4       82s     <- back up
web-rolling-85d6f9cf5f   0         0         0       40s     <- back down
```

Image went back to `nginx:1.25-alpine`. No pulling, no rebuilding - it just scaled the old
ReplicaSet back.

**Zero downtime.** This is the default and the one you want almost always.

### 02. Blue-Green

Two full deployments running at once, and a Service that points at one of them with a label.

- [`blue.yml`](02-blue-green/blue.yml) - 3 pods, `version: blue`, serves "I am BLUE v1"
- [`green.yml`](02-blue-green/green.yml) - 3 pods, `version: green`, serves "I am GREEN v2"
- [`service.yml`](02-blue-green/service.yml) - selector `app: myapp, version: blue`

Blue up first, service pointing at it:

```
NAME    ENDPOINTS                                            AGE
myapp   10.244.0.44:8080,10.244.0.45:8080,10.244.0.46:8080   4m25s
```
```
$ curl http://myapp/
I am BLUE v1
```

Then deployed green **alongside** blue. Both running, 6 pods total:

```
app-blue    3/3     3            3           4m41s
app-green   3/3     3            3           1s
```
```
NAME                        READY   STATUS    AGE   LABELS
app-blue-768b7fb867-457l4   1/1     Running   17s   app=myapp,version=blue
app-blue-768b7fb867-p749p   1/1     Running   17s   app=myapp,version=blue
app-blue-768b7fb867-wkmwl   1/1     Running   17s   app=myapp,version=blue
app-green-98495cd76-b922m   1/1     Running   1s    app=myapp,version=green
app-green-98495cd76-brpc4   1/1     Running   1s    app=myapp,version=green
app-green-98495cd76-d5p28   1/1     Running   1s    app=myapp,version=green
```

Green is live but getting **zero traffic**, because the service selector still says blue. Checked:

```
$ kubectl get svc myapp -o jsonpath='{.spec.selector}'
{"app":"myapp","version":"blue"}

$ curl http://myapp/
I am BLUE v1
```

Then the switch - one label change:

```bash
kubectl patch service myapp -p '{"spec":{"selector":{"app":"myapp","version":"green"}}}'
```
```
service/myapp patched
selector now: {"app":"myapp","version":"green"}

NAME    ENDPOINTS                                            AGE
myapp   10.244.0.50:8080,10.244.0.51:8080,10.244.0.52:8080   4m51s
```

Different IPs now - the endpoints list got rewritten.

```
$ curl http://myapp/   (x3)
I am GREEN v2
I am GREEN v2
I am GREEN v2
```

Rollback is the same patch backwards, and it was instant:

```
$ curl http://myapp/
I am BLUE v1
```

**Nothing restarted.** Both versions were already running; only the selector moved. That's the
point of blue-green - the switch and the rollback are both instant. The cost is you need double the
pods while both are up.

### 03. Canary

Same service, two deployments, but the service selector is **deliberately less specific**:

```yaml
selector:
  app: shop        # no 'track' label, so it matches stable AND canary pods
```

- [`stable.yml`](03-canary/stable.yml) - 4 replicas, "STABLE v1"
- [`canary.yml`](03-canary/canary.yml) - 1 replica, "CANARY v2"

4 + 1 = 5 pods behind one service, so roughly 20% of requests should hit the canary. The ratio is
just the pod count - that's the trick with plain Kubernetes canary.

```
NAME                           STATUS    LABELS
shop-canary-79bdf6b58c-8stnz   Running   app=shop,track=canary
shop-stable-9849d5bd4-7v6g9    Running   app=shop,track=stable
shop-stable-9849d5bd4-gp6cd    Running   app=shop,track=stable
shop-stable-9849d5bd4-kzcr8    Running   app=shop,track=stable
shop-stable-9849d5bd4-nmnp2    Running   app=shop,track=stable
```

25 requests through the service:

```bash
kubectl run loadtest --image=curlimages/curl:8.10.1 --restart=Never --rm -i \
  -- sh -c 'for i in $(seq 1 25); do curl -s http://shop/; done' | sort | uniq -c
```
```
     17 STABLE v1
      8 CANARY v2
```

Expected 20/5, got 17/8. Not exact - kube-proxy balances per-connection and 25 requests is a small
sample, so it won't land on the ratio neatly. The point stands: most traffic to stable, a slice to
canary, and I'd watch the canary's error rate before going further.

Promoting it is just scaling:

```bash
kubectl scale deployment shop-canary --replicas=4
kubectl scale deployment shop-stable --replicas=0
```
```
NAME                           READY   STATUS    RESTARTS   AGE
shop-canary-79bdf6b58c-7gn5r   1/1     Running   0          15s
shop-canary-79bdf6b58c-8stnz   1/1     Running   0          33s
shop-canary-79bdf6b58c-klfj9   1/1     Running   0          15s
shop-canary-79bdf6b58c-rz2jg   1/1     Running   0          15s
```
```
$ curl http://shop/
CANARY v2
```

100% canary now. Aborting instead would be `kubectl scale deployment shop-canary --replicas=0`.

Limitation worth knowing: splitting by pod count means you can't do 1% without 100 pods, and you
can't route by header or user. That's where Istio / Argo Rollouts / an ingress with traffic
weighting come in.

### 04. Recreate

[`04-recreate/deployment.yml`](04-recreate/deployment.yml):

```yaml
strategy:
  type: Recreate
```

Kill everything, then start the new version. I watched it with `kubectl get pods --watch` during
the image change:

```
web-recreate-746f97b8f-6jqmr   1/1   Running       0     16s
web-recreate-746f97b8f-8flgx   1/1   Running       0     16s
web-recreate-746f97b8f-qcdzx   1/1   Running       0     16s
web-recreate-746f97b8f-8flgx   1/1   Terminating   0     18s
web-recreate-746f97b8f-6jqmr   1/1   Terminating   0     18s
web-recreate-746f97b8f-qcdzx   1/1   Terminating   0     18s
web-recreate-746f97b8f-qcdzx   0/1   Completed     0     18s
web-recreate-746f97b8f-6jqmr   0/1   Completed     0     18s
web-recreate-746f97b8f-8flgx   0/1   Completed     0     18s
web-recreate-64dc977976-4pscr   0/1   Pending             0     0s
web-recreate-64dc977976-flfcc   0/1   Pending             0     0s
web-recreate-64dc977976-gsk87   0/1   Pending             0     0s
web-recreate-64dc977976-4pscr   0/1   ContainerCreating   0     0s
web-recreate-64dc977976-gsk87   0/1   ContainerCreating   0     0s
web-recreate-64dc977976-flfcc   0/1   ContainerCreating   0     0s
```

**All three go Terminating together, and only after they're all Completed does the first new pod
appear.** That gap is real downtime. Compare with the rolling update above where old and new
overlapped.

First time I tried this the new pods went `ErrImagePull` and the app was down for a few minutes,
which honestly made the point better than a clean run. You use Recreate when the app can't have two
versions running at once - a database schema migration, or something holding an exclusive lock.

### Summary

| strategy | downtime | extra pods needed | rollback speed |
|---|---|---|---|
| Rolling update | none | `maxSurge` worth | fast, scale old RS back |
| Blue-Green | none | 2x for a while | instant, flip a label |
| Canary | none | 1 extra pod | instant, scale canary to 0 |
| Recreate | **yes** | none | needs a full redeploy |

## Task 2 - Pod lifecycle

Six pods in [`05-pod-lifecycle/`](05-pod-lifecycle/), one per thing I wanted to see. Applied them
all at once:

```bash
kubectl apply -f 05-pod-lifecycle/
```

After 10 seconds:

```
lc-crashloop     0/1   Error       1 (7s ago)   10s
lc-failed        0/1   Error       0            10s
lc-init-probes   0/1   Init:0/1    0            10s
lc-pending       0/1   Pending     0            10s
lc-running       1/1   Running     0            10s
lc-succeeded     0/1   Completed   0            10s
```

The actual `.status.phase` of each:

```
NAME             PHASE
lc-running       Running
lc-succeeded     Succeeded
lc-failed        Failed
lc-pending       Pending
lc-crashloop     Running      <- note this one
lc-init-probes   Running
```

### The five phases

**Pending** - accepted but not running yet. Either not scheduled, or still pulling the image.
`lc-pending` asks for 500Gi of memory, so it can never be placed:

```
Events:
  Warning  FailedScheduling  87s (x3 over 94s)  default-scheduler
    0/1 nodes are available: 1 Insufficient memory.
    preemption: 0/1 nodes are available: 1 Preemption is not helpful for scheduling.
```

This is the one case where `kubectl logs` gives you nothing and `describe` gives you everything.

**Running** - bound to a node, at least one container running. `lc-running` is just nginx.

**Succeeded** - all containers exited 0 and won't restart. Needs `restartPolicy: Never`:

```
$ kubectl logs lc-succeeded
doing some work
done
```

A Completed pod still exists and you can still read its logs, which is handy.

**Failed** - all containers terminated and at least one exited non-zero:

```
$ kubectl logs lc-failed
about to fail
```

exit code 1, `reason: Error`.

**Unknown** - the node stopped reporting. Couldn't reproduce this on a single-node minikube.

### restartPolicy is what decides Failed vs CrashLoopBackOff

`lc-failed` and `lc-crashloop` run the *same failing command*. The only difference:

| | `lc-failed` | `lc-crashloop` |
|---|---|---|
| restartPolicy | `Never` | `Always` (the default) |
| phase | `Failed` | `Running` |
| what happens | stops, stays Failed | restarts forever |

That surprised me - **a CrashLoopBackOff pod's phase is `Running`**, not Failed. Because the policy
is Always, Kubernetes still considers the pod to be running; it's the container inside that keeps
dying.

Sampling it over time:

```
lc-crashloop   0/1   Error   4 (53s ago)   100s
lc-crashloop   0/1   Error   4 (61s ago)   108s
lc-crashloop   0/1   Error   4 (69s ago)   116s
lc-crashloop   0/1   Error   4 (77s ago)   2m4s
lc-crashloop   0/1   Error   4 (85s ago)   2m21s
```

Restart count stuck at 4 while the "ago" keeps climbing - that's the **back-off**. The kubelet waits
10s, 20s, 40s, 80s... up to 5 minutes between restarts, so a broken pod doesn't hammer the node.
That's the "BackOff" half of the name.

### Init containers

`lc-init-probes` has an init container that sleeps 10s. For those 10 seconds the status was
`Init:0/1` - the main container hadn't started at all:

```
lc-init-probes   0/1   Init:0/1    0    10s
```
```
$ kubectl logs lc-init-probes -c wait-a-bit
init container running
init done
```

Init containers run **one at a time, to completion, before** any app container. If one fails the
pod restarts. Used for waiting on a database, or fetching config.

### Lifecycle hooks and probes

`postStart` runs right after the container starts. Mine wrote a file, and it was there:

```
$ kubectl exec lc-init-probes -- cat /usr/share/nginx/html/hook.txt
postStart hook ran
```

`preStop` runs before the container gets SIGTERM - the usual use is a sleep so the pod gets removed
from the Service endpoints before it stops accepting connections.

The two probes do different jobs, and mixing them up is a common mistake:

- **readinessProbe** - "can it take traffic?" Fails → pod removed from Service endpoints, but not
  restarted.
- **livenessProbe** - "is it still alive?" Fails → **container is restarted**.

So a slow-starting app with an aggressive livenessProbe gets killed forever in a loop. That's what
`startupProbe` is for.

### Full picture

```
kubectl apply
      ↓
   Pending  ──── scheduler can't place it? stays here
      ↓
  image pull, init containers run in order
      ↓
   Running  ──── postStart hook, then probes start
      ↓
 exit 0 → Succeeded          (restartPolicy: Never)
 exit 1 → Failed             (restartPolicy: Never)
 exit 1 → restart, back-off  (restartPolicy: Always) = CrashLoopBackOff
```

### What I'd actually use day to day

- `kubectl get pods` for the phase, `kubectl describe pod` for the **Events** at the bottom - that's
  where the real reason always is.
- `kubectl logs <pod>` for a running/finished container, `kubectl logs --previous` for the one that
  just crashed. On a CrashLoopBackOff `--previous` is the only way to see why.
- `-c <container>` when there's more than one container or an init container.
