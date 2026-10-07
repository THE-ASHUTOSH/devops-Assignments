# Kubernetes Volumes

A container's writable layer dies with the container. Volumes are how you keep data or share it
between containers.

## emptyDir

An empty directory made when the pod starts, deleted when the pod goes. [`emptydir.yml`](emptydir.yml)
has two containers sharing one:

```yaml
volumes:
  - name: shared
    emptyDir: {}
```

The writer container writes a file, the reader reads it:

```
$ kubectl get pod vol-emptydir
NAME           READY   STATUS    AGE
vol-emptydir   2/2     Running   25s

$ kubectl logs vol-emptydir -c reader
written by writer
```

2/2 containers and the second one saw the first one's file. Main use is two containers in one pod
passing files, like a sidecar shipping logs.

It is not persistent. Survives a container restart, but delete the pod and it is gone.

## hostPath

Mounts a real directory from the **node**. [`hostpath.yml`](hostpath.yml) mounts the node's /tmp:

```
$ kubectl logs vol-hostpath
gvisor
h.812
hostpath-provisioner
hostpath_pv
```

Those are real directories on the minikube node. `hostpath-provisioner` and `hostpath_pv` are where
minikube keeps PersistentVolumes, so I was accidentally looking at the plumbing for the PVC section
below.

Mostly you should not use this. The pod is tied to one node, so reschedule it and the data is not
there. It is also a security hole since mounting `/` gives a pod the node. Legitimate uses are node
agents - a log collector reading /var/log, a monitoring agent reading /proc. Those run as
DaemonSets.

## PersistentVolume

A piece of storage in the cluster, as an object. Like a node is compute, a PV is storage. It exists
on its own, separate from any pod.

Can be created by an admin by hand, or automatically by a StorageClass, which is what happened here.

## PersistentVolumeClaim

A request for storage. The pod asks for "100Mi, ReadWriteOnce" and does not care where it comes
from.

```yaml
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 100Mi
```

The split is the point - developers write PVCs and never need to know if it is EBS, NFS or a local
disk.

Access modes:

| mode | meaning |
|---|---|
| ReadWriteOnce | one **node** can mount it read-write |
| ReadOnlyMany | many nodes, read only |
| ReadWriteMany | many nodes read-write, needs NFS, EBS cannot do it |
| ReadWriteOncePod | exactly one pod |

ReadWriteOnce being per node rather than per pod catches people out.

## StorageClass

Describes a type of storage and which provisioner makes it.

```
$ kubectl get storageclass
NAME                 PROVISIONER                RECLAIMPOLICY   VOLUMEBINDINGMODE   AGE
standard (default)   k8s.io/minikube-hostpath   Delete          Immediate           42m
```

`(default)` means a PVC that does not name a class gets this one. On EKS you would see gp2 or gp3.

**RECLAIMPOLICY Delete** - delete the PVC and the volume is destroyed too. The other option is
Retain. Worth checking before deleting a PVC in production.

**VOLUMEBINDINGMODE Immediate** - make it as soon as the PVC exists. The other option
WaitForFirstConsumer waits until a pod is scheduled so the volume is made in the right AZ.

## Dynamic provisioning

This is the nice one to actually see. I created **only a PVC**, no PV:

```
NAME                             STATUS   VOLUME                 CAPACITY   STORAGECLASS
persistentvolumeclaim/data-pvc   Bound    pvc-aafd773a-...       100Mi      standard

NAME                                CAPACITY   RECLAIM POLICY   STATUS   CLAIM
persistentvolume/pvc-aafd773a-...   100Mi      Delete           Bound    default/data-pvc
```

A PV appeared on its own, named after the claim's UID, and the PVC bound to it. Without dynamic
provisioning an admin would have had to make a PV first and hope the size matched.

### Proving it persists

```
$ kubectl exec vol-pvc -- cat /data/persist.txt
survives a pod restart

$ kubectl delete pod vol-pvc
$ kubectl get pvc data-pvc
data-pvc   Bound   pvc-aafd773a-...   100Mi   standard   72s     <- still bound

$ kubectl apply -f pvc.yml       # new pod, same claim
$ kubectl exec vol-pvc -- cat /data/persist.txt
survives a pod restart
```

Same content. The PVC outlived the pod, which is the whole difference from emptyDir.

## Summary

| | lifetime | shared | survives reschedule |
|---|---|---|---|
| emptyDir | the pod | within one pod | no |
| hostPath | the node | pods on that node | no |
| PVC/PV | its own | depends on access mode | yes |

Rule of thumb: scratch space is emptyDir, node agent is hostPath, anything you would be upset to
lose is a PVC.
