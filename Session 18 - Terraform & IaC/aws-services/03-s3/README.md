# S3 - Storage

## What is S3?

Object storage. You put files in and get them back by key over HTTP. Not a filesystem - there's no
"append" or "rename", you replace the whole object. Effectively unlimited, 11 nines of durability.

## Buckets

The top-level container.

- Bucket names are **globally unique across all AWS accounts**, which is why mine in the Terraform
  demo is `ashutosh-24bcs10111-tf-demo`
- A bucket lives in one region even though the name is global
- Lowercase, no underscores (DNS-compatible)
- Private by default now, after too many public-bucket leaks

## Objects

The files. Each has a **key** (the full name, e.g. `logs/2026/01/app.log`), the data (up to 5TB),
metadata, and a version id if versioning is on.

There are **no real folders**. The console shows `logs/` as a folder but it's just a key prefix,
which is why listing is a prefix search.

## Storage classes

| class | for |
|---|---|
| Standard | frequently accessed, the default |
| Intelligent-Tiering | unknown access patterns, auto-moves |
| Standard-IA | infrequent but needs instant access |
| One Zone-IA | same, one AZ, cheaper |
| Glacier Instant Retrieval | archive, instant |
| Glacier Flexible Retrieval | archive, minutes to hours |
| Glacier Deep Archive | cheapest, up to 12h retrieval |

Catch: IA and Glacier have **minimum storage durations** (30/90/180 days). Delete early and you
still pay for the full period, so moving small short-lived files there can cost more.

## Versioning

Keeps every version instead of overwriting. Once enabled it can only be suspended, never fully
turned off.

A delete with versioning on doesn't really delete - it adds a **delete marker**. Old versions are
still there and still billed, you just don't see them. That's the accidental-deletion protection
and also the thing that quietly grows your bill.

I turned this on in the Terraform demo with `aws_s3_bucket_versioning`.

## Lifecycle policies

Rules that move or delete objects by age:

```
logs/ → 30 days → Standard-IA
      → 90 days → Glacier
      → 365 days → delete
```

With versioning on you usually also add a rule to expire **noncurrent** versions, otherwise they
accumulate forever.

## Encryption

**At rest:**
- SSE-S3 (AES256) - AWS manages the key, on by default. What I used in Terraform.
- SSE-KMS - a KMS key, so you get an audit trail and control over who decrypts
- SSE-C - you supply the key on every request
- client-side - you encrypt before uploading

**In transit:** HTTPS, and you can force it with a bucket policy denying `aws:SecureTransport=false`.

## Bucket policies

Resource-based JSON attached to the **bucket** rather than an identity, so they can grant access to
other accounts or anonymous users:

```json
{
  "Effect": "Allow",
  "Principal": "*",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::my-public-site/*"
}
```

That makes a bucket publicly readable - fine for a static site, a disaster for anything else.

**Block Public Access** is a separate switch that overrides policies like this. On by default, and I
kept it on in the Terraform demo.

## Common use cases

- Static website hosting, usually behind CloudFront
- Backups and archives
- Data lake - raw data queried by Athena
- Application file uploads
- Terraform remote state backend, with DynamoDB for locking
- Log destination for CloudTrail, ALB, VPC flow logs
