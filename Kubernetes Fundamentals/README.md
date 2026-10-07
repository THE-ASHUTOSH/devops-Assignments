# Kubernetes Fundamentals

**Ashutosh Kumar** · **24bcs10111**

minikube v1.39.0, Kubernetes v1.37.0, Docker driver, on Windows 11.

## Task 1 - Install and configure Minikube

Installed with winget:

```bash
winget install -e --id Kubernetes.minikube
```

Then started it. minikube needs a "driver" - the thing it runs the cluster inside. I used Docker,
so the whole cluster is one container on my machine.

```bash
minikube start --driver=docker --cpus=2 --memory=3900
```

```
* minikube v1.39.0 on Microsoft Windows 11 Home Single Language 26H2
* Using the docker driver based on user configuration
* Using Docker Desktop driver with root privileges
* Starting "minikube" primary control-plane node in "minikube" cluster
* Pulling base image v0.0.51 ...
* Downloading Kubernetes v1.37.0 preload ...
* Configuring CNI (Container Networking Interface) ...
* Verifying Kubernetes components...
  - Using image gcr.io/k8s-minikube/storage-provisioner:v5
* Enabled addons: storage-provisioner, default-storageclass
! C:\Program Files\Docker\Docker\resources\bin\kubectl.exe is version 1.34.1, which may have
  incompatibilities with Kubernetes 1.37.0.
* Done! kubectl is now configured to use "minikube" cluster and "default" namespace by default
```

Took about 3 minutes, mostly downloading. Two things it told me:

- My `kubectl` is 1.34.1 (it came with Docker Desktop) but the cluster is 1.37.0. Kubernetes only
  supports one minor version of skew, so it warns. Everything I did still worked, but
  `minikube kubectl -- <cmd>` would give the exactly-matching version if something broke.
- It enabled `storage-provisioner` and `default-storageclass` on its own. That's what makes PVCs
  work later in Session 13.

## Task 2 - Verify cluster status

```bash
minikube status
```

```
minikube
type: Control Plane
host: Running
kubelet: Running
apiserver: Running
kubeconfig: Configured
```

```bash
kubectl cluster-info
```

```
Kubernetes control plane is running at https://127.0.0.1:62133
CoreDNS is running at https://127.0.0.1:62133/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy
```

```bash
kubectl get nodes -o wide
```

```
NAME       STATUS   ROLES           AGE    VERSION   INTERNAL-IP    OS-IMAGE                        CONTAINER-RUNTIME
minikube   Ready    control-plane   2m4s   v1.37.0   192.168.49.2   Debian GNU/Linux 12 (bookworm)  containerd://2.3.4
```

One node, and it's the control plane. On a real cluster you'd never run workloads on the control
plane, but minikube removes the taint so a single node can do both.

Worth noticing: the container runtime is **containerd**, not Docker. Docker is only being used to
run the node itself. Kubernetes dropped the Docker shim in 1.24.

The first time I ran `get nodes` it said `NotReady`. That was because the CNI pod hadn't started
yet - a node stays NotReady until networking is up.

## Task 3 - Explore Kubernetes architecture

```bash
kubectl get pods -n kube-system
```

```
NAME                               READY   STATUS    RESTARTS   AGE
coredns-559f6c778d-8lgc8           1/1     Running   0          56s
etcd-minikube                      1/1     Running   0          64s
kindnet-q8trz                      1/1     Running   0          56s
kube-apiserver-minikube            1/1     Running   0          64s
kube-controller-manager-minikube   1/1     Running   0          64s
kube-proxy-tqz9s                   1/1     Running   0          56s
kube-scheduler-minikube            1/1     Running   0          64s
storage-provisioner                1/1     Running   0          61s
```

This listing is basically the architecture diagram. Everything in the control plane is itself
running as a pod.

### Control plane

**kube-apiserver** - the front door. Every single thing (kubectl, the controllers, the kubelet)
talks to the API server, nothing talks to anything else directly. It validates requests and is the
only component that touches etcd.

**etcd** - the database. Key-value store holding the entire cluster state. If you back up etcd you
have backed up the cluster.

**kube-scheduler** - watches for pods with no node assigned, picks a node for them. It only decides;
it doesn't start anything.

**kube-controller-manager** - runs the control loops. A loop watches "what is desired" vs "what
exists" and fixes the gap. The deployment controller noticing it has 1 pod but wants 4 is this.

### Node components

**kubelet** - the agent on each node. It gets told which pods belong to it and makes the container
runtime actually run them. It's the one reporting back that the node is Ready.

**kube-proxy** - programs the networking rules so a Service IP reaches the right pods.

**container runtime** - containerd here.

**kindnet** - the CNI plugin, minikube's choice. It's what gives pods their IPs. This is the one
that has to be Running before the node goes Ready.

**CoreDNS** - cluster DNS. This is why I could `curl http://hello-node:8080` by name later.

