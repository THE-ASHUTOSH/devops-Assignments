# EC2 - Compute

## What is EC2

Virtual machines. Pick an image, a size and a network and you get a server you have root on. It is
the most "normal computer" service, which is also why you manage the most. Billed per second while
running.

## AMI

The image an instance boots from - OS plus whatever is pre-installed. AWS-provided (Amazon Linux,
Ubuntu), from the Marketplace, or built by you.

AMIs are **per region**. An AMI id from ap-south-1 is not valid in us-east-1, which catches people
copy-pasting Terraform between regions.

## Instance types

`family.size`, like `t3.micro`.

| family | for |
|---|---|
| T | general purpose, burstable - dev boxes, small sites |
| M | general purpose, steady - app servers |
| C | compute heavy |
| R | memory heavy - caches, in-memory DBs |
| G / P | GPU - ML |

T-family runs on CPU credits and slows down under sustained load once they run out. Fine for dev,
bad for a busy server.

## Key pairs

An SSH keypair. AWS keeps the public key, you download the .pem **once**.

```bash
chmod 400 mykey.pem
ssh -i mykey.pem ec2-user@<public-ip>
```

Username depends on the AMI - `ec2-user` for Amazon Linux, `ubuntu` for Ubuntu. Lose the .pem and
you cannot SSH in. Session Manager avoids needing SSH at all and is the better modern answer.

## Security Groups

A **stateful** firewall on the instance.

- Allow rules only, you cannot write a deny rule
- Default is all inbound blocked, all outbound allowed
- Stateful means if you allow traffic in, the reply is allowed out automatically

A source can be a CIDR **or another security group**, which is the nice part - "allow the web tier
to reach the DB tier on 3306" without caring about IPs.

## EBS

Network-attached disk. Survives a stop/start, instance store does not.

- gp3 is the normal SSD choice, io2 for high-IOPS databases
- snapshots go to S3 and are incremental
- a volume lives in **one AZ** and can only attach to an instance in that AZ

## Public vs private IP

| | private | public |
|---|---|---|
| range | 10.x, 172.16-31.x, 192.168.x | routable |
| changes? | fixed for the instance's life | **changes on stop/start** |
| needs | nothing | an internet gateway |

That "changes on stop/start" is why Elastic IPs exist.

Instances in a private subnet have no public IP and reach the internet through a NAT gateway.

## Lifecycle

```
pending -> running -> stopping -> stopped -> terminated
```

- **stop** - volume kept, no compute charge, public IP lost
- **terminate** - gone, root volume deleted by default
- **reboot** - same host, keeps its public IP
- **hibernate** - saves RAM to disk and restores it

Stop vs terminate is the one to be careful with.

## Common use cases

- Web and app servers
- Anything needing a specific OS or kernel module
- Lift and shift of an on-prem server
- Build agents / CI runners
- Bastion host into a private subnet
