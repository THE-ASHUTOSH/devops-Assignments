# Final DevOps Project

Ashutosh Kumar - 24bcs10111

A small visitor counter app taken through the whole toolchain - code, tests, Docker, Kubernetes,
Helm, Terraform, CI/CD, security scanning, monitoring and GitOps.

The app is deliberately tiny so the pipeline is the interesting part. It is a Node HTTP server that
counts visits and has `/health` and `/ready` for the probes.

```
visitor-app - visit number 3
```

## Architecture

```
  developer
      |  git push
  [ GitHub ]
      |
  +-------- CI (GitHub Actions) ---------+
  |  install -> unit tests               |
  |        |                             |
  |  secret scan     SCA                 |
  |        |                             |
  |  docker build -> Trivy -> [GATE]     |
  |        |                             |
  |  push image to registry              |
  +------------------+-------------------+
                     |
               [ Argo CD ]  polls git, reconciles forever
                     |
  +--------- Kubernetes -----------+
  |  Ingress -> Service -> Deploy  |
  |      ConfigMap + Secret        |
  |      HPA, probes, limits       |
  +--------------------------------+
                     |
            metrics-server / Prometheus

  Terraform makes: VPC, subnets, ECR, S3
```

## Technologies

| area | tool |
|---|---|
| App | Node.js 20, built-in test runner |
| Container | Docker, multi-stage, non-root |
| Orchestration | Kubernetes (minikube) |
| Packaging | Helm |
| Infrastructure | Terraform + AWS |
| CI/CD | GitHub Actions |
| Security | CodeQL, npm audit, gitleaks, Trivy |
| Monitoring | metrics-server |
| GitOps | Argo CD |

## Layout

```
final-devops-project/
├── application/        Node app + tests
├── docker/             multi-stage Dockerfile
├── kubernetes/         deployment, service, ingress, configmap, secret, hpa
├── helm/visitor-app/   the same thing as a chart
├── terraform/          VPC, subnets, ECR, S3
├── .github/workflows/  reference pipeline
├── security/           scanner config
├── monitoring/         what is collected
├── gitops/             Argo CD Application
└── README.md
```

## Application

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

`src/app.js` is separate from `src/server.js` so tests can import the logic without starting a
server.

## Docker

[`docker/Dockerfile`](docker/Dockerfile) is multi-stage:

```dockerfile
FROM node:20-alpine AS build
RUN npm install --omit=dev

FROM node:20-alpine
RUN apk --no-cache upgrade
COPY --from=build /app/node_modules ./node_modules
COPY application/src ./src
RUN addgroup -S app && adduser -S app -G app
USER app
HEALTHCHECK --interval=30s CMD wget -qO- http://localhost:3000/health || exit 1
```

Same idea as the Go multi-stage build earlier in this repo, the final image has no build tooling.
Plus USER app, because containers run as root by default.

```bash
docker build -f docker/Dockerfile -t visitor-app:local .
```

## Kubernetes

```bash
kubectl apply -f kubernetes/
```

Checked with a server dry run, which validates against the real API without creating anything:

```
configmap/visitor-config created (server dry run)
deployment.apps/visitor-app created (server dry run)
horizontalpodautoscaler.autoscaling/visitor-app created (server dry run)
ingress.networking.k8s.io/visitor-app created (server dry run)
secret/visitor-secret created (server dry run)
service/visitor-app created (server dry run)
```

So every field and apiVersion is correct against Kubernetes 1.37.

What is in the Deployment and why:

- `maxUnavailable: 0` so it never drops below 2 ready pods during an update
- all three probes. startupProbe gives 30s to boot and blocks the other two, so a slow start cannot
  be killed by its own liveness probe
- `envFrom` pulling in both the ConfigMap and the Secret
- requests and limits - requests so the HPA has a baseline, limits so one pod cannot take the node
- a full securityContext (non-root, no privilege escalation, read-only root fs, drop all caps)

## Helm

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

The HPA and Ingress templates are wrapped in `{{- if }}`, so turning autoscaling off means the
object is not rendered at all. That is how one chart covers dev and prod.

## Terraform

[`terraform/`](terraform/) makes what the pipeline needs:

