# Session 12 - Kubernetes Ingress, ConfigMaps & Secrets

**Ashutosh Kumar** · **24bcs10111**

## Task 1 - ConfigMap

[`configmap/configmap.yml`](configmap/configmap.yml) holds three plain values and one whole file:

```yaml
data:
  APP_NAME: "my-demo-app"
  APP_ENV: "development"
  LOG_LEVEL: "debug"
  app.properties: |
    server.port=8080
    server.timeout=30
```

```bash
kubectl apply -f configmap/
kubectl describe configmap app-config
```

```
Name:         app-config
Namespace:    default

Data
====
APP_ENV:
----
development
APP_NAME:
----
my-demo-app
LOG_LEVEL:
----
debug
app.properties:
----
server.port=8080
server.timeout=30
```

### Injecting it into a pod

[`configmap/pod.yml`](configmap/pod.yml) uses all three ways at once:

```yaml
env:
  - name: APP_NAME               # 1. one specific key
    valueFrom:
      configMapKeyRef:
        name: app-config
        key: APP_NAME
envFrom:
  - configMapRef:                # 2. every key as an env var
      name: app-config
volumeMounts:
  - name: config-volume          # 3. as files on disk
    mountPath: /config
```

### Verified inside the container

```bash
kubectl logs configmap-demo
```

```
--- env vars ---
LOG_LEVEL=debug
APP_NAME=my-demo-app
APP_ENV=development
--- mounted file ---
server.port=8080
server.timeout=30
```

All three keys arrived as env vars from `envFrom`, and `app.properties` became a real file at
`/config/app.properties`.

### The interesting bit - what happens on an update

I changed the ConfigMap while the pod was running:

```bash
kubectl patch configmap app-config --type merge \
  -p '{"data":{"app.properties":"server.port=9090\nserver.timeout=60\n","LOG_LEVEL":"info"}}'
```

Waited ~75 seconds, then checked both:

```
$ kubectl exec configmap-demo -- cat /config/app.properties
server.port=9090
server.timeout=60

$ kubectl exec configmap-demo -- sh -c 'echo LOG_LEVEL=$LOG_LEVEL'
LOG_LEVEL=debug
```

**The mounted file updated. The env var did not.**

That's a genuinely important difference I didn't expect. Env vars are set once when the container
starts and can never change - the only way to pick up a new value is to restart the pod. Mounted
files get re-synced by the kubelet (roughly every minute).

So if you want config reloads without a restart, mount it as a volume *and* have the app watch the
file. Otherwise you need:

```bash
kubectl rollout restart deployment/<name>
```

## Task 2 - Secret

[`secret/secret.yml`](secret/secret.yml). I used `stringData` so I could write plain text and let
Kubernetes do the base64:

```yaml
type: Opaque
stringData:
  DB_USER: "admin"
  DB_PASSWORD: "sup3rs3cret"
  API_KEY: "ak_live_12345"
```

### Injected the same two ways

```
$ kubectl logs secret-demo
--- from env ---
DB_USER=admin
--- from file ---
sup3rs3cret
```

### Why Secrets must not be committed to Git

This is the part the task asks to understand, and it's easy to show.

`kubectl get` hides the values:

```
NAME         TYPE     DATA   AGE
app-secret   Opaque   3      0s
```

`describe` also hides them - it only gives sizes:

```
Data
====
API_KEY:      13 bytes
DB_PASSWORD:  11 bytes
DB_USER:      5 bytes
```

That makes it *feel* protected. It isn't:

```
$ kubectl get secret app-secret -o jsonpath='{.data.DB_PASSWORD}'
c3VwM3JzM2NyZXQ=

$ kubectl get secret app-secret -o jsonpath='{.data.DB_PASSWORD}' | base64 -d
sup3rs3cret
```

**base64 is encoding, not encryption.** There's no key and no password - anyone with the file can
reverse it in one command. A secret YAML in a Git repo is a plaintext password in a Git repo, and
git history keeps it forever even after you "remove" it.

What to do instead:

