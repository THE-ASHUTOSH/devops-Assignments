# Session 17 - Complete CI/CD & DevSecOps

**Ashutosh Kumar** · **24bcs10111**

Workflow: [`.github/workflows/devsecops.yml`](../.github/workflows/devsecops.yml)
Manifests: [`kubernetes/`](kubernetes/) · Scanner config: [`.gitleaks.toml`](.gitleaks.toml)

Builds on the Session 16 app and adds security gates.

## The idea

DevSecOps means security checks run **in the pipeline**, not as a review at the end. If a scan
fails, the build stops and the image never gets pushed. Security becomes a build failure, which is
something developers already know how to deal with.

## Expected flow

```
Code → Build → Unit Test → SAST → SCA → Secret Scan
     → Docker Build → Image Scan → Security Gate → Push Image → Deploy
```

As jobs, with `needs:` wiring the order:

```
build-and-test
      ↓
  ┌───┴───┬──────────┐        these three run in PARALLEL
 sast    sca    secret-scan
  └───┬───┴──────────┘
      ↓
  image-scan         ← the security gate lives here
      ↓
  push-image
      ↓
   deploy
```

The three code scans run in parallel because they're independent - no reason to wait. They all have
to pass before the image is even built.

## CI/CD half

**Application build + unit testing** - same as Session 16, 3 tests via Node's built-in runner.

**Docker image build** - the Dockerfile from Session 16, already running as non-root.

**Container registry** - would be `ghcr.io/the-ashutosh/devops-assignments`. The `push-image` job
echoes the command rather than pushing, since pushing a package from coursework isn't useful.

**Kubernetes deployment** - manifests in [`kubernetes/deployment.yml`](kubernetes/deployment.yml).

## Security half

### SAST - Static Application Security Testing

Scans **your own source code** for vulnerable patterns without running it - SQL injection, command
injection, XSS, hardcoded crypto.

```yaml
- uses: github/codeql-action/init@v3
  with:
    languages: javascript
- uses: github/codeql-action/analyze@v3
```

CodeQL is free on public repos and results appear in the Security tab.

### SCA - Software Composition Analysis

Scans your **dependencies**. Different problem from SAST - your code can be perfect and still ship a
known CVE through a transitive dependency. In a typical Node app most of what ships isn't yours.

```yaml
- name: npm audit
  run: npm audit --audit-level=high
```

`--audit-level=high` means low/moderate findings report but don't fail the build. Failing on
everything trains people to ignore the pipeline.

### Secret scanning

Looks for committed credentials - API keys, tokens, private keys - across **full git history**:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0        # gitleaks needs history, not just the tip
- uses: gitleaks/gitleaks-action@v2
```

`fetch-depth: 0` matters. The default shallow checkout only has the latest commit, so a secret
added and then "removed" in a later commit would be missed - even though it's still in history and
still compromised.

This directly follows from Session 12, where I showed a Secret's base64 decoding in one command:

```
$ kubectl get secret app-secret -o jsonpath='{.data.DB_PASSWORD}' | base64 -d
sup3rs3cret
```

base64 is encoding, not encryption. A secret in git is a plaintext secret in git.

[`.gitleaks.toml`](.gitleaks.toml) allowlists that one Session 12 file, because it holds a
deliberately fake teaching example. Allowlisting a known-safe path is fine; what you must not do is
disable the scanner because it's noisy.

### Container image scanning

Scans the **built image** - the OS packages in the base layer, not just your app. `node:20-alpine`
brings its own packages, and those get CVEs.

```yaml
- uses: aquasecurity/trivy-action@master
  with:
    image-ref: demo:${{ github.sha }}
    exit-code: '1'
    severity: CRITICAL,HIGH
    ignore-unfixed: true
