# Session 14 - Kubernetes Troubleshooting

Ashutosh Kumar - 24bcs10111

## Task 1 - Commands

**`kubectl get`** - what exists and what state it is in. Always the first command.

```bash
kubectl get pods
kubectl get pods -A                  # every namespace
kubectl get pods -l app=web          # by label
kubectl get pods --watch             # live
```

**`kubectl get -o wide`** - adds pod IP and node. Other forms are `-o yaml`, `-o json`, and
`-o jsonpath=...` to pull one field.

**`kubectl describe`** - the most useful one. Full details plus an Events list at the bottom, which
is where the real reason is almost every time.

My rule: `get` tells you *that* something is wrong, `describe` tells you *why*.

**`kubectl logs`**

```bash
kubectl logs <pod>
kubectl logs <pod> -c <container>    # multi-container
kubectl logs -l app=web              # all pods with a label
kubectl logs <pod> --previous        # the container that just died
kubectl logs <pod> -f --tail=50      # follow
```

`--previous` is the one people forget and the only way to see why a CrashLoopBackOff pod died.

**`kubectl exec`**

```bash
kubectl exec <pod> -- cat /etc/resolv.conf
kubectl exec -it <pod> -- sh
```

**`kubectl events`** - cluster-wide instead of one object.

```bash
kubectl events --sort-by=.lastTimestamp
```

**`kubectl explain`** - docs for any field, saves guessing at YAML.

```bash
kubectl explain pod.spec.containers.livenessProbe
```

**`kubectl top`** - real CPU and memory, needs metrics-server.

```
$ kubectl top pods
NAME                          CPU(cores)   MEMORY(bytes)
php-apache-5899f79df5-fhdhr   1m           11Mi
```

## Task 2 - Common issues

### ImagePullBackOff / ErrImagePull

[`broken/imagepullbackoff.yml`](broken/imagepullbackoff.yml) uses a tag that does not exist.

```
NAME           READY   STATUS         RESTARTS   AGE
tb-imagepull   0/1     ErrImagePull   0          41s
```

`logs` gives nothing, the container never started. `describe`:

```
Warning  Failed  Failed to pull image "nginx:this-tag-does-not-exist":
  NotFound: docker.io/library/nginx:this-tag-does-not-exist: not found
```

ErrImagePull is the first failure, ImagePullBackOff is what it becomes once the kubelet starts
backing off between retries. Same problem.

How to tell the causes apart from the message:

| message | cause |
|---|---|
| `not found` | wrong image name or tag |
| `unauthorized` | private registry, missing imagePullSecrets |
| `dial tcp ... i/o timeout` | the node cannot reach the registry |

I hit the third one for real:

```
failed to resolve reference "docker.io/hashicorp/http-echo:1.0": failed to authorize:
dial tcp: lookup auth.docker.io on 1.1.1.1:53: read udp ...: i/o timeout
```

and sometimes:

```
dial tcp [2a06:98c1:3104::6812:2bb2]:443: connect: network is unreachable
```

**Root cause:** the minikube node got IPv6 addresses back from DNS but had no IPv6 route, and
UDP/53 kept timing out. Nothing to do with the image, the same image pulled fine on my host.

**Fix:** pull on the host where DNS worked and load it in:

```bash
docker pull hashicorp/http-echo:1.0
minikube image load hashicorp/http-echo:1.0
```

Worth remembering that ImagePullBackOff often is not about the image.

### CrashLoopBackOff

[`broken/crashloop.yml`](broken/crashloop.yml) starts, prints an error, exits 1.

```
NAME           READY   STATUS   RESTARTS      AGE
tb-crashloop   0/1     Error    2 (40s ago)   41s
```

Here `logs` does work, because the container did start:

```
$ kubectl logs tb-crashloop
FATAL: config file missing
starting up

$ kubectl logs tb-crashloop --previous
FATAL: config file missing
starting up
```

The app itself exits non-zero. Kubernetes is doing its job, the application is broken.

The RESTARTS count climbing with a growing gap is the back-off - 10s, 20s, 40s up to 5 minutes.

Usual real causes: missing config or env var, cannot reach its database, bad command in the
Dockerfile, or a liveness probe that is too aggressive.

### CreateContainerConfigError

From Session 12 - a ConfigMap key that does not exist:

```
broken-app-5f48f7cf55-567rj   0/1   CreateContainerConfigError   0   26s
```
```
Error: couldn't find key DOES_NOT_EXIST in ConfigMap default/app-config
```

