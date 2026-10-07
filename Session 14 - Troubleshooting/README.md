# Session 14 - Kubernetes Troubleshooting

**Ashutosh Kumar** · **24bcs10111**

## Task 1 - Troubleshooting commands

### `kubectl get`

The first command, always. What exists and what state is it in.

```bash
kubectl get pods
kubectl get pods -A                  # every namespace
kubectl get pods -l app=web          # by label
kubectl get deploy,svc,ingress       # several types at once
kubectl get pods --watch             # live updates
```

### `kubectl get -o wide`

Adds the pod IP and which node it's on. Needed whenever the problem might be node-specific:

```
NAME       STATUS   ROLES           VERSION   INTERNAL-IP    CONTAINER-RUNTIME
minikube   Ready    control-plane   v1.37.0   192.168.49.2   containerd://2.3.4
```

Other output forms: `-o yaml` (the full object), `-o json`, and `-o jsonpath=...` to pull one field:

```bash
kubectl get deployment demo -o jsonpath='{.spec.template.spec.containers[0].image}'
```

### `kubectl describe`

The most useful one. Full object detail plus an **Events** list at the bottom, which is where the
actual reason lives almost every time.

```bash
kubectl describe pod <name>
kubectl describe node minikube
```

Rule I settled on: `get` tells you *that* something is wrong, `describe` tells you *why*.

### `kubectl logs`

```bash
kubectl logs <pod>
kubectl logs <pod> -c <container>    # multi-container pod
kubectl logs -l app=web              # all pods with a label
kubectl logs <pod> --previous        # the container that just died
kubectl logs <pod> -f --tail=50      # follow
```

`--previous` is the one people forget, and it's the only way to see why a CrashLoopBackOff pod died.

### `kubectl exec`

```bash
kubectl exec <pod> -- cat /etc/resolv.conf
kubectl exec -it <pod> -- sh
```

Used it all session for DNS and connectivity checks from inside the cluster.

### `kubectl events`

```bash
kubectl events --sort-by=.lastTimestamp
kubectl get events -A --sort-by=.lastTimestamp
```

Cluster-wide events rather than one object's. Good for "something broke a minute ago, what was it".

### `kubectl explain`

Built-in docs for any field. Saves guessing at YAML:

```bash
kubectl explain pod.spec.containers.livenessProbe
kubectl explain deployment.spec.strategy --recursive
```

### `kubectl top`

Actual CPU/memory. Needs metrics-server.

```
$ kubectl top pods
NAME                          CPU(cores)   MEMORY(bytes)
php-apache-5899f79df5-fhdhr   1m           11Mi
```

## Task 2 - Common issues

Manifests that break on purpose are in [`broken/`](broken/).

### ImagePullBackOff / ErrImagePull

[`broken/imagepullbackoff.yml`](broken/imagepullbackoff.yml) - a tag that doesn't exist.

```
NAME           READY   STATUS         RESTARTS   AGE
tb-imagepull   0/1     ErrImagePull   0          41s
```

**Investigate** - `logs` gives nothing (no container ever started), so `describe`:

```
Warning  Failed  kubelet  Failed to pull image "nginx:this-tag-does-not-exist":
  rpc error: code = NotFound desc = failed to pull and unpack image
  "docker.io/library/nginx:this-tag-does-not-exist": not found
Warning  Failed  kubelet  Error: ErrImagePull
Warning  Failed  kubelet  Error: ImagePullBackOff
```

**Root cause** - the tag doesn't exist in the registry.

`ErrImagePull` is the first failure; `ImagePullBackOff` is what it becomes once the kubelet starts
backing off between retries. Same problem, different stage.

**Causes, and how to tell them apart from the message:**

| message | cause |
|---|---|
| `not found` | wrong image name or tag |
| `unauthorized` / `authentication required` | private registry, missing `imagePullSecrets` |
| `dial tcp ... i/o timeout` | the node can't reach the registry - network/DNS |

I hit the third one for real earlier in this course. Pulls kept failing with:

