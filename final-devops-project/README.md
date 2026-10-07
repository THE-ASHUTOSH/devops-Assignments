# Final DevOps Project

**Ashutosh Kumar** · **24bcs10111**

A small visitor-counter app taken all the way through the toolchain from this course - code, tests,
Docker, Kubernetes, Helm, Terraform, CI/CD, security scanning, monitoring and GitOps.

## Project overview

The app is deliberately tiny so the *pipeline* is the interesting part. It's a Node HTTP server
that counts visits and exposes `/health` and `/ready` for the probes.

```
visitor-app - visit number 3
```

## Architecture

```
  developer
      │  git push
      ▼
  ┌─────────┐
  │ GitHub  │
  └────┬────┘
       │
       ▼
  ┌──────────────── CI (GitHub Actions) ────────────────┐
  │  install → unit tests                               │
  │        ↓                                            │
  │  secret scan (gitleaks)   SCA (npm audit)           │
  │        ↓                                            │
  │  docker build → Trivy scan → [SECURITY GATE]        │
  │        ↓                                            │
  │  push image to registry                             │
  └──────────────────────┬──────────────────────────────┘
                         │ image tag committed to git
                         ▼
                   ┌──────────┐
                   │  Argo CD │  polls git, reconciles forever
                   └─────┬────┘
                         ▼
  ┌────────────── Kubernetes ───────────────┐
  │  Ingress → Service → Deployment (2-8)   │
  │              ConfigMap + Secret          │
  │              HPA, probes, limits         │
  └─────────────────┬───────────────────────┘
                    │
              metrics-server / Prometheus

  Terraform provisions: VPC, subnets, ECR, S3 artifacts bucket
```

## Technologies used

| area | tool |
|---|---|
| Application | Node.js 20, built-in test runner |
| Container | Docker, multi-stage, non-root |
| Orchestration | Kubernetes (minikube) |
| Packaging | Helm |
| Infrastructure | Terraform + AWS |
| CI/CD | GitHub Actions |
| Security | CodeQL, npm audit, gitleaks, Trivy |
| Monitoring | metrics-server, Prometheus-style annotations |
| GitOps | Argo CD |

## Layout

```
final-devops-project/
├── application/        Node app + unit tests
├── docker/             multi-stage Dockerfile
├── kubernetes/         deployment, service, ingress, configmap, secret, hpa
├── helm/visitor-app/   the same thing as a parameterised chart
├── terraform/          VPC, subnets, ECR, S3
├── .github/workflows/  reference pipeline (see note below)
├── security/           scanner config + hardening notes
├── monitoring/         what's collected and the alert rules
├── gitops/             Argo CD Application
└── README.md
```

## Application setup

```bash
cd application
npm install
npm test
npm start      # http://localhost:3000
```

```
$ npm test
# tests 3
# pass 3
# fail 0
```

`src/app.js` is separate from `src/server.js` so tests can import the logic without binding a port.

## Docker setup

[`docker/Dockerfile`](docker/Dockerfile) is multi-stage:

```dockerfile
FROM node:20-alpine AS build
RUN npm install --omit=dev

FROM node:20-alpine
COPY --from=build /app/node_modules ./node_modules
COPY application/src ./src
RUN addgroup -S app && adduser -S app -G app
USER app
HEALTHCHECK --interval=30s CMD wget -qO- http://localhost:3000/health || exit 1
```

Same idea as the Go multi-stage build earlier in this repo - the final image carries no build
tooling. Plus `USER app`, because containers run as root by default and that's a bad default.

```bash
docker build -f docker/Dockerfile -t visitor-app:local .
docker run -p 3000:3000 visitor-app:local
```

## Kubernetes deployment

```bash
kubectl apply -f kubernetes/
```

Verified server-side:

```
configmap/visitor-config created (server dry run)
deployment.apps/visitor-app created (server dry run)
horizontalpodautoscaler.autoscaling/visitor-app created (server dry run)
ingress.networking.k8s.io/visitor-app created (server dry run)
secret/visitor-secret created (server dry run)
service/visitor-app created (server dry run)
```

`--dry-run=server` sends the manifests to the real API server for validation without creating
anything, so this confirms every field and apiVersion is correct against Kubernetes 1.37.

What's in the Deployment, and why:

- `maxUnavailable: 0` - never drop below 2 ready pods during a rolling update
- all **three** probes - `startupProbe` gives 30s to boot and blocks the other two, so a slow start
  can't be killed by its own liveness probe
- `envFrom` pulling both the ConfigMap and the Secret
- requests **and** limits - requests so the HPA has a baseline, limits so one pod can't take the node
- a full `securityContext` (non-root, no privilege escalation, read-only root fs, all capabilities
  dropped)

## Helm deployment

The same app as a chart, so nothing is hardcoded:

```bash
helm lint helm/visitor-app
helm template test helm/visitor-app
helm install visitor helm/visitor-app --set replicaCount=3
```

```
$ helm lint helm/visitor-app
1 chart(s) linted, 0 chart(s) failed

$ helm template test helm/visitor-app
kind: Service
kind: Deployment
          image: "visitor-app:local"
kind: HorizontalPodAutoscaler
kind: Ingress
```

