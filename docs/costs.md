# Costs

A starter: what the sample the template ships costs in `dev`, for kickoff to extend. Optional: delete it if the project has little that costs money. Costs are approximate monthly figures.

## Resources

1. Lambda (`api`): under $1 at `dev` traffic, driven by requests, nothing when idle. Cut it by right-sizing memory.
2. HTTP API: under $1 at `dev` traffic, driven by requests. Throttling keeps floods from running up the bill.
3. CloudWatch logs: under $1 at `dev` traffic, driven by log volume. Cut it with 30-day retention and no debug logs in `prod`.
4. *(to fill in)* each resource the project adds, written like the three above: its rough monthly cost, what drives it and how to cut it.

## Budget and alerts

5. `dev` budget: the monthly limit in spec 10. When `BudgetEmail` is set on the bootstrap stack, AWS Budgets emails as the account's actual spend passes 80% and 100% of `MonthlyBudgetUsd` (default $50), and when its forecast passes 100%.
6. `prod` budget, production only: set here after the first full month of real use.
7. Once the account is bootstrapped and the `INFRACOST_API_KEY` secret is set, each PR that changes `infra/aws/` gets a cost comment: the monthly estimate, the change and the top drivers, each with a saving where one applies. It warns above the `MONTHLY_COST_LIMIT` variable and excludes usage, such as model tokens and data transfer.
