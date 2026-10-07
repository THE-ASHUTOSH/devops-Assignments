# IAM - Governance

## What is IAM

IAM decides **who can do what** in AWS. Every API call gets checked against it. Free, and global
rather than per-region.

Two questions: who are you (authentication), and are you allowed (authorization).

## Users

One identity, usually one person or one app. Has a console password or an access key id + secret
key for the CLI.

The **root user** is the email you signed up with and can do everything including close the
account. Put MFA on it and then never use it.

## Groups

A collection of users. Attach policies to the group and everyone in it inherits them.

The point is managing permissions in one place - new developer joins, add them to `Developers`,
done. A group is not an identity so you cannot give it credentials.

## Roles

Permissions with **no permanent credentials**. Something assumes the role and gets temporary keys
that expire.

| | user | role |
|---|---|---|
| credentials | long-lived | temporary, auto-rotating |
| who uses it | one person/app | anything allowed to assume it |

Used for an EC2 instance that needs S3 (attach a role, no keys on the box), a Lambda function,
cross-account access, or mapping a Google login to AWS permissions.

Roles are the right answer almost any time you were about to hardcode an access key.

## Policies

JSON listing the permissions:

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

Four parts - Effect (Allow/Deny), Action (which API calls), Resource (which ARNs), optionally
Condition.

Types: AWS managed (written by AWS, easy but usually too broad), customer managed (yours), and
inline (stuck to one identity).

## Permissions

1. Default is **deny**
2. An explicit Allow turns it on
3. An explicit Deny beats everything

Deny always wins. That is how you carve an exception out of a broad permission.

## Least privilege

Only what is actually needed. `"Action": "*"` on `"Resource": "*"` is the thing to avoid - if those
keys leak the account is gone.

Practical way: start with nothing, let it break, add exactly the action named in the error.

## Best practices

- MFA on root, then lock root away
- Roles for applications, never access keys on a server
- Groups for humans
- Rotate keys, delete unused ones
- Never commit access keys to git (this is why Session 17 has secret scanning)

## Common use cases

- EC2 instance role so an app reaches S3 with no credentials on disk
- A role assumed by GitHub Actions via OIDC, so no AWS keys in the repo
- Read-only role for an auditor
- Cross-account role
