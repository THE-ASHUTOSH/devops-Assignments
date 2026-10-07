# DynamoDB & RDS - Database Services

Two very different answers to "I need a database".

# DynamoDB

## NoSQL

Managed key-value / document database. No servers, no version upgrades, no storage to size. Scales
to huge throughput with single-digit millisecond latency.

The trade-off: you design the schema around **your queries**, not around the data. There are no
joins and no "just add a WHERE clause" - a query the keys don't support is a full table scan.

## Tables

Hold items. No fixed schema beyond the key - you only declare the key attributes when creating the
table.

## Items

A single record, up to 400KB. Like a row, except every item can have different attributes.

## Attributes

The fields. Types include string, number, binary, boolean, list, map, and sets. Nested structures
are allowed, so an item can look like a JSON document.

## Partition key

The required part of the primary key. DynamoDB hashes it to decide which physical partition the item
lives on.

Choosing it well is the main design decision. You want values spread evenly - a key like
`country` on an India-heavy app creates a "hot partition" where one partition takes all the
traffic and throttles while the others sit idle. Something like `user_id` spreads out naturally.

## Sort key

Optional second part. Partition key + sort key together must be unique, and items sharing a
partition key are stored sorted by it.

This is what makes range queries possible:

```
partition key: user_id
sort key:      order_date
→ "all orders for user 42 between Jan and Mar"
```

Without a sort key you can only fetch by exact key.

**Secondary indexes** exist for querying by something else: LSI (same partition key, different sort
key, defined at table creation) and GSI (completely different keys, can be added later).

## Use cases

- Session stores, shopping carts, user profiles
- IoT / event data at high write rates
- Leaderboards
- Terraform state locking
- Anything with a known access pattern and a need for scale

Not for: ad-hoc reporting, complex joins, anything where you can't predict the queries.

# RDS

## Relational database

Managed SQL. AWS handles provisioning, patching, backups and failover; you still get a normal
database with tables, joins, transactions and whatever SQL you already know.

The difference from running MySQL on EC2 is operational, not functional - you give up OS access in
exchange for not doing the maintenance.

## Supported engines

MySQL, PostgreSQL, MariaDB, Oracle, SQL Server, and **Aurora** (AWS's own MySQL/PostgreSQL-compatible
engine, faster and with storage that auto-grows).

## DB instances

The server. Sized like EC2 (`db.t3.micro`, `db.m5.large`) with EBS storage underneath. You pick
instance class, storage type/size, and whether storage autoscales.

## Security

- Lives in a **private subnet**, no public access
- A security group allowing 3306/5432 only from the app's security group
- Encryption at rest with KMS, TLS in transit
- Credentials in Secrets Manager, with rotation - not in the application config
- IAM database authentication is available for MySQL/PostgreSQL

## Backups

- **Automated backups** - daily snapshot plus transaction logs, giving point-in-time recovery to any
  second in the retention window (up to 35 days)
- **Manual snapshots** - kept until you delete them

Point-in-time recovery is the one that matters when someone runs a bad `DELETE`.

## Multi-AZ

A **synchronous standby replica** in another availability zone. It serves no traffic - it exists
purely for failover, which happens automatically in a minute or two by repointing the DNS endpoint.

This is for availability, not performance. A common misconception is that Multi-AZ gives you extra
read capacity; it doesn't.

## Read replicas

**Asynchronous** copies that *do* serve read traffic. Point reporting and analytics at them to take
load off the primary.

Because replication is async they can lag slightly, so a read right after a write might return stale
data. Can be in another region, and can be promoted to standalone.

| | Multi-AZ standby | Read replica |
|---|---|---|
| replication | synchronous | asynchronous |
| serves traffic | no | yes, reads |
| purpose | availability | performance |
| failover | automatic | manual promotion |

## Use cases

- Normal application databases where you need joins and transactions
- Anything already written against MySQL/PostgreSQL
- Reporting, with read replicas
- Migrating an on-prem SQL database

# Choosing between them

| | DynamoDB | RDS |
|---|---|---|
| model | key-value / document | relational |
| schema | flexible | fixed |
| queries | by key, planned up front | any SQL, ad-hoc |
| joins | no | yes |
| scaling | horizontal, automatic | vertical, plus read replicas |
| cost model | per request / capacity | per instance-hour |

Rough rule: if you can't describe your access patterns up front, or you need joins, use RDS. If you
know exactly how the data is read and need it to scale hard, use DynamoDB.
