# S3 - Storage

## What is S3

Object storage. Put files in, get them back by key over HTTP. Not a filesystem - there is no append
or rename, you replace the whole object. Effectively unlimited.

## Buckets

The top-level container.

- Names are **globally unique across all AWS accounts**, which is why mine in the Terraform demo is
  `ashutosh-24bcs10111-tf-demo`
- A bucket lives in one region even though the name is global
- Lowercase, no underscores
- Private by default now, after too many public-bucket leaks

## Objects

The files. Each has a **key** (the full name like `logs/2026/01/app.log`), the data (up to 5TB),
metadata, and a version id if versioning is on.

There are **no real folders**. The console shows `logs/` as a folder but it is just a key prefix,
which is why listing is a prefix search.

## Storage classes

| class | for |
|---|---|
| Standard | frequently accessed, default |
| Intelligent-Tiering | unknown access, auto-moves |
| Standard-IA | infrequent but instant |
| One Zone-IA | same, one AZ, cheaper |
| Glacier Instant | archive, instant |
| Glacier Flexible | archive, minutes to hours |
| Glacier Deep Archive | cheapest, up to 12h |

Catch: IA and Glacier have **minimum storage durations** (30/90/180 days). Delete early and you
still pay the full period, so small short-lived files can cost more there.

## Versioning

Keeps every version instead of overwriting. Once on it can only be suspended, never fully turned
off.

A delete with versioning on does not really delete, it adds a **delete marker**. Old versions are
still there and still billed, you just do not see them. That is the protection and also the thing
that quietly grows your bill.

I turned this on in the Terraform demo.

## Lifecycle policies

Rules that move or delete objects by age:

```
logs/ -> 30 days -> Standard-IA
      -> 90 days -> Glacier
      -> 365 days -> delete
```

With versioning on you usually also expire **noncurrent** versions, otherwise they pile up forever.

## Encryption

At rest:

- SSE-S3 (AES256) - AWS manages the key, on by default, what I used
- SSE-KMS - a KMS key, so you get an audit trail
- SSE-C - you supply the key each request
- client-side - you encrypt before uploading

In transit: HTTPS, and you can force it with a bucket policy denying `aws:SecureTransport=false`.

## Bucket policies

JSON attached to the **bucket** instead of an identity, so it can grant access to other accounts or
anonymous users:

```json
{
  "Effect": "Allow",
  "Principal": "*",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::my-public-site/*"
}
```

That makes a bucket publicly readable - fine for a static site, a disaster otherwise.

**Block Public Access** is a separate switch that overrides policies like this. On by default and I
kept it on.

## Common use cases

- Static website hosting, usually behind CloudFront
- Backups and archives
- Data lake queried by Athena
- Application file uploads
- Terraform remote state, with DynamoDB for locking
- Log destination for CloudTrail and ALB
