# IAM - Governance

## What is IAM?

IAM decides **who can do what** in AWS. Every API call gets checked against it. It's free and
global, not per-region.

Two questions it answers: who are you (authentication), and are you allowed (authorization).

## Users

One identity, usually one person or one application. Has either a console password or an access key
id + secret key for the CLI.

The **root user** is the email you signed up with and can do everything, including close the
account. You're meant to put MFA on it and then never use it.

## Groups

A collection of users. Attach policies to the group and every user in it inherits them.

The point is managing permissions in one place - new developer joins, add them to `Developers`,
done. A group isn't an identity, so you can't give it credentials.

## Roles

Permissions with **no permanent credentials**. Something assumes the role and gets temporary keys
that expire.

| | user | role |
|---|---|---|
| credentials | long-lived | temporary, auto-rotating |
| who uses it | one person/app | anything allowed to assume it |

Used for an EC2 instance that needs S3 (attach a role, no keys on the box), a Lambda function,
cross-account access, or letting a Google login map to AWS permissions.

Roles are the right answer almost any time you were about to hardcode an access key.

## Policies

JSON documents listing permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::my-bucket/*"
    }
  ]
}
```

Four parts: **Effect** (Allow/Deny), **Action** (which API calls), **Resource** (which ARNs), and
optionally **Condition**.

Types: AWS managed (written by AWS, easy but usually too broad), customer managed (yours, reusable),
and inline (embedded in one identity, dies with it).

## Permissions

How a request is decided:

1. Default is **deny**
2. An explicit `Allow` anywhere turns it on
3. An explicit `Deny` anywhere beats everything

Deny always wins. That's how you carve an exception out of a broad permission.

## Least privilege

Give only what's actually needed. `"Action": "*"` on `"Resource": "*"` is the thing to avoid - if
those keys leak the account is gone.

Practical approach: start with nothing, let it break, add exactly the action named in the error.

## Best practices

- MFA on root, then lock root away
- Roles for applications, never access keys on a server
- Groups for humans, not per-user policies
- Rotate access keys, delete unused ones
- Never commit access keys to git (this is why Session 17 has a secret-scanning job)
- Use the Credential Report / Access Analyzer to find over-permissioned identities

## Common use cases

- EC2 instance role so an app reaches S3 with no credentials on disk
- A role assumed by GitHub Actions via OIDC, so there are no AWS keys stored in the repo
- Read-only role for an auditor
- Cross-account role for a central identity account
