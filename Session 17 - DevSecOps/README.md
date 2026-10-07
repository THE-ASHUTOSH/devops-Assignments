# Session 17 - Complete CI/CD & DevSecOps

Ashutosh Kumar - 24bcs10111

Workflow: [`.github/workflows/devsecops.yml`](../.github/workflows/devsecops.yml)
Manifests: [`kubernetes/`](kubernetes/)

Builds on the Session 16 app and adds security gates.

## The idea

Security checks run **in the pipeline**, not as a review at the end. If a scan fails the build
stops and the image never gets pushed. Security becomes a build failure, which developers already
know how to deal with.

## Flow

```
Code -> Build -> Unit Test -> SAST -> SCA -> Secret Scan
     -> Docker Build -> Image Scan -> Gate -> Push -> Deploy
```

As jobs:

```
build-and-test
      |
 sast   sca   secret-scan      <- these three run in PARALLEL
      |
  image-scan                   <- the gate is here
      |
  push-image
      |
   deploy
```

The three code scans are independent so there is no reason to wait. They all have to pass before
the image is even built.

## CI/CD half

Build and unit test is the same as Session 16. The image build uses the same Dockerfile. The
registry would be ghcr.io, but push-image just echoes the command since pushing a package from
coursework is not useful. Kubernetes manifests are in [`kubernetes/`](kubernetes/).

## Security half

### SAST

Scans **your own code** without running it - SQL injection, command injection, XSS.

```yaml
- uses: github/codeql-action/init@v3
  with:
    languages: javascript
- uses: github/codeql-action/analyze@v3
```

### SCA

Scans your **dependencies**. Different problem from SAST - your code can be perfect and still ship
a known CVE through a dependency. In a Node app most of what ships is not yours.

```yaml
- run: npm audit --audit-level=high
```

`--audit-level=high` means low and moderate findings report but do not fail the build. Failing on
everything teaches people to ignore the pipeline.

### Secret scanning

Looks for committed credentials across **full git history**:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0        # gitleaks needs history, not just the tip
- uses: gitleaks/gitleaks-action@v2
```

`fetch-depth: 0` matters. The default shallow checkout only has the latest commit, so a secret
added and later "removed" would be missed even though it is still in history.

This follows from Session 12 where I decoded a Secret in one command:

```
$ kubectl get secret app-secret -o jsonpath='{.data.DB_PASSWORD}' | base64 -d
sup3rs3cret
```

base64 is encoding, not encryption.

### Image scanning

Scans the **built image**, including the OS packages in the base layer.

```yaml
- uses: aquasecurity/trivy-action@master
  with:
    image-ref: demo:${{ github.sha }}
    exit-code: '1'
    severity: CRITICAL,HIGH
    ignore-unfixed: true
```

`ignore-unfixed: true` skips CVEs with no patch yet, otherwise the build fails on something nobody
can act on.

### The gate

The gate is not a separate job, it is `exit-code: '1'` on the Trivy step. A non-zero exit fails the
job, and push-image has `needs: image-scan`, so a failing scan means the image is never pushed.

**The gate is just a job that fails.** There is no special gate feature.

## Actual results

The workflow runs on this repo and the first run **failed**, which turned out to be the useful
part. Four real problems:

| job | failure | cause | fix |
|---|---|---|---|
| sast | CodeQL could not upload | no `security-events: write` permission | added the permission |
| sca | `npm error code ENOLOCK` | npm audit needs a lockfile | `npm install --package-lock-only` first |
| secret-scan | `leaks found: 2` | gitleaks found my **fake** Session 12 secrets | root `.gitleaks.toml` allowlisting them |
| image-scan | `Total: 4 (HIGH: 4)` | real openssl CVEs in node:20-alpine | `RUN apk --no-cache upgrade` |

After those fixes:

```
✓ build-and-test in 9s
✓ sca in 11s
✓ sast in 1m22s
✓ secret-scan in 5s
X image-scan in 28s
```

### The gate is still failing, on purpose

The openssl CVEs are gone, the upgrade is visible in the build log:

```
#7 [2/7] RUN apk --no-cache upgrade
#7 0.492 (1/2) Upgrading libapk (3.0.6-r0 -> 3.0.8-r0)
```

But Trivy then finds problems in the **npm packages inside the base image itself**:

```
Total: 22 (HIGH: 21, CRITICAL: 1)
│ brace-expansion (package.json) │ CVE-2026-102276 │ HIGH │ fixed │ 2.0.1 │
```

My app has **zero dependencies**. These ship inside node:20-alpine because the image includes npm,
and npm has its own dependency tree.

I left it failing instead of hiding it, because the other options are worse:

- `severity: CRITICAL` only - weakens the gate to make it green
- `vuln-type: os` - tells Trivy to ignore app dependencies entirely
- `.trivyignore` - suppressing a real finding
- **the actual fix:** a runtime image with no npm, like `gcr.io/distroless/nodejs20`

The last one is correct and is what I would do on a real project. Leaving the red X shows the thing
this task is about: **the gate works.** A failing scan means the image is never pushed. A gate you
tune until it passes is not a gate.

## Kubernetes security

[`kubernetes/deployment.yml`](kubernetes/deployment.yml) has a securityContext, which is the easy
part to leave out:

```yaml
securityContext:
  runAsNonRoot: true
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: ["ALL"]
```

| setting | why |
|---|---|
| runAsNonRoot | container root is close to node root if something escapes |
| allowPrivilegeEscalation false | blocks setuid escalation |
| readOnlyRootFilesystem | attacker cannot write a payload to disk |
| drop ALL | removes capabilities the app never needs |

Plus resource limits so a compromised container cannot exhaust the node, and both probes.

## Notes

- SAST, SCA and secret scanning answer three different questions - my code, my dependencies, my git
  history. Image scanning adds a fourth, my base image. Skipping one leaves a real gap.
- The gate is a failing job plus `needs:`.
- `fetch-depth: 0` for secret scanning or you only scan the latest commit.
- Scans run before the image is built, so a doomed build fails in seconds.