### The thing that actually clicked

Kubernetes is **declarative**. I never say "start a container". I write down what I want and a
controller loop keeps reality matching it. That's why deleting a pod from a deployment just gets
you a new pod - I only deleted the pod, I didn't change what was wanted.

Also: nothing talks to anything but the API server. The scheduler doesn't call the kubelet. It
writes "this pod goes on node X" to the API server, the kubelet is watching, and picks it up.

## Task 4 - Basic objects and commands

```bash
kubectl api-resources | wc -l   # 72 resource types
```

The ones that matter to start:

- **Pod** - smallest unit. One or more containers sharing a network namespace. You rarely create
  one directly.
- **ReplicaSet** - keeps N copies of a pod running.
- **Deployment** - manages ReplicaSets, gives you rolling updates and rollback. This is what you
  actually write.
- **Service** - a stable IP and DNS name in front of a changing set of pods.
- **Namespace** - a folder to divide a cluster.
- **ConfigMap / Secret** - config and credentials, kept out of the image.

```bash
kubectl get namespaces
```

```
NAME              STATUS   AGE
default           Active   2m5s
ingress-nginx     Active   6s
kube-node-lease   Active   2m5s
kube-public       Active   2m5s
kube-system       Active   2m5s
```

## Task 5 - Basics tutorial hands-on

### Create a deployment

```bash
kubectl create deployment hello-node \
  --image=registry.k8s.io/e2e-test-images/agnhost:2.39 \
  -- /agnhost netexec --http-port=8080
```

**This failed the first time** and the reason is worth writing down. I'm on Git Bash on Windows,
and it rewrote the `/agnhost` argument into a Windows path before kubectl ever saw it:

```
Message: failed to create containerd task: ... unable to start container process:
exec: "C:/Program Files/Git/agnhost": stat C:/Program Files/Git/agnhost: no such file or directory
```

The pod went `RunContainerError` and kept restarting. Nothing wrong with Kubernetes - Git Bash
converts anything that looks like a Unix path. Fix is to turn that off:

```bash
export MSYS_NO_PATHCONV=1
```

After that:

```
deployment.apps/hello-node created
deployment.apps/hello-node condition met

NAME                         READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/hello-node   1/1     1            1           1s

NAME                                    DESIRED   CURRENT   READY   AGE
replicaset.apps/hello-node-6d9c6c8c6c   1         1         1       1s

NAME                              READY   STATUS    RESTARTS   AGE
pod/hello-node-6d9c6c8c6c-vm8q6   1/1     Running   0          1s
```

One command made three objects: Deployment → ReplicaSet → Pod. I only asked for the Deployment.
You can see the chain in the names - the pod is `<deployment>-<replicaset hash>-<random>`.

### Expose it

```bash
kubectl expose deployment hello-node --type=NodePort --port=8080
kubectl get svc hello-node
```

```
NAME         TYPE       CLUSTER-IP       EXTERNAL-IP   PORT(S)          AGE
hello-node   NodePort   10.100.140.243   <none>        8080:31937/TCP   0s
```

Reached it from another pod by service name, which is CoreDNS doing its job:

```bash
kubectl run curlpod --image=curlimages/curl:8.10.1 --restart=Never --rm -i \
  -- curl -s http://hello-node:8080/hostname
```

```
hello-node-6d9c6c8c6c-vm8q6
```

It replied with its own pod name, which is a handy way to see which pod answered.

### Scale it

```bash
kubectl scale deployment hello-node --replicas=4
kubectl get pods -l app=hello-node
```

```
NAME                          READY   STATUS    RESTARTS   AGE
hello-node-6d9c6c8c6c-cjjsk   1/1     Running   0          13s
hello-node-6d9c6c8c6c-jzsj4   1/1     Running   0          13s
hello-node-6d9c6c8c6c-p5jkf   1/1     Running   0          13s
hello-node-6d9c6c8c6c-vm8q6   1/1     Running   0          51s
```

Three new pods, same ReplicaSet hash, and the original one untouched at 51s. The Service picked
them up automatically because it selects on the label, not on names.

### Logs

```bash
kubectl logs -l app=hello-node --tail=3
```

```
I1007 16:33:52.496538       1 log.go:195] Started HTTP server on port 8080
I1007 16:33:52.496919       1 log.go:195] Started UDP server on port  8081
```

`-l` gets logs from every pod matching the label, not just one.

## Notes to self

- `kubectl get <thing>` → list, `describe` → details + the events at the bottom. The events are
  where the actual error is, every time.
- `-o wide` adds the pod IP and node. `-o yaml` gives the full object.
- `--dry-run=client -o yaml` on any `create` command generates the YAML without applying it, which
  is much faster than writing manifests from scratch.
- Deleting a pod that belongs to a deployment doesn't remove it - the controller makes a new one.
  Delete the deployment.
