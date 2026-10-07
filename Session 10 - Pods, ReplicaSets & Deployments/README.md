# Session 10 - Pods, ReplicaSets & Deployments

Ashutosh Kumar - 24bcs10111

## Task 1 - Deployment strategies

### 1. Rolling update

[`01-rolling-update/deployment.yml`](01-rolling-update/deployment.yml), 4 replicas:

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1
    maxUnavailable: 1
```

Changed the image and checked the replicasets while it was updating:

```
NAME                     DESIRED   CURRENT   READY   AGE
web-rolling-7b866d8545   3         3         3       49s    <- old going down
web-rolling-85d6f9cf5f   2         2         0       7s     <- new coming up
```

Two replicasets at once. That is how a Deployment works, it does not change pods, it makes a second
replicaset and moves replicas across. 3 + 2 = 5, which is maxSurge 1 above 4.

After:

```
web-rolling-7b866d8545   0   0   0   69s
web-rolling-85d6f9cf5f   4   4   4   27s
```

The old one is kept at 0, not deleted. That is why rollback is instant:

```bash
kubectl rollout undo deployment/web-rolling
```
```
web-rolling-7b866d8545   4   4   4   82s   <- back up
web-rolling-85d6f9cf5f   0   0   0   40s   <- back down
```

Image went back to 1.25-alpine. Nothing was pulled, it just scaled the old one up.

No downtime. This is the default and what you want most of the time.

### 2. Blue-Green

Two full deployments and a Service pointing at one using a label.

Blue up first:

```
$ curl http://myapp/
I am BLUE v1
```

Deployed green next to it. Both running, 6 pods:

```
app-blue    3/3   3   3   4m41s
app-green   3/3   3   3   1s
```

Green is live but gets no traffic, the service still says blue. Then the switch:

```bash
kubectl patch service myapp -p '{"spec":{"selector":{"app":"myapp","version":"green"}}}'
```
```
$ curl http://myapp/
I am GREEN v2
```

Rollback is the same patch backwards and it was instant:

```
$ curl http://myapp/
I am BLUE v1
```

Nothing restarted, only the selector moved. That is the point. The cost is double the pods while
both are up.

### 3. Canary

Same service but the selector is less specific on purpose:

```yaml
selector:
  app: shop        # no 'track' label, matches stable AND canary
```

4 stable pods + 1 canary = 5, so about 20% should hit the canary. The ratio is just the pod count.

25 requests:

```
     17 STABLE v1
      8 CANARY v2
```

Expected 20/5, got 17/8. kube-proxy balances per connection and 25 is a small sample. The idea
still shows.

Promoting is just scaling:

```bash
kubectl scale deployment shop-canary --replicas=4
kubectl scale deployment shop-stable --replicas=0
```
```
$ curl http://shop/
CANARY v2
```

Limit of doing it this way: you cannot do 1% without 100 pods, and you cannot route by header.

### 4. Recreate

```yaml
strategy:
  type: Recreate
```

Watched it with `kubectl get pods --watch`:

```
web-recreate-746f97b8f-8flgx   1/1   Terminating   18s
web-recreate-746f97b8f-6jqmr   1/1   Terminating   18s
web-recreate-746f97b8f-qcdzx   1/1   Terminating   18s
web-recreate-746f97b8f-qcdzx   0/1   Completed     18s
web-recreate-746f97b8f-6jqmr   0/1   Completed     18s
web-recreate-64dc977976-4pscr   0/1   Pending       0s
web-recreate-64dc977976-flfcc   0/1   Pending       0s
```

All three go Terminating together, and only once they are done does the first new pod appear. That
gap is real downtime.

You use this when the app cannot have two versions running at once, like a database migration.

### Summary

| strategy | downtime | extra pods | rollback |
|---|---|---|---|
| Rolling update | no | maxSurge worth | fast |
| Blue-Green | no | 2x for a while | instant |
| Canary | no | 1 extra | instant |
| Recreate | yes | none | full redeploy |

## Task 2 - Pod lifecycle

Six pods in [`05-pod-lifecycle/`](05-pod-lifecycle/), applied together:

```
lc-crashloop     0/1   Error       1 (7s ago)   10s
lc-failed        0/1   Error       0            10s
lc-init-probes   0/1   Init:0/1    0            10s
lc-pending       0/1   Pending     0            10s
lc-running       1/1   Running     0            10s
lc-succeeded     0/1   Completed   0            10s
```

### The five phases

**Pending** - not running yet. `lc-pending` asks for 500Gi so it can never be placed:

```
Warning  FailedScheduling  0/1 nodes are available: 1 Insufficient memory.
```

This is the one case where logs give nothing and describe gives everything.

**Running** - on a node, container running.

**Succeeded** - exited 0, will not restart. Needs `restartPolicy: Never`:

```
$ kubectl logs lc-succeeded
doing some work
done
```

**Failed** - exited non-zero.

**Unknown** - node stopped reporting. Could not reproduce on one node.

### restartPolicy decides Failed vs CrashLoopBackOff

`lc-failed` and `lc-crashloop` run the same failing command:

| | lc-failed | lc-crashloop |
|---|---|---|
| restartPolicy | Never | Always (default) |
| phase | Failed | **Running** |
| what happens | stops | restarts forever |

This surprised me. A CrashLoopBackOff pod's phase is Running, not Failed. The pod is running, it is
the container inside that keeps dying.

Watching it:

```
lc-crashloop   0/1   Error   4 (53s ago)   100s
lc-crashloop   0/1   Error   4 (69s ago)   116s
lc-crashloop   0/1   Error   4 (85s ago)   2m21s
```

Restart count stuck at 4 while the time goes up. That is the back-off - 10s, 20s, 40s up to 5
minutes, so a broken pod does not hammer the node.

### Init containers

Status was `Init:0/1` for 10 seconds, main container had not started:

```
$ kubectl logs lc-init-probes -c wait-a-bit
init container running
init done
```

They run one at a time, finish, then the app containers start. Used for waiting on a database.

### Hooks and probes

postStart wrote a file and it was there:

```
$ kubectl exec lc-init-probes -- cat /usr/share/nginx/html/hook.txt
postStart hook ran
```

The two probes are easy to mix up:

- **readiness** - can it take traffic? Fails, pod removed from the Service, not restarted.
- **liveness** - is it alive? Fails, container is restarted.

A slow starting app with an aggressive liveness probe gets killed over and over. That is what
startupProbe is for.

### Notes

- `describe pod` and read the Events at the bottom, that is where the real reason is.
- `kubectl logs --previous` is the only way to see why a CrashLoopBackOff pod died.
