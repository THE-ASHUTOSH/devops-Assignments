# Session 15 - Helm

**Ashutosh Kumar** · **24bcs10111**

Helm v4.3.0 against minikube.

Helm is a package manager for Kubernetes. Instead of a folder of YAML you apply by hand, you get a
**chart** (templated YAML + default values) that installs as a **release** you can upgrade and roll
back.

## Task 1 - Helm commands

### `helm create`

```bash
helm create demo-chart
```
```
Creating demo-chart
```

Scaffolds a working chart in [`demo-chart/`](demo-chart/):

```
demo-chart/
├── Chart.yaml        name, version, appVersion
├── values.yaml       the defaults users override
├── templates/        the YAML, with {{ }} placeholders
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   ├── hpa.yaml
│   ├── _helpers.tpl  reusable name/label snippets
│   └── NOTES.txt     printed after install
└── charts/           dependencies
```

### `helm lint`

Checks the chart before you install anything:

```
$ helm lint ./demo-chart
[INFO] Chart.yaml: icon is recommended

1 chart(s) linted, 0 chart(s) failed
```

### `helm template`

Renders the templates locally without touching the cluster. The one I used most while learning,
because you can see exactly what Helm would send:

```bash
helm template demo ./demo-chart --set image.tag=1.25-alpine
```
```
kind: ServiceAccount
kind: Service
kind: Deployment
          image: "nginx:1.25-alpine"
kind: Pod
      image: busybox
```

The `--set image.tag` landed in the rendered Deployment. That's the whole idea of a chart - one
template, different values.

### `helm install`

```bash
helm install demo ./demo-chart --set image.tag=1.25-alpine --set replicaCount=2
```
```
NAME: demo
LAST DEPLOYED: Wed Oct  7 23:00:53 2026
NAMESPACE: default
STATUS: deployed
REVISION: 1
DESCRIPTION: Install complete
```

**REVISION: 1** - this is the bit that matters. Helm records every change as a numbered revision.

```
$ kubectl get deployment demo-demo-chart -o jsonpath='{.spec.template.spec.containers[0].image}'
nginx:1.25-alpine
```

### `helm list`

```
NAME	NAMESPACE	REVISION	UPDATED                   	STATUS  	CHART           	APP VERSION
demo	default  	1       	2026-10-07 23:00:53 +0530 	deployed	demo-chart-0.1.0	1.16.0
```

### `helm status`

```
NAME: demo
LAST DEPLOYED: Wed Oct  7 23:01:03 2026
NAMESPACE: default
STATUS: deployed
REVISION: 4
DESCRIPTION: Rollback to 1
```

### `helm get`

Shows what's stored for a release. `helm get values` is the useful one - what did I actually
override?

```
$ helm get values demo
USER-SUPPLIED VALUES:
image:
  tag: 1.25-alpine
replicaCount: 2
```

Only my overrides, not the whole of values.yaml. `helm get values -a` shows everything including
defaults. Also `helm get manifest` (the rendered YAML) and `helm get notes`.

### `helm upgrade`

```bash
helm upgrade demo ./demo-chart --set image.tag=1.26-alpine --set replicaCount=3
```
```
Release "demo" has been upgraded. Happy Helming!
STATUS: deployed
```
```
image: nginx:1.26-alpine
```

### `helm history`

```
REVISION	UPDATED                 	STATUS    	CHART           	DESCRIPTION
1       	Wed Oct  7 23:00:53 2026	superseded	demo-chart-0.1.0	Install complete
2       	Wed Oct  7 23:01:02 2026	superseded	demo-chart-0.1.0	Upgrade complete
3       	Wed Oct  7 23:01:02 2026	deployed  	demo-chart-0.1.0	Upgrade complete
```

Old revisions go `superseded`, the current one is `deployed`.

### `helm rollback`

```bash
helm rollback demo 1
```
```
Rollback was a success! Happy Helming!
```