The HPA and Ingress templates are wrapped in `{{- if ... }}`, so `--set autoscaling.enabled=false`
means the object isn't rendered at all rather than rendered-and-disabled. That's how one chart
covers dev and prod.

## Terraform infrastructure

[`terraform/`](terraform/) provisions what the pipeline needs:

| resource | why |
|---|---|
| VPC + 2 private subnets | across two AZs, using `cidrsubnet()` and an AZ data source |
| ECR repository | where CI pushes the image |
| S3 bucket | build artifacts, public access blocked |

Two details worth calling out:

```hcl
image_tag_mutability = "IMMUTABLE"
image_scanning_configuration { scan_on_push = true }
```

Immutable tags mean an image can't be swapped after it passed its security scan - otherwise the gate
is bypassable.

```bash
terraform init && terraform validate && terraform plan && terraform apply
```

Not applied against a real account (no AWS credentials in this setup) - same as Sessions 18 and 19.

## CI/CD pipeline

> **Note:** GitHub only executes workflows from the **repository root**. The pipelines that actually
> run are [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) and
> [`.github/workflows/devsecops.yml`](../.github/workflows/devsecops.yml). The copy in
> [`.github/workflows/pipeline.yml`](.github/workflows/pipeline.yml) here is the project-specific
> reference version.

```
test → security → image → deploy
```

Each stage uses `needs:`, so a failure stops everything after it. Jobs are parallel by default -
`needs:` is the only thing creating order.

## DevSecOps implementation

| stage | tool | scans |
|---|---|---|
| SAST | CodeQL | our source code |
| SCA | npm audit | our dependencies |
| Secret scan | gitleaks (`fetch-depth: 0`) | full git history |
| Image scan | Trivy | the built image's OS packages |

The **security gate** is `exit-code: '1'` on Trivy plus `needs: image-scan` on the push job. A
failing scan fails the job, so the image is never pushed. There's no special gate feature - a gate
is just a job that fails.

`fetch-depth: 0` matters for secret scanning: the default shallow checkout only has the latest
commit, so a secret added and later "removed" would be missed even though it's still in history.

## Monitoring

See [`monitoring/README.md`](monitoring/). The app serves `/health` with a JSON body, both probes
use it, and the deployment carries resource requests so utilisation percentages mean something.

```bash
kubectl top pods -l app=visitor-app
kubectl get hpa visitor-app
kubectl logs -l app=visitor-app --tail=20
```

## GitOps

See [`gitops/`](gitops/). An Argo CD `Application` pointed at `final-devops-project/kubernetes` on
`main`, with `selfHeal: true` and `prune: true`.

The CI pipeline stops at "image pushed". Argo CD, running inside the cluster, handles deployment by
pulling from git - so nothing outside the cluster needs cluster credentials.

## Troubleshooting

Real problems hit while building this repo, and their root causes:

| symptom | root cause | fix |
|---|---|---|
| every pod `RunContainerError` | Git Bash rewrote `/agnhost` into `C:/Program Files/Git/agnhost` | `export MSYS_NO_PATHCONV=1` |
| cluster-wide `ImagePullBackOff` | node resolved DNS to IPv6 with no IPv6 route; UDP/53 timing out | pull on host, `minikube image load` |
| node stuck `NotReady` | CNI pod hadn't started | wait - a node is NotReady until networking is up |
| HPA stuck at `<unknown>` | metrics-server hadn't scraped yet | wait ~60s |
| HPA wouldn't scale down for 6 min | 300s scale-down stabilization window | nothing - working as designed |
| `CreateContainerConfigError` | ConfigMap key didn't exist | fix the key name |
| Service returned nothing | selector `brokenapp` vs label `broken-app` | fix the selector |
| headless service refused on :80 | headless returns pod IPs, no kube-proxy, so no 80→8080 map | use the pod's real port |
| `npm test` failed in CI script | Node 22 can't take a directory for `--test` | glob the files instead |
| `terraform init` couldn't fetch provider | no outbound DNS to releases.hashicorp.com | reused the locked provider |

The pattern across most of these: **the error message names the wrong layer.** "ImagePullBackOff"
was a DNS problem, "RunContainerError" was a shell problem, and the HPA ones weren't problems at all.

## Lessons learned

- **`describe` beats `logs` when the container never started.** If there's no container there are no
  logs. Knowing which of the two to reach for saved the most time.
- **Empty endpoints is the first thing to check** for any "service doesn't work" report. It's almost
  always a selector/label mismatch or a failing readiness probe.
- **Declarative means the controller fights you, and that's the point.** Deleting a pod from a
  Deployment just makes a new one. Argo CD's `selfHeal` is the same idea one level up.
- **Separating `plan` from `apply`, and `template` from `install`, is the same safety idea** -
  always look at what will change before it changes.
- **base64 is not encryption.** One command decodes a Secret, which is why secret scanning is in the
  pipeline rather than a policy document.
- **Timing is part of the system.** Three of my "bugs" were just waiting - metrics-server scrape
  interval, the HPA stabilization window, the kubelet's ConfigMap sync. Knowing the expected delay
  is as important as knowing the config.
- **Test pipeline commands locally first.** My `npm test` bug would have cost a full CI run.