```
failed to resolve reference "docker.io/hashicorp/http-echo:1.0": failed to authorize:
failed to fetch anonymous token: Get "https://auth.docker.io/token?...":
dial tcp: lookup auth.docker.io on 1.1.1.1:53: read udp ...: i/o timeout
```

and sometimes:

```
dial tcp [2a06:98c1:3104::6812:2bb2]:443: connect: network is unreachable
```

**Root cause:** the minikube node was getting IPv6 addresses back from DNS but had no IPv6 route,
and UDP/53 to the upstream resolver kept timing out. Nothing to do with the image at all - the same
image pulled fine on my host.

**Fix:** pull on the host where DNS worked, then side-load into the cluster:

```bash
docker pull hashicorp/http-echo:1.0
minikube image load hashicorp/http-echo:1.0
```

Worth remembering that "ImagePullBackOff" often isn't about the image.

### CrashLoopBackOff

[`broken/crashloop.yml`](broken/crashloop.yml) - starts, prints an error, exits 1.

```
NAME           READY   STATUS   RESTARTS      AGE
tb-crashloop   0/1     Error    2 (40s ago)   41s
```

**Investigate** - here `logs` *does* work, because the container did start:

```
$ kubectl logs tb-crashloop
FATAL: config file missing
starting up

$ kubectl logs tb-crashloop --previous
FATAL: config file missing
starting up
```

**Root cause** - the app itself exits non-zero. Kubernetes is doing its job; the application is
broken.

The `RESTARTS` column climbing with an increasing gap is the back-off - 10s, 20s, 40s, up to 5
minutes. In Session 10 I watched the restart count sit at 4 while the "ago" kept growing, which is
exactly that.

Common real causes: missing config/env var, can't reach its database, bad command in the Dockerfile,
or a liveness probe that's too aggressive for a slow-starting app.

### CreateContainerConfigError

Covered in Session 12 - a ConfigMap key that doesn't exist:

```
NAME                          READY   STATUS                       RESTARTS   AGE
broken-app-5f48f7cf55-567rj   0/1     CreateContainerConfigError   0          26s
```
```
Error: couldn't find key DOES_NOT_EXIST in ConfigMap default/app-config
```

Distinct from CrashLoopBackOff - the container never started, because the kubelet couldn't build its
config. Always a missing/misnamed ConfigMap or Secret reference.

### Pending

```
NAME         READY   STATUS    RESTARTS   AGE
lc-pending   0/1     Pending   0          10s
```
```
Events:
  Warning  FailedScheduling  default-scheduler
    0/1 nodes are available: 1 Insufficient memory.
    preemption: 0/1 nodes are available: 1 Preemption is not helpful for scheduling.
```

**Root cause** - the pod requested 500Gi of memory. No node can satisfy it, so the scheduler never
places it.

The scheduler always says exactly why in that message. Other versions: `Insufficient cpu`,
`node(s) had untolerated taint`, `didn't match node selector`, `had volume node affinity conflict`.

Also: a PVC stuck `Pending` with no StorageClass will keep its pod Pending too.

### ContainerCreating

A normal transient state - pulling the image, mounting volumes, attaching network. I saw it on
every single pod creation.

It's only a problem if it's **stuck** there. Then `describe` shows a mount or CNI failure -
typically a volume that can't attach, or a Secret/ConfigMap named in a volume that doesn't exist.

### Service connectivity issues

The single most common one, and it looks like a DNS problem but isn't:

```
$ kubectl get endpoints broken-svc
NAME         ENDPOINTS   AGE
broken-svc   <none>      25s
```

```
svc selector: {"app":"brokenapp"}
pod labels  : {"app":"broken-app","pod-template-hash":"5f48f7cf55"}
```

**Root cause** - selector doesn't match the labels. A missing dash.

**Empty endpoints is the first thing to check** on any "my service doesn't work" report. Other
reasons endpoints end up empty: pods failing their readiness probe (a not-ready pod is deliberately
removed from endpoints), or no pods at all.

Second variant: endpoints are fine but connections hang/refuse. Then it's the **port**. Seen twice:

- Session 12: `targetPort: 9999` but the container listens on 8080. No error anywhere, it just
  doesn't work.
