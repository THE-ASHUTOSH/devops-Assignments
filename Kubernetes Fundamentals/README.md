# Kubernetes Fundamentals

Ashutosh Kumar - 24bcs10111

minikube v1.39.0, Kubernetes v1.37.0, docker driver, Windows 11.

## Task 1 - Install Minikube

```bash
winget install -e --id Kubernetes.minikube
minikube start --driver=docker --cpus=2 --memory=3900
```

```
* minikube v1.39.0 on Microsoft Windows 11
* Using the docker driver based on user configuration
* Downloading Kubernetes v1.37.0 preload ...
* Enabled addons: storage-provisioner, default-storageclass
* Done! kubectl is now configured to use "minikube" cluster
```

Took about 3 minutes. The driver is the thing minikube runs the cluster inside, so with docker the
whole cluster is one container on my laptop.

It warned that my kubectl is 1.34.1 but the cluster is 1.37.0. Everything still worked.

## Task 2 - Verify the cluster

```bash
minikube status
```
```
host: Running
kubelet: Running
apiserver: Running
kubeconfig: Configured
```

```bash
kubectl get nodes -o wide
```
```
NAME       STATUS   ROLES           AGE    VERSION   INTERNAL-IP    CONTAINER-RUNTIME
minikube   Ready    control-plane   2m4s   v1.37.0   192.168.49.2   containerd://2.3.4
```

One node that is also the control plane. The runtime is containerd, not docker - docker is only
running the node itself.

First time I ran this it said NotReady, because the networking pod had not started yet.

## Task 3 - Architecture

```bash
kubectl get pods -n kube-system
```
```
coredns-559f6c778d-8lgc8           1/1   Running
etcd-minikube                      1/1   Running
kindnet-q8trz                      1/1   Running
kube-apiserver-minikube            1/1   Running
kube-controller-manager-minikube   1/1   Running
kube-proxy-tqz9s                   1/1   Running
kube-scheduler-minikube            1/1   Running
storage-provisioner                1/1   Running
```

This list is basically the architecture. Everything runs as a pod.

- **kube-apiserver** - everything talks to this, nothing talks to anything else directly
- **etcd** - the database, holds the whole cluster state
- **kube-scheduler** - picks a node for new pods, only decides, does not start anything
- **kube-controller-manager** - the loops that compare what you want with what exists
- **kubelet** - the agent on the node that actually runs the pods
- **kube-proxy** - makes Service IPs reach the right pods
- **kindnet** - the CNI, gives pods IPs. Node stays NotReady until this is up
- **CoreDNS** - cluster DNS, why service names work

The main idea is that it is declarative. I never say "start a container", I write what I want and a
loop fixes reality to match. That is why deleting a pod from a deployment just gives you a new one.

## Task 4 - Basic objects

- **Pod** - smallest unit, one or more containers
- **ReplicaSet** - keeps N copies running
- **Deployment** - manages ReplicaSets, gives rolling updates and rollback
- **Service** - fixed IP and name in front of changing pods
- **Namespace** - a folder to split a cluster
- **ConfigMap / Secret** - config and passwords kept out of the image

## Task 5 - Basics tutorial

```bash
kubectl create deployment hello-node \
  --image=registry.k8s.io/e2e-test-images/agnhost:2.39 \
  -- /agnhost netexec --http-port=8080
```

This failed first time. Git Bash on Windows changed `/agnhost` into a Windows path:

```
exec: "C:/Program Files/Git/agnhost": no such file or directory
```

Fixed with `export MSYS_NO_PATHCONV=1`. Then:

```
deployment.apps/hello-node    1/1   1   1
replicaset.apps/hello-node-6d9c6c8c6c   1   1   1
pod/hello-node-6d9c6c8c6c-vm8q6   1/1   Running
```

One command made three objects. I only asked for the Deployment.

Expose it:

```bash
kubectl expose deployment hello-node --type=NodePort --port=8080
kubectl run curlpod --image=curlimages/curl:8.10.1 --rm -i --restart=Never \
  -- curl -s http://hello-node:8080/hostname
```
```
hello-node-6d9c6c8c6c-vm8q6
```

Reached it by service name, so CoreDNS works.

Scale it:

```bash
kubectl scale deployment hello-node --replicas=4
```
```
hello-node-6d9c6c8c6c-cjjsk   1/1   Running   13s
hello-node-6d9c6c8c6c-jzsj4   1/1   Running   13s
hello-node-6d9c6c8c6c-p5jkf   1/1   Running   13s
hello-node-6d9c6c8c6c-vm8q6   1/1   Running   51s
```

Three new pods, original still there. The Service picked them up automatically because it matches
on the label.

## Notes

- `get` to list, `describe` for details. The Events at the bottom of describe is where the real
  error is.
- `--dry-run=client -o yaml` writes the YAML for you instead of typing it.
- Deleting a pod from a deployment does not work, you get a new one. Delete the deployment.
