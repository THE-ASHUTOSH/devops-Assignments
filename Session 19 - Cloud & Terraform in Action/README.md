# Session 19 - Cloud & Terraform in Action

Ashutosh Kumar - 24bcs10111

End to end infrastructure in [`infra/`](infra/) - VPC, subnet, security group, EC2 and S3.

## Architecture

```
                Internet
                    |
            [Internet Gateway]
                    |
    +---------------+---------------+
    |  VPC  10.0.0.0/16             |
    |                               |
    |  +-------------------------+  |
    |  | Public subnet           |  |
    |  | 10.0.1.0/24             |  |
    |  |                         |  |
    |  |   [EC2 t3.micro]        |  |
    |  |    nginx on :80         |  |
    |  |    SG: allow 80 in      |  |
    |  +-------------------------+  |
    |                               |
    |  route: 0.0.0.0/0 -> igw      |
    +-------------------------------+

    [S3 bucket] - public access blocked
```

## Files

```
infra/
├── provider.tf     terraform + aws provider
├── variables.tf    region, project, CIDRs, instance type
├── network.tf      VPC, IGW, subnet, route table
├── security.tf     security group
├── compute.tf      AMI lookup + EC2
├── storage.tf      S3 bucket
└── outputs.tf      vpc id, public ip, url, bucket
```

Terraform reads every .tf in the folder, so the split is just for humans.

## Concepts

### Providers

```hcl
required_providers {
  aws = {
    source  = "hashicorp/aws"
    version = "~> 5.0"
  }
}
```

`~> 5.0` allows 5.x but not 6.0, so a major release does not silently break things.

### Variables

Every value that might change is a variable. Nothing environment-specific is hardcoded, so the same
code does dev and prod with a different tfvars.

### Resources

Ten of them:

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

The AMI is looked up, not hardcoded:

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
are per region, so hardcoding one means the config only works in one region.

### Dependencies

I never wrote an order anywhere. Terraform builds it from the references:

```
aws_vpc.main
   ├── aws_internet_gateway.main   (vpc_id = aws_vpc.main.id)
   ├── aws_subnet.public           (vpc_id = aws_vpc.main.id)
   └── aws_security_group.web      (vpc_id = aws_vpc.main.id)
             |
aws_route_table.public  (gateway_id = aws_internet_gateway.main.id)
             |
aws_instance.web  (subnet_id, vpc_security_group_ids)
```

The EC2 instance references the subnet and the security group, so it is made last automatically.
The VPC is first because everything references it. The S3 bucket references nothing so it is made
in parallel.

This is also why destroy works, it walks the same graph backwards.

### Outputs

```hcl
output "website_url" {
  value = "http://${aws_instance.web.public_ip}"
}
```

Values only known after apply.

### User data

The instance sets itself up:

```bash
#!/bin/bash
dnf install -y nginx
echo "<h1>Hello from Terraform</h1>" > /usr/share/nginx/html/index.html
systemctl enable --now nginx
```

So it comes up already serving, no manual SSH step.

## State

terraform.tfstate maps the config to real AWS ids. Terraform compares config, state and reality on
every run and changes only the difference.

It is gitignored because it can hold sensitive values. On a team it goes in an S3 backend with
DynamoDB locking:

```hcl
backend "s3" {
  bucket         = "my-tf-state"
  key            = "demo/terraform.tfstate"
  dynamodb_table = "tf-locks"
  encrypt        = true
}
```

## Commands

No AWS account configured, so init, fmt and validate are real and the apply cycle is documented.

```
$ terraform validate
Success! The configuration is valid.
```

That is a genuine check - it verified all ten resources, every attribute name and that each
reference resolves. A typo in `aws_vpc.main.id` would fail here.

`terraform fmt -check -recursive` - exit 0.

`terraform plan` would show `Plan: 10 to add, 0 to change, 0 to destroy.`

`terraform apply` creates in dependency order, VPC first and EC2 last, then prints:

```
Outputs:
instance_public_ip = "13.xxx.xxx.xxx"
website_url        = "http://13.xxx.xxx.xxx"
vpc_id             = "vpc-0abc123"
bucket_name        = "devops-demo-assets-24bcs10111"
```

`terraform destroy` removes everything in reverse order. Important with real AWS, an idle setup
still bills.

Note: `terraform init` here could not download the provider because the machine had no DNS to
releases.hashicorp.com. I reused the provider already downloaded in Session 18, which is what the
lock file is for - it pins the exact version so both projects resolve the same.

## Notes

- The dependency graph comes free from references. Writing an explicit order is usually a sign you
  referenced something wrong.
- `data` sources are the fix for hardcoded ids and why the same code works across regions.
- State is the whole design. Lose it and Terraform does not know what it made.
