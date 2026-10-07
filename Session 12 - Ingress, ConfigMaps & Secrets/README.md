# Session 12 - Ingress, ConfigMaps & Secrets

Ashutosh Kumar - 24bcs10111

## Task 1 - ConfigMap

[`configmap/configmap.yml`](configmap/configmap.yml) has three plain values and one whole file:

```yaml
data:
  APP_NAME: "my-demo-app"
  APP_ENV: "development"
  LOG_LEVEL: "debug"
  app.properties: |
    server.port=8080
    server.timeout=30
```

[`configmap/pod.yml`](configmap/pod.yml) uses all three ways of getting it in:

```yaml
env:
  - name: APP_NAME               # 1. one key
    valueFrom:
      configMapKeyRef: { name: app-config, key: APP_NAME }
envFrom:
  - configMapRef: { name: app-config }    # 2. every key as env vars
volumeMounts:
  - name: config-volume                    # 3. as files
    mountPath: /config
```

Inside the container:

```
$ kubectl logs configmap-demo
--- env vars ---
LOG_LEVEL=debug
APP_NAME=my-demo-app
APP_ENV=development
--- mounted file ---
server.port=8080
server.timeout=30
```

### What happens on an update

I changed the ConfigMap while the pod was running, waited 75 seconds, then checked both:

```
$ kubectl exec configmap-demo -- cat /config/app.properties
server.port=9090
server.timeout=60

$ kubectl exec configmap-demo -- sh -c 'echo LOG_LEVEL=$LOG_LEVEL'
LOG_LEVEL=debug
```

**The file updated. The env var did not.**

I did not expect that. Env vars are set once when the container starts and can never change. Files
get re-synced by the kubelet about every minute.

So if you want config reloads without a restart, mount it as a volume. Otherwise you need
`kubectl rollout restart deployment/<name>`.

## Task 2 - Secret

[`secret/secret.yml`](secret/secret.yml) uses `stringData` so I write plain text and Kubernetes
does the base64:

```yaml
stringData:
  DB_USER: "admin"
  DB_PASSWORD: "sup3rs3cret"
  API_KEY: "ak_live_12345"
```

```
$ kubectl logs secret-demo
--- from env ---
DB_USER=admin
--- from file ---
sup3rs3cret
```

### Why Secrets must not go in Git

`kubectl get` hides the values:

```
NAME         TYPE     DATA   AGE
app-secret   Opaque   3      0s
```

`describe` also hides them, it only shows sizes:

```
API_KEY:      13 bytes
DB_PASSWORD:  11 bytes
DB_USER:      5 bytes
```

That makes it feel protected. It is not:

```
$ kubectl get secret app-secret -o jsonpath='{.data.DB_PASSWORD}'
c3VwM3JzM2NyZXQ=

$ kubectl get secret app-secret -o jsonpath='{.data.DB_PASSWORD}' | base64 -d
sup3rs3cret
```

base64 is encoding, not encryption. No key, no password, anyone with the file can reverse it in one
command. A Secret YAML in Git is a plaintext password in Git, and git history keeps it forever even
after you remove it.

What to do instead:

- gitignore the Secret file
- Sealed Secrets or SOPS, which commit an encrypted file only the cluster can decrypt
- an external store like AWS Secrets Manager or Vault
- turn on encryption at rest, because secrets are stored unencrypted in etcd by default
- RBAC, since anyone who can `get secrets` can read all of them

This is why Session 17 has a secret scanning step.

### ConfigMap vs Secret

| | ConfigMap | Secret |
|---|---|---|
| values | plain text | base64 |
| shown by describe | yes | no, sizes only |
| in etcd | plain | plain unless encryption is on |
| volume mount | normal file | tmpfs, kept in memory |

The tmpfs part is real, a mounted secret never touches the node's disk.

## Task 3 - Ingress

Two apps, two Services, one Ingress.

```
NAME           CLASS   HOSTS                  ADDRESS        PORTS
demo-ingress   nginx   demo.local,two.local   192.168.49.2   80
```

```
Rules:
  Host        Path  Backends
  demo.local
              /one   app-one:80 (10.244.0.83:8080,10.244.0.84:8080)
              /two   app-two:80 (10.244.0.85:8080,10.244.0.86:8080)
  two.local
              /   app-two:80 (10.244.0.85:8080,10.244.0.86:8080)
```

The backends show real pod IPs, which means the Services are wired up right.

`demo.local` is not a real DNS name so I sent the Host header by hand:

```bash
minikube ssh "curl -s -H 'Host: demo.local' http://localhost:32739/one"
```

