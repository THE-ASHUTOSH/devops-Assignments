# DevOps Assignments

Homework for the DevOps sessions - Linux, shell, networking, git, Docker, Kubernetes, Helm, CI/CD,
Terraform and a final project.

Ashutosh Kumar - 24bcs10111

Each section has its own folder with a README containing the commands I ran and the actual output.

## Sections

| # | section | what is in it |
|---|---|---|
| 1 | [Linux Fundamental](Linux%20Fundamental/) | soft vs hard links, adduser vs useradd, journalctl, cheat sheet |
| 2 | [Shell Scripting](Shell%20Scripting/) | `info.sh` - system info script with read -p, mkdir, touch, redirection |
| 3 | [Netwroking Fundamentals](Netwroking%20Fundamentals/) | ip, routing, ping, traceroute, dig, curl, ss, tcpdump, nmap |
| 4 | [Git-GitHub](Git-GitHub/) | `commit -m` vs `commit -a -m`, and a cherry-pick |
| 5 | [Docker Fundamental](Docker%20Fundamental/) | six Hello World apps - node, python, java, apache, react, nginx |
| 6 | [Dockerfiles & Images](Dockerfiles%20%26%20Images/) | multi-stage build on 8080, 471MB down to 20.6MB |
| 7 | [Docker Network](Docker%20Network/) | 3 containers, 3 networks, host network, bind mount, overlay notes |
| 8 | [Kubernetes Fundamentals](Kubernetes%20Fundamentals/) | minikube setup, cluster check, architecture, basics tutorial |
| 9 | [Session 10 - Pods, ReplicaSets & Deployments](Session%2010%20-%20Pods,%20ReplicaSets%20&%20Deployments/) | all 4 deployment strategies + pod lifecycle |
| 10 | [Session 11 - Networking & Services](Session%2011%20-%20Networking%20&%20Services/) | all 5 Service types, comparisons, fqdn, coredns |
| 11 | [Session 12 - Ingress, ConfigMaps & Secrets](Session%2012%20-%20Ingress,%20ConfigMaps%20&%20Secrets/) | ConfigMap, Secret, Ingress, a 3-bug debug |
| 12 | [Session 13 - Storage, HPA & Probes](Session%2013%20-%20Storage,%20HPA%20&%20Probes/) | volumes, dynamic provisioning, HPA 1 to 9 to 1, probes |
| 13 | [Session 14 - Troubleshooting](Session%2014%20-%20Troubleshooting/) | kubectl commands and every common pod failure |
| 14 | [Session 15 - Helm](Session%2015%20-%20Helm/) | helm commands, install to upgrade to rollback |
| 15 | [Session 16 - CI-CD & GitHub Actions](Session%2016%20-%20CI-CD%20&%20GitHub%20Actions/) | Node app, tests, Dockerfile, a real workflow |
| 16 | [Session 17 - DevSecOps](Session%2017%20-%20DevSecOps/) | SAST, SCA, secret scanning, image scanning, the gate |
| 17 | [Session 18 - Terraform & IaC](Session%2018%20-%20Terraform%20&%20IaC/) | S3 demo + five AWS service write-ups |
| 18 | [Session 19 - Cloud & Terraform in Action](Session%2019%20-%20Cloud%20&%20Terraform%20in%20Action/) | VPC, subnet, SG, EC2 and S3 in one project |
| 19 | [Session 20 - Monitoring, Observability & GitOps](Session%2020%20-%20Monitoring,%20Observability%20&%20GitOps/) | metrics, logs, traces, Argo CD |
| 20 | [final-devops-project](final-devops-project/) | everything above on one app |

Folder names follow the headings in the assignment doc. A few had to change: `Git/GitHub` became
`Git-GitHub` and `Session 16: CI/CD` became `Session 16 - CI-CD`, because a folder name cannot have
a slash. `Netwroking Fundamentals` keeps the doc's spelling.

The workflows GitHub actually runs are in [`.github/workflows/`](.github/workflows/) at the root,
since that is the only place it looks.

## Things worth calling out

- The journalctl section runs against a container booting systemd as PID 1, so `systemctl status`
  and `journalctl -u nginx` give real output. I broke the nginx config on purpose to show a failed
  unit in the journal.
- The multi-stage section builds the same Go app twice, one stage vs two, so the 471MB to 20.6MB
  difference is measured rather than quoted.
- The host-network task failed the first time because port 80 was in use, and I left that in.
- The rolling update section catches the cluster mid-rollout with two ReplicaSets live at once,
  which is the clearest way to see how a Deployment works.
- The HPA section has the real scale up (1 to 9 pods at 183% CPU) and the six minute wait before it
  scaled back down.
- Several sections keep the failures and their causes rather than only the clean run. A cluster-wide
  ImagePullBackOff that turned out to be an IPv6 DNS problem, and a RunContainerError caused by Git
  Bash rewriting a path, were both more useful than the fix.
- Screenshots were taken with playwright against the live containers for the Docker tasks. The
  Kubernetes sections are terminal work so those keep the command output.

## Real vs documented

Sections 1-16 and 19 were actually run and the output is pasted as it came out.

Terraform (17, 18 and the final project) is code only. `init`, `fmt` and `validate` are real runs,
but `plan` and `apply` need AWS credentials I did not want to use for coursework, so those are
documented. All Kubernetes manifests in the final project were checked with
`kubectl apply --dry-run=server`, and the Helm chart with `helm lint` and `helm template`.

## Ran on

Sections 1-7 were on macOS (Apple silicon), Docker Desktop 29.7.2. Everything from section 8 on is
Windows 11 with Docker Desktop 29.3.1, minikube v1.39.0, Kubernetes v1.37.0, Helm v4.3.0 and
Terraform v1.16.5. Linux-specific bits run inside ubuntu:24.04 containers.

One Windows thing that cost me time: Git Bash rewrites anything that looks like a Unix path before
the command sees it, which broke `kubectl create deployment ... -- /agnhost`. Fixed with
`export MSYS_NO_PATHCONV=1`.
