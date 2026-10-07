# Session 18 - Terraform & Infrastructure as Code

**Ashutosh Kumar** · **24bcs10111**

Terraform v1.16.5, AWS provider v5.100.0, Windows 11.

## Task 1 - Terraform S3 demo

Code is in [`terraform-s3-demo/`](terraform-s3-demo/), split the usual way:

```
provider.tf       terraform block + aws provider
variables.tf      region, bucket name, environment
main.tf           the bucket and its settings
outputs.tf        what to print after apply
terraform.tfvars  actual values
```

I kept them as separate files instead of one big `main.tf` because that's the normal layout and
it's easier to find things.

### Commands I ran

`terraform init` - downloads the provider:

```
Initializing provider plugins...
- Finding hashicorp/aws versions matching "~> 5.0"...
- Installing hashicorp/aws v5.100.0...
- Installed hashicorp/aws v5.100.0 (signed by HashiCorp)

Terraform has been successfully initialized!
```

`terraform fmt -check -recursive` - printed nothing and exit code 0, so formatting was already fine.

`terraform validate`:

```
Success! The configuration is valid.
```

`terraform plan` - this is the first one that actually talks to AWS, and I don't have an account
set up, so it failed:

```
Planning failed. Terraform encountered an error while generating this plan.

│ Error: No valid credential sources found
│
│   with provider["registry.terraform.io/hashicorp/aws"],
│   on provider.tf line 12, in provider "aws":
│   12: provider "aws" {
│
│ Error: failed to refresh cached credentials, no EC2 IMDS role found,
│ operation error ec2imds: GetMetadata, exceeded maximum number of attempts,
│ 3, request send failed, Get
│ "http://169.254.169.254/latest/meta-data/iam/security-credentials/": dial
│ tcp 169.254.169.254:80
```

Leaving the real error instead of pasting a fake plan. It's actually useful - you can see it
looking for credentials in order: env vars, then `~/.aws/credentials`, then the EC2 metadata
address `169.254.169.254` (which only works if you're running on an EC2 machine), then giving up.

So `init`, `fmt` and `validate` above are real output. The rest need credentials:

- `terraform apply` - shows the plan, asks you to type `yes`, then creates. It would say
  `Plan: 4 to add` - the bucket plus versioning, encryption and public access block, which are
  separate resources in provider v5.
- `terraform show` - prints the current state.
- `terraform output` - prints just the outputs, like `terraform output bucket_arn`.
- `terraform destroy` - deletes it all, also asks for `yes`.

### What I understood

The main idea is the **state file**. Terraform writes `terraform.tfstate` with everything it
created. Next time it compares config vs state vs real AWS and only changes the difference. That's
what makes it declarative - I describe what I want, not the steps.

So the state file is important. I put it in `.gitignore` because it can hold secrets, and on a real
team it goes in a shared S3 backend so two people don't apply at the same time.

Other things I picked up:

- Resources point at each other with `aws_s3_bucket.demo.id`. That reference is how Terraform works
  out the order - I never wrote "do this first" anywhere.
- `plan` being separate from `apply` is the safety net. You read the `+` and `-` lines before
  anything happens.
- Bucket names are unique across all of AWS, so mine has my enrollment number in it.

## Task 2 - AWS services

One README each in [`aws-services/`](aws-services/):

- [01-iam](aws-services/01-iam/) - users, groups, roles, policies
- [02-ec2](aws-services/02-ec2/) - AMIs, instance types, security groups, EBS
- [03-s3](aws-services/03-s3/) - buckets, storage classes, versioning, encryption
- [04-vpc](aws-services/04-vpc/) - CIDR, subnets, gateways, NACLs
- [05-dynamodb-rds](aws-services/05-dynamodb-rds/) - the two database services
