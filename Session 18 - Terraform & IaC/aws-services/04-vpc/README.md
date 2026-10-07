# VPC - Networking

## What is VPC?

Your own private network inside AWS. You choose the IP range, split it into subnets, and decide what
can reach the internet. Everything else (EC2, RDS, load balancers) lives inside it.

Every account gets a default VPC, which is convenient and not what you'd design yourself - all its
subnets are public.

## CIDR

The notation for an IP range: `10.0.0.0/16`.

The `/16` says the first 16 bits are fixed, so `10.0.x.x` - about 65,536 addresses. Smaller number
= bigger range.

| CIDR | addresses |
|---|---|
| /16 | 65,536 |
| /24 | 256 |
| /28 | 16 |

AWS reserves **5 addresses in every subnet** (network, router, DNS, future use, broadcast), so a
/24 gives you 251 usable, not 256.

The VPC CIDR **cannot be changed** after creation, so pick something roomy. Use private ranges
(`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), and don't overlap with networks you might peer
with later.

## Subnets

A slice of the VPC CIDR, and each subnet lives in **exactly one availability zone**. That's how you
get high availability - same app in subnets across two or three AZs.

```
VPC  10.0.0.0/16
├── 10.0.1.0/24  public   ap-south-1a
├── 10.0.2.0/24  public   ap-south-1b
├── 10.0.3.0/24  private  ap-south-1a
└── 10.0.4.0/24  private  ap-south-1b
```

## Route tables

A list of "traffic for this CIDR goes to that target". Every subnet is associated with one.

A route table always has a `local` route for the VPC CIDR, which is why everything in a VPC can
reach everything else by default.

## Internet Gateway

Attached to the VPC, lets traffic in and out of the internet. Horizontally scaled, no bandwidth
limit, nothing to manage.

Having one isn't enough - a subnet is only public if its **route table** sends `0.0.0.0/0` to the
IGW. That's the actual definition:

```
Destination     Target
10.0.0.0/16     local
0.0.0.0/0       igw-xxxx     ← this line makes it public
```

Instances also need a public IP.

## NAT Gateway

Lets instances in a **private** subnet reach the internet outbound (updates, API calls) while
nothing from outside can start a connection to them.

```
Destination     Target
10.0.0.0/16     local
0.0.0.0/0       nat-xxxx     ← private subnet route
```

The NAT gateway itself sits in a **public** subnet. Two gotchas: it costs money per hour *and* per
GB, and it's per-AZ, so a properly redundant setup needs one per AZ. It's often the surprise line on
a bill.

## Security Groups

Covered in the EC2 notes. Instance-level, **stateful**, allow-only.

## Network ACLs

Subnet-level firewall. Compared to security groups:

| | Security Group | Network ACL |
|---|---|---|
| level | instance | subnet |
| state | stateful | **stateless** |
| rules | allow only | allow **and** deny |
| evaluation | all rules together | numbered, first match wins |

**Stateless** is the one that catches people. If you allow inbound 443, the response going out is
*not* automatically allowed - you need an outbound rule too, usually for ephemeral ports
(1024-65535). Forget it and connections hang mysteriously.

Most of the time security groups are enough. NACLs are for a blanket deny, like blocking an IP range
across a whole subnet.

## Public vs private subnet

The only difference is the route table.

| | public | private |
|---|---|---|
| route for `0.0.0.0/0` | internet gateway | NAT gateway (or none) |
| inbound from internet | possible | no |
| outbound to internet | yes | via NAT |
| typical contents | load balancers, bastion, NAT GW | app servers, databases |

A normal design: load balancer in the public subnets, app servers and RDS in private ones. The
database should never have a route to an internet gateway.
