# VPC - Networking

## What is VPC

Your own private network inside AWS. You pick the IP range, split it into subnets, and decide what
can reach the internet. Everything else lives inside it.

Every account gets a default VPC, which is convenient and not what you would design - all its
subnets are public.

## CIDR

The notation for an IP range, like `10.0.0.0/16`.

The /16 means the first 16 bits are fixed, so 10.0.x.x, about 65,536 addresses. Smaller number
means bigger range.

| CIDR | addresses |
|---|---|
| /16 | 65,536 |
| /24 | 256 |
| /28 | 16 |

AWS reserves **5 addresses in every subnet**, so a /24 gives 251 usable, not 256.

The VPC CIDR **cannot be changed** after creation, so pick something roomy. Use private ranges and
do not overlap with networks you might peer with later.

## Subnets

A slice of the VPC CIDR, and each one lives in **exactly one availability zone**. That is how you
get high availability - the same app in subnets across two or three AZs.

```
VPC  10.0.0.0/16
├── 10.0.1.0/24  public   ap-south-1a
├── 10.0.2.0/24  public   ap-south-1b
├── 10.0.3.0/24  private  ap-south-1a
└── 10.0.4.0/24  private  ap-south-1b
```

## Route tables

A list of "traffic for this CIDR goes to that target". Every subnet is attached to one.

There is always a `local` route for the VPC CIDR, which is why everything in a VPC can reach
everything else by default.

## Internet Gateway

Attached to the VPC, lets traffic in and out of the internet. Nothing to manage.

Having one is not enough. A subnet is only public if its **route table** sends 0.0.0.0/0 to the
IGW. That is the actual definition:

```
Destination     Target
10.0.0.0/16     local
0.0.0.0/0       igw-xxxx     <- this line makes it public
```

Instances also need a public IP.

## NAT Gateway

Lets instances in a **private** subnet reach the internet outbound (updates, API calls) while
nothing outside can start a connection to them.

```
Destination     Target
10.0.0.0/16     local
0.0.0.0/0       nat-xxxx
```

The NAT gateway itself sits in a **public** subnet. Two gotchas - it costs per hour *and* per GB,
and it is per-AZ so a redundant setup needs one per AZ. It is often the surprise line on a bill.

## Security Groups

Instance level, **stateful**, allow only. Covered in the EC2 notes.

## Network ACLs

Subnet level firewall.

| | Security Group | Network ACL |
|---|---|---|
| level | instance | subnet |
| state | stateful | **stateless** |
| rules | allow only | allow **and** deny |
| evaluation | all together | numbered, first match wins |

**Stateless** catches people. If you allow inbound 443 the response going out is *not* allowed
automatically, you need an outbound rule too, usually for ephemeral ports 1024-65535. Forget it and
connections hang for no obvious reason.

Most of the time security groups are enough. NACLs are for a blanket deny across a whole subnet.

## Public vs private subnet

The only difference is the route table.

| | public | private |
|---|---|---|
| route for 0.0.0.0/0 | internet gateway | NAT gateway or none |
| inbound from internet | possible | no |
| outbound | yes | via NAT |
| typically holds | load balancers, bastion, NAT | app servers, databases |

Normal design: load balancer in the public subnets, app servers and RDS in private ones. The
database should never have a route to an internet gateway.
