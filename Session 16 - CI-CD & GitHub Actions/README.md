# Session 16 - CI/CD & GitHub Actions

Ashutosh Kumar - 24bcs10111

Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) - it has to be at the repo root,
that is the only place GitHub looks.

App: [`app/`](app/) - a small Node HTTP server with tests and a Dockerfile.

## CI vs CD

**CI** - every push gets built and tested automatically, so you find out in minutes that something
broke instead of at release time.

**CD** is two things people mix up:

- **Continuous Delivery** - every passing build is ready to release, a human clicks deploy
- **Continuous Deployment** - every passing build goes to production automatically

This pipeline does CI properly. The CD half stops at building and testing the image, since there is
no cluster for Actions to deploy to.

## The pipeline

```
push to main
     |
  build-and-test      (checkout, node, install, test, artifact)
     |  needs:
  docker-build        (build image, run it, curl /health)
```

## Concepts

**Workflow** - the whole yml file.

**Trigger** (`on:`) - when it runs:

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:      # run it by hand from the Actions tab
```

**Jobs** - run in **parallel by default**, each on a fresh machine. `needs:` makes the order:

```yaml
docker-build:
  needs: build-and-test
```

That is what makes it a pipeline and not just a list. Because each job is a different machine,
nothing carries over, which is why docker-build checks out the code again.

**Steps** - run in order inside one job and share a filesystem. Either `uses:` (someone else's
action) or `run:` (a shell command).

**Runners** - `runs-on: ubuntu-latest` is GitHub's machine, fresh every time. That freshness is the
point, it catches "works on my machine".

**Secrets** - encrypted values from repo settings, used as `${{ secrets.NAME }}`, masked in logs.
Nothing secret is hardcoded in my workflow.

**Artifacts** - files kept after the run, since the runner is destroyed:

```yaml
- uses: actions/upload-artifact@v4
  with:
    name: test-results
    path: ${{ env.APP_DIR }}/test-results.txt
```

## The app

[`app/src/app.js`](app/src/app.js) is split out from the server so tests can import it without
starting a server:

```js
function greet(name) {
  if (!name) return "Hello World";
  return "Hello " + name;
}
```

Tests use Node's built-in runner, no Jest:

```bash
$ node --test test/*.test.js
# tests 3
# pass 3
# fail 0
```

This failed the first time. I had `"test": "node --test test/"` and Node 22 tried to load `test/`
as a module:

```
Error: Cannot find module '...\app\test'
# fail 1
```

Fixed by globbing the files instead of the directory. Worth running locally first, otherwise a
broken test script costs a whole CI run to find.

## Build

[`app/Dockerfile`](app/Dockerfile):

```dockerfile
FROM node:20-alpine
RUN apk --no-cache upgrade
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
RUN addgroup -S app && adduser -S app -G app
USER app
CMD ["node", "src/server.js"]
```

Two deliberate choices:

- package.json is copied **before** the source, so changing a source file does not re-run
  `npm install`. Copying everything at once would reinstall every build.
- `USER app` - containers run as root by default, which is a bad default.

## Pipeline execution

The docker-build job does not just build, it checks the image works:

```yaml
- name: Smoke test the image
  run: |
    docker run -d --name demo -p 3000:3000 cicd-demo:${{ github.sha }}
    sleep 5
    curl -f http://localhost:3000/health
    docker rm -f demo
```

`curl -f` returns non-zero on an HTTP error, so a container that builds but will not serve fails the
job. Only checking `docker build` exit code would pass a completely broken image.

Tagging with `${{ github.sha }}` means every image traces back to one commit, much more useful than
`:latest` when something breaks.

## Result

The workflow runs on this repo and passes:

```
✓ build-and-test in 12s
✓ docker-build in 14s
```

## Notes

- Jobs are parallel unless you write `needs:`. I expected top to bottom and that is not how it works.
- Each job is a clean machine so nothing persists between jobs, that is what artifacts are for.
- `workflow_dispatch` is worth adding to everything, re-running by hand beats pushing empty commits.
- Test the pipeline's commands locally first.