Different from CrashLoopBackOff. The container never started because the kubelet could not build
its config. Always a missing ConfigMap or Secret reference.

### Pending

```
lc-pending   0/1   Pending   0   10s
```
```
Warning  FailedScheduling  default-scheduler
  0/1 nodes are available: 1 Insufficient memory.
```

The pod asked for 500Gi. No node can give that, so it is never placed.

The scheduler always says exactly why. Other versions are `Insufficient cpu`,
`node(s) had untolerated taint`, `didn't match node selector`.

A PVC stuck Pending with no StorageClass keeps its pod Pending too.

### ContainerCreating

Normal and temporary - pulling the image, mounting volumes, setting up networking. Only a problem
if it is stuck there, then describe shows a mount or CNI failure.

### Service connectivity

The most common one, and it looks like DNS but is not:

```
$ kubectl get endpoints broken-svc
NAME         ENDPOINTS   AGE
broken-svc   <none>      25s
```
```
svc selector: {"app":"brokenapp"}
pod labels  : {"app":"broken-app","pod-template-hash":"5f48f7cf55"}
```

Selector does not match the labels, a missing dash.

**Empty endpoints is the first thing to check** on any "my service does not work". Other reasons
endpoints are empty: pods failing readiness (a not-ready pod is deliberately removed), or no pods
at all.

If endpoints are fine but connections hang or refuse, it is the **port**. I hit that twice:

- Session 12 - `targetPort: 9999` but the container listens on 8080. No error anywhere.
- Session 11 - a headless service resolved fine but refused on port 80, because headless gives pod
  IPs with no kube-proxy, so the 80 to 8080 mapping does not happen.

### DNS

```bash
kubectl exec <pod> -- cat /etc/resolv.conf
kubectl exec <pod> -- nslookup kubernetes.default.svc.cluster.local
kubectl get pods -n kube-system -l k8s-app=kube-dns
```

`kubernetes.default` always exists, so if that resolves DNS is fine and your service name is wrong,
usually a missing namespace.

If external lookups are slow rather than broken, that is `ndots:5`.

### Pod networking

```bash
kubectl get nodes                 # NotReady usually means CNI down
kubectl get pods -n kube-system   # is the CNI pod running
```

I hit this on my very first `get nodes` - the node sat NotReady until kindnet came up.

### Configuration

Catch these before applying:

```bash
kubectl apply -f app.yml --dry-run=server     # validates against the API
kubectl explain <resource>.<field>
```

Server dry-run catches a bad field name or wrong apiVersion without creating anything.

## The order I work in

```
kubectl get pods              what state
      |
kubectl describe pod          read the Events
      |
container started?
   no  -> describe is the answer (image, scheduling, config)
   yes -> kubectl logs, and --previous if it restarted
      |
app up but unreachable?
      |
kubectl get endpoints <svc>   empty -> selector or readiness
                              full  -> check the port, then DNS
```

| status | started? | where the answer is | usual cause |
|---|---|---|---|
| Pending | no | describe Events | no node fits |
| ContainerCreating | no | describe Events | pulling, or volume |
| ErrImagePull | no | describe Events | bad tag, auth, networking |
| CreateContainerConfigError | no | describe Events | missing ConfigMap/Secret key |
| CrashLoopBackOff | **yes** | `logs --previous` | app exits non-zero |
| Running but 0/1 | yes | describe Events | readiness failing |
| Running but unreachable | yes | `get endpoints` | selector or port |

The main split: **container never started, use describe. Started and died, use logs --previous.**
Running `kubectl logs` on an ImagePullBackOff pod and getting nothing confused me for a while -
there are no logs because there was never a container.

## Task 3 - Mini project

The real troubleshooting in this repo is spread across the sessions where it happened, because real
bugs are more useful than invented ones:

| problem | where | root cause |
|---|---|---|
| 3 bugs in one manifest | Session 12 | bad ConfigMap key, selector typo, wrong targetPort |
| cluster-wide ImagePullBackOff | this session | node DNS giving IPv6 with no IPv6 route |
| RunContainerError on every pod | Kubernetes Fundamentals | Git Bash rewrote `/agnhost` into a Windows path |
| node stuck NotReady | Kubernetes Fundamentals | CNI pod had not started |
| HPA stuck at `<unknown>` | Session 13 | metrics-server had not scraped yet |
| HPA would not scale down for 6 min | Session 13 | 300s stabilization window, working as designed |

The last two are the ones I would have wasted most time on, because nothing is actually broken -
you just have to know the timing.