| request | response |
|---|---|
| `Host: demo.local` `/one` | this is APP ONE |
| `Host: demo.local` `/two` | this is APP TWO |
| `Host: two.local` `/` | this is APP TWO |
| `Host: nope.local` `/` | 404 |

Same IP, same port, different app, decided by Host header and path. The 404 shows it is actually
matching rules rather than forwarding everything.

In Session 11 each LoadBalancer Service would be its own cloud load balancer with its own bill.
Here two apps share one entry point.

## Task 4 - Ingress vs Ingress Controller

**Ingress** is an API object. A set of rules saying "host X path Y goes to service Z". That is all
it is, just data. By itself it does nothing - create one in a cluster with no controller and it
sits there with an empty ADDRESS forever.

**Ingress Controller** is the program that reads those rules and serves the traffic. It is a real
pod running a real proxy like nginx or Traefik.

```
$ kubectl get pods -n ingress-nginx
NAME                                       READY   STATUS    AGE
ingress-nginx-controller-d7cd8c989-tx8qf   1/1     Running   35m
```

It loops: watch the apiserver for Ingress objects, turn them into an nginx config, reload, proxy
the requests.

| | Ingress | Controller |
|---|---|---|
| what | YAML rules | a running proxy pod |
| ships with Kubernetes? | the API type, yes | **no, you install one** |
| how many | many | usually one per cluster |
| handles traffic | no | yes |

Short version: **Ingress is the config file, the controller is the web server reading it.**

Splitting them is deliberate. An app team writes the same YAML whether the platform runs nginx,
Traefik or an AWS ALB. Swapping the controller does not change any app's manifests.

That is also why `ingressClassName: nginx` exists. With more than one controller the class says
which should pick it up. Forgetting it is a classic reason an Ingress quietly does nothing.

The common mistake is writing a perfect Ingress on a cluster with no controller and wondering why
ADDRESS stays empty. Nothing is reading it.

## Task 5 - Troubleshooting

[`troubleshooting/01-broken.yml`](troubleshooting/01-broken.yml) has three bugs in it. I applied it
without looking and debugged from the output.

### Find the problem

```
NAME                          READY   STATUS                       RESTARTS   AGE
broken-app-5f48f7cf55-567rj   0/1     CreateContainerConfigError   0          26s
broken-app-5f48f7cf55-5xcmc   0/1     CreateContainerConfigError   0          25s
```

Not a crash, not an image problem. Something about the config.

`kubectl logs` was useless, the container never started. `describe` had it:

```
Warning  Failed  kubelet
  Error: couldn't find key DOES_NOT_EXIST in ConfigMap default/app-config
```

**Bug 1:** referenced a ConfigMap key that does not exist.

Then the Service:

```
$ kubectl get endpoints broken-svc
NAME         ENDPOINTS   AGE
broken-svc   <none>      25s
```

Empty. Compared the selector with the labels:

```
svc selector: {"app":"brokenapp"}
pod labels  : {"app":"broken-app","pod-template-hash":"5f48f7cf55"}
```

**Bug 2:** `brokenapp` vs `broken-app`, a missing dash. Labels are exact strings.

**Bug 3:** reading the YAML, `targetPort: 9999` but the container listens on 8080. This one gives
no error at all, endpoints would fill and connections would just hang.

### Fix

| bug | before | after |
|---|---|---|
| 1 | `key: DOES_NOT_EXIST` | `key: APP_NAME` |
| 2 | `app: brokenapp` | `app: broken-app` |
| 3 | `targetPort: 9999` | `targetPort: 8080` |

### After

```
$ kubectl apply -f troubleshooting/02-fixed.yml
deployment "broken-app" successfully rolled out

NAME                          READY   STATUS    AGE
broken-app-cb9c94f9f-8csn6    1/1     Running   1s
broken-app-cb9c94f9f-fm29q    1/1     Running   2s

NAME         ENDPOINTS                           AGE
broken-svc   10.244.0.89:8080,10.244.0.90:8080   34s
```

```
$ kubectl run tester --image=busybox:1.36 --rm -i --restart=Never -- wget -qO- http://broken-svc/
broken app works now
```

### Notes

- `CreateContainerConfigError` always means a missing ConfigMap or Secret reference. Different from
  CrashLoopBackOff (app started and died) and ImagePullBackOff (could not get the image).
- `kubectl logs` gives nothing when the container never started. Use describe.
- **Empty endpoints means the selector does not match the labels.** First thing to check on any
  "service not working".
- The port bug is the worst of the three because nothing reports an error. You only find it by
  comparing the Service to what the container actually listens on.
