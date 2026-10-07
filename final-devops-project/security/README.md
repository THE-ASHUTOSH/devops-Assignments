# Security configuration

Scanners used in the pipeline, and what each one is responsible for.

| stage | tool | scans |
|---|---|---|
| SAST | CodeQL | our own source code |
| SCA | npm audit | our dependencies |
| Secret scan | gitleaks | full git history |
| Image scan | Trivy | the built container image |

The gate is `exit-code: '1'` on Trivy plus `needs:` on the push job - a failing scan means the
image never gets pushed.

See [`.gitleaks.toml`](.gitleaks.toml) for the secret-scanner config.

## Hardening applied to the workload

- non-root user in the Dockerfile (`USER app`)
- `runAsNonRoot`, `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem`, `drop: ALL` in the
  pod securityContext
- resource limits so a compromised container can't exhaust the node
- ECR configured with `scan_on_push` and `IMMUTABLE` tags, so an image tag can't be swapped after
  it passed its scan
