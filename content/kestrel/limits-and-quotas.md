# Limits and quotas

## Automation runs

An automation run is one triggered rule firing once. A rule that moves a task
and posts a notification is a single run, not two.

| Plan | Automation runs per month |
| --- | --- |
| Solo | 100 |
| Team | 1,000 |
| Business | 10,000 |

The allowance is per workspace, not per member or per project, and it resets on
your billing renewal date rather than on the first of the calendar month.

Current usage is shown at **Settings → Automation → Usage**, along with a
breakdown of which rules are consuming the most runs. That breakdown is usually
the fastest way to find a misconfigured rule that is firing far more often than
you expected.

We email workspace owners at 80% and 100% of the allowance. When you hit the
cap, automations stop running until the next reset — nothing is queued and run
later, so anything that would have fired while you were over the cap simply does
not happen. Everything else in Kestrel keeps working normally.

Extra runs can be bought on Business only, in blocks of 5,000 for $25. Solo and
Team cannot buy extra runs; the path there is to upgrade.

## File storage

| Plan | Storage | Max single file |
| --- | --- | --- |
| Solo | 5 GB | 50 MB |
| Team | 100 GB | 250 MB |
| Business | 1 TB | 1 GB |

Storage is pooled across the whole workspace. Deleted files still count against
your quota until they leave the trash, which happens automatically 30 days after
deletion, or immediately if you empty the trash by hand.

Going over the storage quota blocks new uploads. It does not delete anything and
does not affect any other part of the product.

## API rate limits

Rate limits are applied per API token, using a rolling 60-second window.

| Plan | Requests per minute |
| --- | --- |
| Solo | 60 |
| Team | 300 |
| Business | 1,000 |

Every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and
`X-RateLimit-Reset`. Exceeding the limit returns `429` with a `Retry-After`
header. Honour that header — retrying sooner extends the block.

Write endpoints (`POST`, `PATCH`, `DELETE`) additionally cap at 20% of the plan
limit, so a Team token gets 300 requests per minute overall but at most 60 of
them can be writes.

The full-workspace export endpoint has its own limit of 5 calls per day per
workspace, independent of the token limit.

## Workspace limits

| | Solo | Team | Business |
| --- | --- | --- | --- |
| Projects | 5 | Unlimited | Unlimited |
| Tasks per project | 5,000 | 50,000 | 50,000 |
| Members | 1 | Unlimited | Unlimited |
| Guest collaborators | 0 | 10 | Unlimited |
| Custom fields per project | 5 | 25 | 50 |
| Webhook endpoints | 1 | 10 | 50 |

The 50,000 tasks-per-project ceiling on Team and Business is a hard limit rather
than a soft one — boards genuinely stop performing well beyond it. If you are
approaching it, splitting into multiple projects almost always works better than
asking us to raise it, and we will suggest that first.