- never commit the Secret manifest - keep it out with `.gitignore`
- Sealed Secrets or SOPS, which commit an *encrypted* file that only the cluster can decrypt
- an external store - AWS Secrets Manager, Vault - pulled in by the External Secrets Operator
- enable **encryption at rest** in etcd, because by default secrets are stored unencrypted there too
- RBAC, since anyone who can `get secrets` in a namespace can read all of them

This is also exactly why Session 17 has a secret-scanning step in the pipeline - to catch it when
somebody does it by accident.

### ConfigMap vs Secret

Almost the same object. Differences:

| | ConfigMap | Secret |
|---|---|---|
| values | plain text | base64 |
| shown by `describe` | yes | no, sizes only |
| in etcd | plain | plain unless encryption at rest is on |
| volume mount | normal file | `tmpfs`, kept in memory |
| size limit | 1MB | 1MB |

The `tmpfs` bit is real - a mounted secret never touches the node's disk.

## Task 3 - Ingress

Two apps, two Services, one Ingress ([`ingress/`](ingress/)).

```
NAME           CLASS   HOSTS                  ADDRESS        PORTS   AGE
demo-ingress   nginx   demo.local,two.local   192.168.49.2   80      11s
```

```bash
kubectl describe ingress demo-ingress
```

```
Rules:
  Host        Path  Backends
  ----        ----  --------
  demo.local
              /one   app-one:80 (10.244.0.83:8080,10.244.0.84:8080)
              /two   app-two:80 (10.244.0.85:8080,10.244.0.86:8080)
  two.local
              /   app-two:80 (10.244.0.85:8080,10.244.0.86:8080)
```

The backends list real pod IPs, which is how you know the Services are wired correctly.

### Testing the routing

`demo.local` isn't a real DNS name, so I sent the `Host` header by hand from inside the node:

```bash
minikube ssh "curl -s -H 'Host: demo.local' http://localhost:32739/one"
```

| request | response |
|---|---|
| `Host: demo.local` `/one` | `this is APP ONE` |
| `Host: demo.local` `/two` | `this is APP TWO` |
| `Host: two.local` `/` | `this is APP TWO` |
| `Host: nope.local` `/` | `404` |

Same IP, same port, different app - decided purely by Host header and path. The 404 on an unknown
host proves the controller is matching rules rather than just forwarding everything.

**Why this matters:** in Session 11, each LoadBalancer Service would be its own cloud load balancer
with its own bill and its own IP. Here two apps share one entry point.

## Task 4 - Ingress vs Ingress Controller

### What is Ingress?

An API object. A set of routing rules - "host X path Y goes to service Z". That's all it is: data.

By itself an Ingress **does nothing**. You can create one in a cluster with no controller and it
will sit there with an empty ADDRESS forever.

### What is an Ingress Controller?

The program that reads those rules and actually serves traffic. It's a real pod running a real
proxy - nginx, Traefik, HAProxy, Envoy.

In my cluster, enabled with `minikube addons enable ingress`:

```
$ kubectl get pods -n ingress-nginx
NAME                                       READY   STATUS      RESTARTS   AGE
ingress-nginx-controller-d7cd8c989-tx8qf   1/1     Running     0          35m
```

What it does in a loop:

1. watches the API server for Ingress objects
2. converts the rules into an nginx config
3. reloads nginx
4. receives the actual HTTP requests and proxies them to pod IPs

### The difference

| | Ingress | Ingress Controller |
|---|---|---|
| what | a YAML object, rules | a running pod, a proxy |
| ships with Kubernetes? | yes, the API type | **no, you install one** |
| how many | many, one per app/team | usually one per cluster |
| handles traffic? | no | yes, all of it |

Short version: **Ingress is the config file, the controller is the web server reading it.**

### Why both are required

Splitting them is deliberate. The Ingress object is a standard API, so an app team writes the same
YAML whether the platform team runs nginx, Traefik or an AWS ALB. Swapping the controller doesn't
change any app's manifests.

That's also why `ingressClassName: nginx` exists - with more than one controller installed, the
class says which one should pick up this Ingress. Forgetting it is a classic reason an Ingress
quietly does nothing.

### Examples

