# Session 16 - CI/CD & GitHub Actions

**Ashutosh Kumar** · **24bcs10111**

Workflow file: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) (has to live at the repo
root - GitHub only looks there).

Application: [`app/`](app/) - a small Node HTTP server with unit tests and a Dockerfile.

## CI vs CD

**CI (Continuous Integration)** - every push gets built and tested automatically. The point is to
find out within minutes that someone broke something, instead of at release time.

**CD** is two things people use interchangeably:

- **Continuous Delivery** - every passing build is *ready* to release, but a human clicks deploy.
- **Continuous Deployment** - every passing build goes to production automatically, no click.

This pipeline does CI properly, and the CD half stops at building and smoke-testing the image,
since there's no cluster for Actions to deploy to.

## The pipeline

```
push to main
     ↓
  job: build-and-test          (checkout → node → install → test → artifact)
     ↓  needs:
  job: docker-build            (build image → run it → curl /health)
```

## GitHub Actions concepts

**Workflow** - the whole `.yml` file. One file, one pipeline.

**Trigger** (`on:`) - when it runs:

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:      # lets me run it by hand from the Actions tab
```

**Jobs** - run in **parallel by default**, each on a fresh machine. `needs:` creates an order:

```yaml
docker-build:
  needs: build-and-test     # won't start unless tests passed
```

This is the bit that makes it a *pipeline* rather than a list. Because each job is a different
machine, nothing carries over between them - which is why `docker-build` checks out the code again.

**Steps** - run in order inside one job, sharing a filesystem. A step is either `uses:` (someone
else's action) or `run:` (a shell command).

**Runners** - the machine. `runs-on: ubuntu-latest` is GitHub's hosted runner, fresh every time.
That freshness is the point: it catches "works on my machine" because nothing is pre-installed
except what you ask for.

**Secrets** - encrypted values from repo settings, used as `${{ secrets.NAME }}`. They're masked in
logs. `GITHUB_TOKEN` is provided automatically. Nothing secret is hardcoded in my workflow.

**Artifacts** - files kept after the run finishes, since the runner is destroyed:

```yaml
- uses: actions/upload-artifact@v4
  with:
    name: test-results
    path: ${{ env.APP_DIR }}/test-results.txt
```

## The application

[`app/src/app.js`](app/src/app.js) is deliberately split out from the server so tests can import it
without binding a port:

```js
function greet(name) {
  if (!name) return "Hello World";
  return "Hello " + name;
}
```

[`app/test/app.test.js`](app/test/app.test.js) uses Node's built-in test runner - no Jest, no extra
dependency:

```js
test("greet with no name", () => {
  assert.strictEqual(greet(), "Hello World");
});
```

Run locally:

```bash
$ node --test test/*.test.js
# tests 3
# pass 3
# fail 0
# duration_ms 69.523
```

**This failed the first time.** I had `"test": "node --test test/"` and Node 22 tried to load
`test/` as a module:

```
Error: Cannot find module '...\app\test'
# fail 1
```

Fixed by globbing the files instead of the directory: `node --test test/*.test.js`. Worth doing
locally first - a broken test script would otherwise fail in CI and cost a full run to find out.

## Build

[`app/Dockerfile`](app/Dockerfile):

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
RUN addgroup -S app && adduser -S app -G app
USER app
EXPOSE 3000
CMD ["node", "src/server.js"]
```

Two deliberate choices:

- `package.json` is copied **before** the source. Docker caches layers, so changing a source file
  doesn't re-run `npm install`. Copying everything at once would reinstall on every build.
- `USER app` - containers run as root by default, which is a bad default. Session 17 enforces this
  with `runAsNonRoot` in Kubernetes.

## Test and pipeline execution

The `docker-build` job doesn't just build - it proves the image actually works:

```yaml
- name: Smoke test the image
  run: |
    docker run -d --name demo -p 3000:3000 cicd-demo:${{ github.sha }}
    sleep 5
    curl -f http://localhost:3000/health
    docker rm -f demo
```

`curl -f` returns non-zero on an HTTP error, so a container that builds but won't serve fails the
job. A build that only checks "did `docker build` exit 0" would pass a completely broken image.

Tagging with `${{ github.sha }}` means every image traces back to exactly one commit - much more
useful than `:latest` when something breaks in production.

## Deliverables

| | where |
|---|---|
| Application source | [`app/src/`](app/src/) |
| Tests | [`app/test/`](app/test/) |
| Dockerfile | [`app/Dockerfile`](app/Dockerfile) |
| GitHub Actions workflow | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) |
| CI pipeline | `build-and-test` job |
| CD pipeline | `docker-build` job |

The workflow runs on push to `main`, so its result is visible in the **Actions** tab of this repo.

## What I took away

- Jobs are parallel unless you write `needs:`. I expected top-to-bottom order and that's not how it
  works.
- Each job is a clean machine, so nothing persists between jobs - that's what artifacts are for.
- `workflow_dispatch` is worth adding to everything; re-running by hand while debugging beats
  pushing empty commits.
- Test the pipeline's commands locally first. My `npm test` bug would have been a wasted CI run.
