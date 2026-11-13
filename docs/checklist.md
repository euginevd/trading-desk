# Checklist

The guardrails in DevSecOps stage order. Clear it before real users, customer data, payments or a `prod` deploy. How each one works: [guides/04-the-guardrails.md](../guides/04-the-guardrails.md); risks accepted instead: [guides/03-security-trade-offs.md](../guides/03-security-trade-offs.md).

| # | Stage | Control | Tool | Profile |
|---|---|---|---|---|
| 1 | Plan | Threat modelling, requirements | `threat-model.md`, spec, ASVS | Production |
| 2 | Plan | Cost estimate | `costs.md` | Production |
| 3 | Code, IDE | Secrets, SCA, IaC scanning | Gitleaks, Trivy | Both |
| 4 | Code, repo | Push protection, SCA | GitHub, Dependabot | Both |
| 5 | Code, agent | Agent guardrails | `AGENTS.md`, harness settings | Both |
| 6 | Build | Secrets, SCA, IaC scanning | Gitleaks, Trivy, Checkov | Both |
| 7 | Build | SAST | Semgrep, CodeQL, GitHub AI Scan | Both |
| 8 | Build | Supply chain security | Pinned versions, SBOM | Both |
| 9 | Test | Unit and abuse-case tests, coverage | pytest, `ci` workflow | Both |
| 10 | Test | DAST, unauthenticated | OWASP ZAP baseline scan | Production |
| 11 | Test | DAST, authenticated | OWASP ZAP with a test login | Production |
| 12 | Release | Branch protection | `main` ruleset | Both |
| 13 | Release | Peer review | Second reviewer | Production |
| 14 | Release | Cost review | Infracost | Both |
| 15 | Deploy | AWS account baseline | Root MFA, IAM Identity Center | Both |
| 16 | Deploy | Least privilege | OIDC, read-only role, `main` only | Both |
| 17 | Deploy | Deploy approval | Second reviewer | Production |
| 18 | Deploy | Runtime secrets | Secrets Manager, SSM | Both |
| 19 | Deploy | API protection | Authoriser, WAF, CORS | Production |
| 20 | Operate | Weekly re-scans | `security`, `codeql`, Dependabot | Both |
| 21 | Operate | Budget alert | AWS Budgets | Both |
| 22 | Monitor | Access logs, throttling | API Gateway, CloudWatch | Both |
| 23 | Monitor | Audit logging | CloudTrail | Both |
| 24 | Monitor | Threat detection, alarms | GuardDuty, CloudWatch alarms | Production |
