# GitOps

[`application.yml`](application.yml) points Argo CD at `final-devops-project/kubernetes` on `main`.

- `selfHeal: true` - a manual `kubectl` change gets reverted to what git says
- `prune: true` - deleting a manifest from git deletes the resource

Pull-based, so nothing outside the cluster needs cluster credentials. That's the main security
advantage over the push-based `deploy` job in the CI pipeline.

Flow:

```
PR → review → merge to main → Argo CD polls → diff → apply → keep reconciling
```