- Session 11: a headless service resolved perfectly but refused on port 80, because headless hands
  back pod IPs with no kube-proxy in the path, so the 80→8080 mapping doesn't happen.

### DNS issues

```bash
kubectl exec <pod> -- cat /etc/resolv.conf
kubectl exec <pod> -- nslookup kubernetes.default.svc.cluster.local
kubectl get pods -n kube-system -l k8s-app=kube-dns
```

A healthy pod's resolv.conf:

```
search default.svc.cluster.local svc.cluster.local cluster.local
nameserver 10.96.0.10
options ndots:5
```

`kubernetes.default` always exists, so if that resolves, DNS is fine and your service name is wrong
(usually a missing namespace - the short name only works in the same namespace).

If external lookups are *slow* rather than broken, that's `ndots:5` - every short external name
gets tried against three search domains first.

### Pod networking issues

```bash
kubectl get nodes                       # NotReady = CNI probably down
kubectl get pods -n kube-system         # is the CNI pod running
kubectl exec <pod> -- ping <pod-ip>
```

I hit this on the very first `get nodes` - the node sat `NotReady` until `kindnet` (the CNI) came
up. A node stays NotReady until networking is ready, so "NotReady node" usually means "check the
CNI pod" rather than anything about the node itself.

### Configuration issues

Catch these before applying:

```bash
kubectl apply -f app.yml --dry-run=server     # validates against the API
kubectl explain <resource>.<field>            # check a field actually exists
```

Server-side dry-run catches a bad field name or wrong apiVersion without creating anything.

## The order I'd actually work in

```
kubectl get pods              what state is it in
      ↓
kubectl describe pod          read the Events at the bottom
      ↓
container started?
   no  → describe is the answer (image, scheduling, config)
   yes → kubectl logs, and --previous if it restarted
      ↓
app is up but unreachable?
      ↓
kubectl get endpoints <svc>   empty → selector/labels or readiness
                              full  → check the port, then DNS
```

### Quick reference

| status | container started? | where the answer is | usual cause |
|---|---|---|---|
| `Pending` | no | `describe` Events | no node fits it |
| `ContainerCreating` | no | `describe` Events | pulling, or a volume won't mount |
| `ErrImagePull` / `ImagePullBackOff` | no | `describe` Events | bad tag, auth, or node networking |
| `CreateContainerConfigError` | no | `describe` Events | missing ConfigMap/Secret key |
| `CrashLoopBackOff` | **yes** | `logs --previous` | app exits non-zero |
| `Running` but 0/1 | yes | `describe` Events | readiness probe failing |
| `Running` but unreachable | yes | `get endpoints` | selector or port mismatch |

The single most useful split: **if the container never started, use `describe`. If it started and
died, use `logs --previous`.** Running `kubectl logs` on a pod stuck in ImagePullBackOff and getting
nothing back confused me for a while - there are no logs because there was never a container.

## Task 3 - Mini project

The troubleshooting work in this repo is spread across the sessions where it actually happened,
because real bugs are more useful than invented ones:

| problem | where | root cause |
|---|---|---|
| 3 bugs in one manifest | [Session 12](../Session%2012%20-%20Ingress,%20ConfigMaps%20&%20Secrets/#task-5---troubleshooting) | bad ConfigMap key, selector typo, wrong targetPort |
| ImagePullBackOff across the whole cluster | this session | node DNS returning IPv6 with no IPv6 route |
| `RunContainerError` on every pod | [Kubernetes Fundamentals](../Kubernetes%20Fundamentals/) | Git Bash rewrote `/agnhost` into a Windows path |
| node stuck `NotReady` | [Kubernetes Fundamentals](../Kubernetes%20Fundamentals/) | CNI pod hadn't started yet |
| HPA stuck at `<unknown>` | [Session 13](../Session%2013%20-%20Storage,%20HPA%20&%20Probes/) | metrics-server hadn't scraped yet |
| HPA wouldn't scale down for 6 min | [Session 13](../Session%2013%20-%20Storage,%20HPA%20&%20Probes/) | 300s scale-down stabilization window, working as designed |

The last two are the ones I'd have wasted the most time on, because nothing is actually broken -
you just have to know the system's timing.
