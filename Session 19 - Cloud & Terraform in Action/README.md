# Session 19 - Cloud & Terraform in Action

**Ashutosh Kumar** · **24bcs10111**

End-to-end infrastructure in [`infra/`](infra/) - VPC, subnet, security group, EC2 and S3, wired
together.

## Architecture

```
                    Internet
                       │
                [Internet Gateway]
                       │
        ┌──────────────┴──────────────┐
        │  VPC  10.0.0.0/16           │
        │                             │
        │  ┌────────────────────────┐ │
        │  │ Public subnet          │ │
        │  │ 10.0.1.0/24            │ │
        │  │                        │ │
        │  │   [EC2 t3.micro]       │ │
        │  │    nginx on :80        │ │
        │  │    SG: allow 80 in     │ │
        │  └────────────────────────┘ │
        │                             │
        │  route table: 0.0.0.0/0 → igw
        └─────────────────────────────┘

        [S3 bucket] - assets, public access blocked
```

## File layout

Split by concern rather than one big `main.tf`:

```
infra/
├── provider.tf     terraform + aws provider, version pins
├── variables.tf    region, project name, CIDRs, instance type
├── network.tf      VPC, IGW, subnet, route table + association
├── security.tf     security group
├── compute.tf      AMI lookup + EC2 instance
├── storage.tf      S3 bucket + public access block
└── outputs.tf      vpc id, public ip, url, bucket name
```

Terraform reads every `.tf` in the directory, so the split is purely for humans.

## Terraform concepts demonstrated

### Providers

```hcl
required_providers {
  aws = {
    source  = "hashicorp/aws"
    version = "~> 5.0"
  }
}
```

`~> 5.0` allows 5.x but not 6.0, so a major release doesn't silently break the config.

### Variables

Every value that might change is a variable - region, project name, CIDRs, instance type. Nothing
environment-specific is hardcoded, so the same code does dev and prod with a different `.tfvars`.

### Resources

Ten resources across the five files:

```
aws_vpc.main
aws_internet_gateway.main
aws_subnet.public
aws_route_table.public
aws_route_table_association.public
aws_security_group.web
aws_instance.web
aws_s3_bucket.assets
aws_s3_bucket_public_access_block.assets
data.aws_ami.amazon_linux
```

### Data sources

The AMI is **looked up**, not hardcoded:

```hcl
data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
}
```

A `data` block reads existing infrastructure instead of creating it. This matters because AMI ids
are region-specific - hardcoding one means the config only works in one region.

### Dependencies

I never wrote an ordering anywhere. Terraform builds the graph from references:

```
aws_vpc.main
   ├── aws_internet_gateway.main   (vpc_id = aws_vpc.main.id)
   ├── aws_subnet.public           (vpc_id = aws_vpc.main.id)
   └── aws_security_group.web      (vpc_id = aws_vpc.main.id)
             │
aws_route_table.public  (gateway_id = aws_internet_gateway.main.id)
             │
aws_route_table_association.public
             │
aws_instance.web  (subnet_id, vpc_security_group_ids)
```

`aws_instance.web` references both the subnet and the security group, so it's created last
automatically. The VPC is created first because everything references it. Independent things (like
the S3 bucket) are created in parallel.

This is why `terraform destroy` works too - it walks the same graph backwards.

### Outputs

```hcl
output "website_url" {
  value = "http://${aws_instance.web.public_ip}"
}
```

Values only known after apply, printed at the end and readable later with `terraform output`.

### User data

The EC2 instance bootstraps itself:

```bash
#!/bin/bash
dnf install -y nginx
echo "<h1>Hello from Terraform</h1>" > /usr/share/nginx/html/index.html
systemctl enable --now nginx
```

So the infrastructure comes up already serving - no manual SSH step.

## Terraform state

`terraform.tfstate` maps config to real AWS resource ids. Terraform compares three things on every
run: the config, the state, and reality - then changes only the difference.

It's in `.gitignore` because it can hold sensitive values. On a team it belongs in an S3 backend
with DynamoDB locking so two people can't apply at once:

```hcl
backend "s3" {
  bucket         = "my-tf-state"
  key            = "demo/terraform.tfstate"
  region         = "ap-south-1"
  dynamodb_table = "tf-locks"
  encrypt        = true
}
```

## Commands

I have no AWS account configured (per the course setup), so `init`, `fmt` and `validate` are real
runs here and the apply cycle is documented.

**`terraform validate`** - real output:

```
Success! The configuration is valid.
```

That's a genuine check: it verified all ten resources, every attribute name, and that each
reference resolves. A typo in `aws_vpc.main.id` would fail here.

**`terraform fmt -check -recursive`** - exit 0, already formatted.

**`terraform plan`** would show `Plan: 10 to add, 0 to change, 0 to destroy.`

**`terraform apply`** creates in dependency order - VPC first, EC2 last - then prints:

```
Outputs:
instance_public_ip = "13.xxx.xxx.xxx"
website_url        = "http://13.xxx.xxx.xxx"
vpc_id             = "vpc-0abc123"
bucket_name        = "devops-demo-assets-24bcs10111"
```

**`terraform destroy`** removes everything in reverse order. Important with real AWS - a `t3.micro`
plus an idle setup still bills.

> Note on the provider: `terraform init` here failed to download because the environment I was
> working in had no outbound DNS for `releases.hashicorp.com`. I reused the provider already
> downloaded in Session 18's project, which is what the `.terraform.lock.hcl` is for - it pins the
> exact provider version so two projects resolve identically.

## Deliverables

| | where |
|---|---|
| Terraform project | [`infra/`](infra/) |
| AWS resources | VPC, IGW, subnet, route table, SG, EC2, S3 |
| Architecture diagram | top of this file |
| Terraform commands | above |

## What I took away

- The dependency graph comes **free from references**. Writing explicit ordering is almost always a
  sign you referenced something wrong. (`depends_on` exists for the rare case with no reference.)
- `data` sources are the fix for hardcoded ids, and the reason the same code works across regions.
- State is the whole design. Lose it and Terraform doesn't know anything it made; share it badly and
  two applies collide.
- The S3 bucket has no reference to anything else, so Terraform creates it in parallel with the
  network - visible in the graph.
