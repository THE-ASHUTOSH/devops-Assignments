# Session 15 - Helm

Ashutosh Kumar - 24bcs10111

Helm v4.3.0 against minikube.

Helm is a package manager for Kubernetes. Instead of a folder of YAML you apply by hand, you get a
**chart** (templates plus values) that installs as a **release** you can upgrade and roll back.

## Task 1 - Commands

### helm create

```bash
helm create demo-chart
```

Makes a working chart in [`demo-chart/`](demo-chart/):

```
demo-chart/
├── Chart.yaml        name, version
├── values.yaml       the defaults you override
├── templates/        the YAML with {{ }} placeholders
└── charts/           dependencies
```

### helm lint

```
$ helm lint ./demo-chart
[INFO] Chart.yaml: icon is recommended
1 chart(s) linted, 0 chart(s) failed
```

### helm template

Renders locally without touching the cluster. The one I used most while learning:

```bash
helm template demo ./demo-chart --set image.tag=1.25-alpine
```
```
kind: ServiceAccount
kind: Service
kind: Deployment
          image: "nginx:1.25-alpine"
kind: Pod
```

The `--set` landed in the rendered Deployment. That is the whole idea of a chart.

### helm install

```bash
helm install demo ./demo-chart --set image.tag=1.25-alpine --set replicaCount=2
```
```
NAME: demo
STATUS: deployed
REVISION: 1
DESCRIPTION: Install complete
```

REVISION 1 is the bit that matters. Helm records every change as a numbered revision.

### helm list

```
NAME	NAMESPACE	REVISION	STATUS  	CHART           	APP VERSION
demo	default  	1       	deployed	demo-chart-0.1.0	1.16.0
```

### helm status

```
NAME: demo
STATUS: deployed
REVISION: 4
DESCRIPTION: Rollback to 1
```

### helm get

```
$ helm get values demo
USER-SUPPLIED VALUES:
image:
  tag: 1.25-alpine
replicaCount: 2
```

Only my overrides. `helm get values -a` shows everything including defaults. Also
`helm get manifest` for the rendered YAML.

### helm upgrade

```bash
helm upgrade demo ./demo-chart --set image.tag=1.26-alpine --set replicaCount=3
```
```
Release "demo" has been upgraded. Happy Helming!
image: nginx:1.26-alpine
```

### helm history

```
REVISION	STATUS    	CHART           	DESCRIPTION
1       	superseded	demo-chart-0.1.0	Install complete
2       	superseded	demo-chart-0.1.0	Upgrade complete
3       	deployed  	demo-chart-0.1.0	Upgrade complete
```

### helm rollback

```
$ helm rollback demo 1
Rollback was a success! Happy Helming!
```

### helm uninstall

```
$ helm uninstall demo
release "demo" uninstalled
```

Removes everything the release made in one command. That is the real win over `kubectl delete -f`
on a pile of files.

### helm repo and search

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
helm search repo nginx
helm search hub postgresql
```

`search repo` looks in repos you added, `search hub` searches Artifact Hub. I used a local chart so
I did not add a remote repo, but the flow is add, update, search, install.

## Task 2 - Rollback workflow

**Install** - revision 1, nginx:1.25-alpine, 2 replicas.

**Upgrade** - revision 2, nginx:1.26-alpine, 3 replicas.

**Upgrade again** - revision 3, nginx:1.27-alpine.

```
REVISION	STATUS    	DESCRIPTION
1       	superseded	Install complete
2       	superseded	Upgrade complete
3       	deployed  	Upgrade complete
```

**Rollback** to 1:

```
$ helm rollback demo 1
Rollback was a success!
image after rollback: nginx:1.25-alpine
```

**Verify:**

```
REVISION	STATUS    	DESCRIPTION
1       	superseded	Install complete
2       	superseded	Upgrade complete
3       	superseded	Upgrade complete
4       	deployed  	Rollback to 1
```

The thing worth noticing: **the rollback made revision 4, it did not delete revision 3.** History
only goes forward. "Go back to 1" is recorded as a new revision called `Rollback to 1`. So you can
roll back the rollback with `helm rollback demo 3`.

The image really did go back to 1.25-alpine, so this is not just bookkeeping.

Compared to `kubectl rollout undo` from Session 10, that only knows about one Deployment's
replicasets. Helm rolls back the **whole release** - deployment, service, configmap, ingress - all
together. That is the real argument for Helm.

Helm stores each revision as a Secret in the namespace, which is how it can rebuild an old one
exactly.

## Task 3 - Mini project

The chart in [`demo-chart/`](demo-chart/) is the mini project - nothing is hardcoded, `values.yaml`
drives it:

```yaml
replicaCount: 1
image:
  repository: nginx
  tag: ""
service:
  type: ClusterIP
  port: 80
ingress:
  enabled: false
autoscaling:
  enabled: false
```

So the same chart does dev and prod:

```bash
helm install dev  ./demo-chart --set replicaCount=1
helm install prod ./demo-chart --set replicaCount=5 --set autoscaling.enabled=true
```

The templates use `{{- if }}`, so `autoscaling.enabled=false` means the HPA is not rendered at all,
not rendered-and-disabled.

## Notes

- A chart is templates plus values. Change values, not YAML.
- A release is an installed chart with a history, which is what makes rollback one command.
- Run `helm template` first every time, it shows exactly what will be applied.
- Rollback moves history forward instead of rewriting it.
