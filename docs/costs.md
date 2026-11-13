# Costs

What the MVP costs in `dev`, for one user. Costs are approximate monthly figures in US dollars, estimated from list prices and checked against Cost Explorer the day after each deploy (AGENTS.md rule 19).

## Resources

1. Lambda (`api`): under $1 at `dev` traffic, driven by requests, nothing when idle. Cut it by right-sizing memory.
2. HTTP API: under $1 at `dev` traffic, driven by requests. Throttling keeps floods from running up the bill.
3. CloudWatch logs: under $1 at `dev` traffic, driven by log volume. Cut it with 30-day retention and no debug logs in `prod`.
4. Lambda schedule (`api`): under $1. A snapshot every five minutes is about 9,000 runs a month, inside the free allowance.
5. DynamoDB, on demand: under $1, driven by snapshot writes. Cut it by keeping snapshots 90 days.
6. Secrets Manager: $0.40 a secret, one for the MVP. Reads are cached for five minutes.
7. Cognito: nothing for one user.
8. S3 and CloudFront (`desk`): under $1, driven by page loads.
9. Once it's on AWS: a fixed IP address for Binance's allowlist, about $45 for a NAT gateway and its address, since the MVP's key trades (decision 3). It would be most of the bill, so the first deploy prices a small NAT instance against it.

The MVP on AWS: about $2 to $4 a month, plus the fixed address (9).

## Budget and alerts

10. `dev` budget: the monthly limit in spec 10, $50. When `BudgetEmail` is set on the bootstrap stack, AWS Budgets emails as the account's actual spend passes 80% and 100% of `MonthlyBudgetUsd` (default $50), and when its forecast passes 100%.
11. Once the account is bootstrapped and the `INFRACOST_API_KEY` secret is set, each PR that changes `infra/aws/` gets a cost comment: the monthly estimate, the change and the top drivers, each with a saving where one applies. It warns above the `MONTHLY_COST_LIMIT` variable and excludes usage, such as model tokens and data transfer.
