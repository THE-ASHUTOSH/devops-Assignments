# Kubernetes Volumes

Containers have a writable layer, but it dies with the container. Volumes are how you keep data
around, or share it between containers.

## emptyDir

An empty directory created when the pod is scheduled, deleted when the pod goes away. Lives on the
node's disk (or RAM with `medium: Memory`).

[`emptydir.yml`](emptydir.yml) has two containers sharing one:

```yaml
volumes:
  - name: shared
    emptyDir: {}
```

The `writer` container writes a file, the `reader` container reads it:

```
$ kubectl get pod vol-emptydir
NAME           READY   STATUS    RESTARTS   AGE
vol-emptydir   2/2     Running   0          25s

$ kubectl logs vol-emptydir -c reader
written by writer
```

2/2 containers, and the second one saw the first one's file. That's the main use - two containers
in one pod passing files, like a sidecar writing logs that another ships off.

**It is not persistent.** Survives a container *restart*, but delete the pod and it's gone. Also
good for scratch space and caches.

## hostPath

Mounts a real directory from the **node** into the pod.

[`hostpath.yml`](hostpath.yml) mounts the node's `/tmp`:

```yaml
volumes:
  - name: host
    hostPath:
      path: /tmp
      type: Directory
```

```
$ kubectl logs vol-hostpath
gvisor
h.812
hostpath-provisioner
hostpath_pv
```

Those are real directories on the minikube node, not anything I created. `hostpath-provisioner` and
`hostpath_pv` are where minikube's own dynamic provisioner keeps PersistentVolumes - so I was
accidentally looking at the plumbing for the PVC section below.

**Mostly you should not use this.** The pod is tied to one node - reschedule it elsewhere and the
data isn't there. It's also a security hole, since mounting `/` or the Docker socket gives a pod
the node. Legitimate uses are node-level agents: a log collector reading `/var/log`, a monitoring
agent reading `/proc`. Those run as DaemonSets, where "one per node" is the point.

## PersistentVolume (PV)

A piece of storage in the cluster, as an object. It's a *resource* - like a node is compute, a PV
is storage. It exists independently of any pod.

A PV can be created by an admin by hand ("static provisioning"), or created automatically by a
StorageClass, which is what happened here.

## PersistentVolumeClaim (PVC)

A **request** for storage. The pod asks for "100Mi, ReadWriteOnce" and doesn't care where it comes
from.

[`pvc.yml`](pvc.yml):

```yaml
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 100Mi
```

The split is the point: developers write PVCs and never have to know whether it's EBS, NFS or a
local disk. Admins provide PVs or a StorageClass.

Access modes:

| mode | meaning |
|---|---|
| ReadWriteOnce (RWO) | one **node** can mount it read-write |
| ReadOnlyMany (ROX) | many nodes, read-only |
| ReadWriteMany (RWX) | many nodes read-write - needs NFS/CephFS, EBS can't do it |
| ReadWriteOncePod | exactly one pod |

RWO being per-*node* rather than per-pod catches people out.

## StorageClass

Describes a "type" of storage and, importantly, which provisioner creates it.

```
$ kubectl get storageclass
NAME                 PROVISIONER                RECLAIMPOLICY   VOLUMEBINDINGMODE   AGE
standard (default)   k8s.io/minikube-hostpath   Delete          Immediate           42m
```

`(default)` means a PVC that doesn't name a class gets this one. On EKS you'd see `gp2`/`gp3`
pointing at `ebs.csi.aws.com`; a cluster usually has several (fast SSD, cheap HDD).

**RECLAIMPOLICY: Delete** - delete the PVC and the underlying volume is destroyed too. The
alternative is `Retain`, which keeps the data for manual cleanup. Worth checking before you delete
a PVC in production.

**VOLUMEBINDINGMODE: Immediate** - provision as soon as the PVC is created. The other option,
`WaitForFirstConsumer`, waits until a pod is scheduled so the volume is made in the right
availability zone.

## Dynamic provisioning

This is the part that's nice to see rather than read about. I created **only a PVC** - no PV:

```
$ kubectl get pvc,pv
NAME                             STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS   AGE
persistentvolumeclaim/data-pvc   Bound    pvc-aafd773a-59e1-40c2-bcc8-065f3d576bdf   100Mi      RWO            standard       25s

NAME                                                        CAPACITY   ACCESS MODES   RECLAIM POLICY   STATUS   CLAIM              STORAGECLASS   AGE
persistentvolume/pvc-aafd773a-59e1-40c2-bcc8-065f3d576bdf   100Mi      RWO            Delete           Bound    default/data-pvc   standard        25s
```

A PV appeared on its own, named after the claim's UID, and the PVC went `Bound` to it. The
StorageClass's provisioner saw the claim and created storage to match. Without dynamic
provisioning an admin would have had to pre-create a PV and hope its size matched.

### Proving it actually persists

Wrote a file, deleted the pod, recreated it:

```
$ kubectl exec vol-pvc -- cat /data/persist.txt
survives a pod restart

$ kubectl delete pod vol-pvc
$ kubectl get pvc data-pvc
data-pvc   Bound    pvc-aafd773a-...   100Mi   RWO   standard   72s      <- still bound

$ kubectl apply -f pvc.yml       # new pod, same claim
$ kubectl exec vol-pvc -- cat /data/persist.txt
survives a pod restart
```

Same content. The PVC outlived the pod entirely - that's the whole difference from emptyDir, where
deleting the pod takes the data with it.

## Summary

| | lifetime | shared between pods | survives reschedule |
|---|---|---|---|
| emptyDir | the pod | no, within one pod only | no |
| hostPath | the node's disk | only pods on that node | no |
| PVC/PV | independent of pods | depends on access mode | yes |

Rule of thumb: scratch space → emptyDir. Node agent → hostPath. Anything you'd be upset to lose →
PVC.