### `helm uninstall`

```
$ helm uninstall demo
release "demo" uninstalled
```

Removes everything the release created, in one command. That's the real payoff over
`kubectl delete -f` on a pile of files.

### `helm repo` and `helm search`

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
helm repo list
helm search repo nginx
helm search hub postgresql
```

`search repo` looks in repos you've added, `search hub` searches Artifact Hub. I didn't add a remote
repo here since I was working with a local chart, but the flow is: add repo → update → search →
install by `repo/chart` name.

## Task 2 - Rollback workflow

The full cycle the task asks for, done in order.

**Install** → revision 1, `nginx:1.25-alpine`, 2 replicas.

```
STATUS: deployed
REVISION: 1
image: nginx:1.25-alpine
```

**Upgrade** → revision 2, `nginx:1.26-alpine`, 3 replicas.

```
Release "demo" has been upgraded. Happy Helming!
image: nginx:1.26-alpine
```

**Verify** - image changed, revision incremented.

**Upgrade again** → revision 3, `nginx:1.27-alpine`.

```
image: nginx:1.27-alpine
```

**Verify**:

```
REVISION	STATUS    	DESCRIPTION
1       	superseded	Install complete
2       	superseded	Upgrade complete
3       	deployed  	Upgrade complete
```

**Rollback** to revision 1:

```
$ helm rollback demo 1
Rollback was a success! Happy Helming!

image after rollback: nginx:1.25-alpine
```

**Verify**:

```
REVISION	UPDATED                 	STATUS    	DESCRIPTION
1       	Wed Oct  7 23:00:53 2026	superseded	Install complete
2       	Wed Oct  7 23:01:02 2026	superseded	Upgrade complete
3       	Wed Oct  7 23:01:02 2026	superseded	Upgrade complete
4       	Wed Oct  7 23:01:03 2026	deployed  	Rollback to 1
```

### The thing worth noticing

**The rollback created revision 4, it did not delete revision 3.** History only moves forward -
"go back to 1" is recorded as a new revision described as `Rollback to 1`. So you can roll back the
rollback (`helm rollback demo 3`).

The image genuinely went back to `1.25-alpine`, so this isn't just bookkeeping.

Compared to `kubectl rollout undo` from Session 10: that only knows about one Deployment's
ReplicaSets. Helm rolls back the **whole release** - deployment, service, configmap, ingress,
everything in the chart - together. That's the real argument for Helm.

Helm stores each revision as a Secret in the namespace (`sh.helm.release.v1.demo.v1` and so on),
which is how it can rebuild an old revision exactly.

## Task 3 - Mini project

The chart in [`demo-chart/`](demo-chart/) **is** the mini project - a parameterised app where
nothing is hardcoded. `values.yaml` drives it:

```yaml
replicaCount: 1
image:
  repository: nginx
  pullPolicy: IfNotPresent
  tag: ""
service:
  type: ClusterIP
  port: 80
ingress:
  enabled: false
autoscaling:
  enabled: false
  minReplicas: 1
  maxReplicas: 100
  targetCPUUtilizationPercentage: 80
resources: {}
```

So the same chart does dev and prod:

```bash
helm install dev  ./demo-chart --set replicaCount=1 --set image.tag=1.25-alpine
helm install prod ./demo-chart --set replicaCount=5 --set autoscaling.enabled=true \
                               --values prod-values.yaml
```

The templates use conditionals, so `autoscaling.enabled=false` means the HPA object isn't rendered
at all - not rendered-and-disabled. That's how one chart covers environments that genuinely differ.

### What I took away

- A chart is a template + values. Change values, not YAML.
- A release is an installed chart with a **history**, which is what makes rollback a single command.
- `helm template` first, every time - it shows exactly what will be applied before anything is.
- `helm lint` catches broken templates before the cluster does.
- Rollback moves history forward rather than rewriting it.