| resource | why |
|---|---|
| VPC + 2 private subnets | across two AZs, using cidrsubnet() and an AZ data source |
| ECR repository | where CI pushes the image |
| S3 bucket | build artifacts, public access blocked |

Two bits worth pointing out:

```hcl
image_tag_mutability = "IMMUTABLE"
image_scanning_configuration { scan_on_push = true }
```

Immutable tags mean an image cannot be swapped after it passed its scan, otherwise the gate is
bypassable.

Not applied against a real account (no AWS credentials), same as Sessions 18 and 19.

## CI/CD

GitHub only runs workflows from the **repo root**, so the ones that actually run are
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) and
[`devsecops.yml`](../.github/workflows/devsecops.yml). The copy in
[`.github/workflows/pipeline.yml`](.github/workflows/pipeline.yml) here is the project-specific
reference version.

```
test -> security -> image -> deploy
```

Each stage uses `needs:` so a failure stops everything after it. Jobs are parallel by default,
`needs:` is the only thing making order.

## DevSecOps

| stage | tool | scans |
|---|---|---|
| SAST | CodeQL | our source code |
| SCA | npm audit | our dependencies |
| Secret scan | gitleaks (fetch-depth 0) | full git history |
| Image scan | Trivy | the built image |

The gate is `exit-code: '1'` on Trivy plus `needs: image-scan` on the push job. A failing scan means
the image is never pushed. There is no special gate feature, a gate is just a job that fails.

`fetch-depth: 0` matters for secret scanning - the default shallow checkout only has the latest
commit, so a secret added and later removed would be missed.

## Monitoring

See [`monitoring/README.md`](monitoring/). The app serves `/health` with a JSON body, both probes
use it, and the deployment has resource requests so percentages mean something.

```bash
kubectl top pods -l app=visitor-app
kubectl get hpa visitor-app
kubectl logs -l app=visitor-app --tail=20
```

## GitOps

See [`gitops/`](gitops/). An Argo CD Application pointed at `final-devops-project/kubernetes` on
main, with selfHeal and prune on.

CI stops at "image pushed". Argo CD, inside the cluster, handles deployment by pulling from git, so
nothing outside the cluster needs cluster credentials.

## Troubleshooting

Real problems I hit building this repo:

| symptom | cause | fix |
|---|---|---|
| every pod RunContainerError | Git Bash rewrote `/agnhost` into a Windows path | `export MSYS_NO_PATHCONV=1` |
| cluster-wide ImagePullBackOff | node resolved to IPv6 with no IPv6 route | pull on host, `minikube image load` |
| node stuck NotReady | CNI pod had not started | wait |
| HPA stuck at `<unknown>` | metrics-server had not scraped | wait ~60s |
| HPA would not scale down for 6 min | 300s stabilization window | nothing, working as designed |
| CreateContainerConfigError | ConfigMap key did not exist | fix the key name |
| Service returned nothing | selector `brokenapp` vs label `broken-app` | fix the selector |
| headless service refused on :80 | headless gives pod IPs, no kube-proxy, so no 80->8080 | use the real port |
| npm test failed in CI | Node 22 cannot take a directory for `--test` | glob the files |
| terraform init could not fetch | no DNS to releases.hashicorp.com | reused the locked provider |

The pattern across most of these: **the error message names the wrong layer.** ImagePullBackOff was
a DNS problem, RunContainerError was a shell problem, and the HPA ones were not problems at all.

## Lessons learned

- **describe beats logs when the container never started.** No container means no logs. Knowing
  which to reach for saved the most time.
- **Empty endpoints is the first thing to check** for any "service does not work". Almost always a
  selector mismatch or a failing readiness probe.
- **Declarative means the controller fights you, and that is the point.** Deleting a pod from a
  Deployment just makes a new one. Argo CD's selfHeal is the same idea one level up.
- **Separating plan from apply, and template from install, is the same safety idea** - look at what
  will change before it changes.
- **base64 is not encryption.** One command decodes a Secret, which is why secret scanning is in
  the pipeline and not just a policy document.
- **Timing is part of the system.** Three of my bugs were just waiting - metrics-server scraping,
  the HPA window, the kubelet's ConfigMap sync. Knowing the expected delay matters as much as the
  config.
- **Test pipeline commands locally first.** My npm test bug would have cost a full CI run.