```

`ignore-unfixed: true` skips CVEs with no patch available yet - otherwise the build fails on
something nobody can act on.

### Security gate

The gate isn't a separate job - it's `exit-code: '1'` on the Trivy step. A non-zero exit fails the
job, and `push-image` has `needs: image-scan`, so a failing scan means the image is never pushed and
never deployed.

That's the whole mechanism: **the gate is just a job that fails.**

Gates need to be tuned or they get bypassed - fail on CRITICAL/HIGH, report MEDIUM/LOW, ignore
unfixed. A gate that fails constantly gets disabled within a week, which is worse than no gate.

## Actual pipeline results

The workflow runs on this repo, and the first run **failed** - which turned out to be the useful
part. Four separate real problems, none of them invented:

| job | failure | root cause | fix |
|---|---|---|---|
| `sast` | CodeQL couldn't upload | job had no `security-events: write` permission | added the permission block |
| `sca` | `npm error code ENOLOCK` | `npm audit` requires a lockfile, and the repo doesn't commit one | `npm install --package-lock-only` first |
| `secret-scan` | `leaks found: 2` | gitleaks found my **deliberately fake** Session 12 secrets | root `.gitleaks.toml` allowlisting those teaching files |
| `image-scan` | `Total: 4 (HIGH: 4)` | real openssl CVEs in the `node:20-alpine` base | `RUN apk --no-cache upgrade` in the Dockerfile |

After those fixes, `build-and-test`, `sast`, `sca` and `secret-scan` all pass:

```
✓ build-and-test in 9s
✓ sca in 11s
✓ sast in 1m22s
✓ secret-scan in 5s
X image-scan in 28s
```

### The gate is still failing, on purpose

The openssl CVEs are gone - the `apk upgrade` is visible in the build log:

```
#7 [2/7] RUN apk --no-cache upgrade
#7 0.492 (1/2) Upgrading libapk (3.0.6-r0 -> 3.0.8-r0)
#7 0.505 (2/2) Upgrading apk-tools (3.0.6-r0 -> 3.0.8-r0)
```

But Trivy then finds vulnerabilities in the **npm packages bundled inside the base image itself**:

```
Total: 22 (HIGH: 21, CRITICAL: 1)
│ brace-expansion (package.json) │ CVE-2026-102276 │ HIGH │ fixed │ 2.0.1 │ ...
```

My application has **zero dependencies** - these ship inside `node:20-alpine` because the image
includes npm, and npm has its own dependency tree.

I left this failing rather than papering over it, because the honest options are all worse than
being clear about the trade-off:

- `severity: CRITICAL` only - weakens the gate to make it green
- `vuln-type: os` - tells Trivy to ignore application dependencies entirely
- `.trivyignore` the CVEs - suppressing a real finding
- **the actual fix:** a runtime image with no npm in it, like `gcr.io/distroless/nodejs20`, since
  the app doesn't need npm at runtime

The last one is correct and is what I'd do on a real project. Leaving the red X here demonstrates
the thing the task is actually about: **the gate works.** A failing scan means the image is never
pushed and never deployed. A gate that you tune until it passes is not a gate.

## Kubernetes security

[`kubernetes/deployment.yml`](kubernetes/deployment.yml) has a `securityContext`, which is the part
that's easy to leave out:

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
| `runAsNonRoot` | container root is close to node root if something escapes |
| `allowPrivilegeEscalation: false` | blocks setuid escalation inside the container |
| `readOnlyRootFilesystem` | an attacker can't write a payload to disk |
| `capabilities: drop ALL` | removes Linux capabilities the app never needs |

Plus resource limits (a compromised container can't exhaust the node) and both probes.

## Deliverables

| | where |
|---|---|
| Application | [Session 16 `app/`](../Session%2016%20-%20CI-CD%20&%20GitHub%20Actions/app/) |
| Dockerfile | [Session 16 `app/Dockerfile`](../Session%2016%20-%20CI-CD%20&%20GitHub%20Actions/app/Dockerfile) |
| GitHub Actions workflow | [`.github/workflows/devsecops.yml`](../.github/workflows/devsecops.yml) |
| Security tools config | [`.gitleaks.toml`](.gitleaks.toml), plus the scan jobs |
| Kubernetes manifests | [`kubernetes/`](kubernetes/) |

## What I took away

- SAST, SCA and secret scanning answer three different questions: *my code*, *my dependencies*,
  *my git history*. Image scanning adds a fourth: *my base image*. Skipping any one leaves a real gap.
- The gate is just a failing job plus `needs:`. There's no special "gate" feature.
- `fetch-depth: 0` for secret scanning, or you only scan the latest commit.
- Scans run before the image is built, so a doomed build fails in seconds rather than after a push.
