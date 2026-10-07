# EC2 - Compute

## What is EC2?

Virtual machines. You pick an OS image, a size and a network, and get a server you have root on.
It's the most "normal computer" service, which is also why you manage the most. Billed per second
while running.

## AMI

The image an instance boots from - OS plus whatever is pre-installed. Can be AWS-provided (Amazon
Linux, Ubuntu), from the Marketplace, or built by you so new instances come up ready.

AMIs are **region-specific**. An AMI id from `ap-south-1` isn't valid in `us-east-1`, which catches
people copy-pasting Terraform between regions.

## Instance types

Named `family.size`, e.g. `t3.micro`.

| family | for |
|---|---|
| T | general purpose, burstable - dev boxes, small sites |
| M | general purpose, steady - app servers |
| C | compute optimised - CPU-heavy work |
| R | memory optimised - caches, in-memory DBs |
| G / P | GPU - ML |

T-family runs on CPU credits and slows down under sustained load once they run out. Fine for a dev
box, bad for a busy server.

## Key pairs

An SSH keypair. AWS keeps the public key and puts it in the instance; you download the `.pem`
private key **once**.

```bash
chmod 400 mykey.pem
ssh -i mykey.pem ec2-user@<public-ip>
```

Username depends on the AMI - `ec2-user` for Amazon Linux, `ubuntu` for Ubuntu. Lose the .pem and
you can't SSH in. Session Manager avoids needing SSH at all and is the better modern answer.

## Security Groups

A **stateful** firewall on the instance's network interface.

- Allow rules only - you can't write a deny rule
- Default: all inbound blocked, all outbound allowed
- Stateful means if you allow traffic in, the reply is automatically allowed out

A source can be a CIDR **or another security group**, which is the nice part - "allow the web tier
SG to reach the DB tier SG on 3306" without caring about IPs.

## EBS

Network-attached disk. Survives a stop/start; instance store does not.

- `gp3` is the normal SSD choice, `io2` for high-IOPS databases
- snapshots go to S3 and are incremental
- an EBS volume lives in **one availability zone** and can only attach to an instance in that AZ

## Public vs private IP

| | private IP | public IP |
|---|---|---|
| range | `10.x`, `172.16-31.x`, `192.168.x` | routable internet address |
| changes? | fixed for the instance's life | **changes on stop/start** |
| needs | nothing | an internet gateway |

That "changes on stop/start" is why Elastic IPs exist - a static public IP you own.

Instances in a private subnet have no public IP and reach the internet outbound through a NAT
gateway.

## Instance lifecycle

```
pending → running → stopping → stopped → terminated
```

- **stop** - EBS root volume kept, no compute charge, public IP lost
- **terminate** - gone, root volume deleted by default
- **reboot** - same host, keeps its public IP
- **hibernate** - saves RAM to the root volume and restores it

Stop vs terminate is the one to be careful with.

## Common use cases

- Web and app servers
- Anything needing a specific OS or kernel module a managed service won't give you
- Lift-and-shift of an existing on-prem server
- Build agents / CI runners
- Bastion host into a private subnet
