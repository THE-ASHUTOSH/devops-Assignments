# Session 18 - Terraform & Infrastructure as Code

Ashutosh Kumar - 24bcs10111

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

Separate files instead of one big main.tf, because that is the normal layout and it is easier to
find things.

### Commands

`terraform init` - downloads the provider:

```
- Finding hashicorp/aws versions matching "~> 5.0"...
- Installing hashicorp/aws v5.100.0...
- Installed hashicorp/aws v5.100.0 (signed by HashiCorp)

Terraform has been successfully initialized!
```

`terraform fmt -check -recursive` - printed nothing, exit code 0, so formatting was already fine.

`terraform validate`:

```
Success! The configuration is valid.
```

`terraform plan` - this is the first one that actually talks to AWS, and I do not have an account
set up, so it failed:

```
Planning failed. Terraform encountered an error while generating this plan.

│ Error: No valid credential sources found
│   with provider["registry.terraform.io/hashicorp/aws"],
│   on provider.tf line 12, in provider "aws":
│
│ Error: failed to refresh cached credentials, no EC2 IMDS role found,
│ Get "http://169.254.169.254/latest/meta-data/iam/security-credentials/":
│ dial tcp 169.254.169.254:80
```

Leaving the real error instead of pasting a fake plan. It is actually useful, you can see it look
for credentials in order - env vars, then ~/.aws/credentials, then the EC2 metadata address (which
only works if you are on an EC2 machine), then give up.

So init, fmt and validate above are real output. The rest need credentials:

- `terraform apply` - shows the plan, you type `yes`, it creates. Would say `Plan: 4 to add` - the
  bucket plus versioning, encryption and public access block, which are separate resources in
  provider v5.
- `terraform show` - prints the current state
- `terraform output` - just the outputs
- `terraform destroy` - deletes it all, also asks for `yes`

### What I understood

The main idea is the **state file**. Terraform writes terraform.tfstate with everything it created.
Next time it compares config vs state vs real AWS and only changes the difference. That is what
makes it declarative - I describe what I want, not the steps.

So the state file matters. It is in .gitignore because it can hold secrets, and on a team it goes
in a shared S3 backend so two people do not apply at once.

Other things I picked up:

- Resources point at each other with `aws_s3_bucket.demo.id`. That reference is how Terraform works
  out the order, I never wrote "do this first" anywhere.
- `plan` being separate from `apply` is the safety net, you read the + and - lines first.
- Bucket names are unique across all of AWS, so mine has my enrollment number in it.

## Task 2 - AWS services

One README each in [`aws-services/`](aws-services/):

- [01-iam](aws-services/01-iam/) - users, groups, roles, policies
- [02-ec2](aws-services/02-ec2/) - AMIs, instance types, security groups, EBS
- [03-s3](aws-services/03-s3/) - buckets, storage classes, versioning, encryption
- [04-vpc](aws-services/04-vpc/) - CIDR, subnets, gateways, NACLs
- [05-dynamodb-rds](aws-services/05-dynamodb-rds/) - the two database services