Controllers: ingress-nginx (what I used), Traefik (default in k3s), HAProxy, AWS ALB Controller,
GKE's built-in one.

The common mistake: writing a perfect Ingress on a cluster with no controller installed, then
wondering why ADDRESS stays empty. Nothing is reading it.

## Task 5 - Troubleshooting

[`troubleshooting/01-broken.yml`](troubleshooting/01-broken.yml) has **three** bugs planted in it.
I applied it without looking and debugged from the output.

### 1. Identify the problem

```bash
kubectl apply -f troubleshooting/01-broken.yml
kubectl get pods -l app=broken-app
```

```
NAME                          READY   STATUS                       RESTARTS   AGE
broken-app-5f48f7cf55-567rj   0/1     CreateContainerConfigError   0          26s
broken-app-5f48f7cf55-5xcmc   0/1     CreateContainerConfigError   0          25s
```

Not a crash, not an image problem - something about the container *config*.

### 2. Run troubleshooting commands

`kubectl logs` was useless here - the container never started, so there are no logs. `describe` had
the answer in the Events:

```bash
kubectl describe pod -l app=broken-app
```

```
State:          Waiting
  Reason:       CreateContainerConfigError
...
Warning  Failed  10s (x3 over 25s)  kubelet
  Error: couldn't find key DOES_NOT_EXIST in ConfigMap default/app-config
```

**Root cause 1:** the pod referenced a ConfigMap key that doesn't exist.

Then the Service:

```bash
kubectl get endpoints broken-svc
```
```
NAME         ENDPOINTS   AGE
broken-svc   <none>      25s
```

Empty. Compared the selector with the actual labels:

```
svc selector: {"app":"brokenapp"}
pod labels  : {"app":"broken-app","pod-template-hash":"5f48f7cf55"}
```

**Root cause 2:** `brokenapp` vs `broken-app` - a missing dash. Labels are exact strings, so it
matched nothing.

**Root cause 3:** reading the YAML, `targetPort: 9999` but the container listens on 8080. This one
produces no error at all - endpoints would populate and connections would just hang.

### 3. Fix it

[`troubleshooting/02-fixed.yml`](troubleshooting/02-fixed.yml):

| bug | before | after |
|---|---|---|
| 1 | `key: DOES_NOT_EXIST` | `key: APP_NAME` |
| 2 | `app: brokenapp` | `app: broken-app` |
| 3 | `targetPort: 9999` | `targetPort: 8080` |

### 4. Before / after

**Before:**
```
NAME                          READY   STATUS                       RESTARTS   AGE
broken-app-5f48f7cf55-567rj   0/1     CreateContainerConfigError   0          26s
broken-app-5f48f7cf55-5xcmc   0/1     CreateContainerConfigError   0          25s

NAME         ENDPOINTS   AGE
broken-svc   <none>      25s
```

**After:**
```
$ kubectl apply -f troubleshooting/02-fixed.yml
deployment.apps/broken-app configured
service/broken-svc configured
deployment "broken-app" successfully rolled out

NAME                          READY   STATUS        RESTARTS   AGE
broken-app-5f48f7cf55-5xcmc   0/1     Terminating   0          34s
broken-app-cb9c94f9f-8csn6    1/1     Running       0          1s
broken-app-cb9c94f9f-fm29q    1/1     Running       0          2s

NAME         ENDPOINTS                           AGE
broken-svc   10.244.0.89:8080,10.244.0.90:8080   34s
```

And actually serving:

```
$ kubectl run tester --image=busybox:1.36 --rm -i --restart=Never -- wget -qO- http://broken-svc/
broken app works now
```

### What I took away

- `CreateContainerConfigError` always means a missing ConfigMap/Secret reference. It's distinct from
  `CrashLoopBackOff` (app started and died) and `ImagePullBackOff` (couldn't get the image).
- `kubectl logs` gives nothing when the container never started. `describe` and its Events do.
- **Empty endpoints = selector doesn't match labels.** First thing to check on any "service not
  working" report.
- The port bug is the nastiest of the three because nothing reports an error - you only find it by
  comparing the Service to what the container actually listens on. Same class of mistake as the
  headless-service port issue in Session 11.
