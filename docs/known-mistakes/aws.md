# Known mistakes 9 to 18: AWS and Aurora DSQL

Part of [known-mistakes.md](../known-mistakes.md), kept apart while the desk runs only locally (decision 14). Read it before any AWS work.

## AWS

9. An internal service on a public URL still needs auth (travel-claims #46): make service-to-service URLs IAM-only.
10. A new IAM role isn't usable for a few seconds (travel-claims #60): rerun the apply; don't change a trust policy that's right.
11. Cognito names allow only letters, digits, spaces and `+=,.@-`: keep apostrophes out of AWS names; descriptions are fine.
12. The base Python image's `pip` bundles old `urllib3`, `msgpack` and `setuptools`, and lags Debian's fixes, failing the image scan: runtime stages uninstall `pip` and run `apt-get upgrade`.
13. An AgentCore Gateway Lambda target takes `gateway_iam_role {}` with no `service`.
14. CloudFront's `web_acl_id` is optional and computed, so `null` leaves an attached web ACL in place: set `""` to detach, `null` only where Firewall Manager owns it.
15. AgentCore Identity checks `GetResourceApiKey` and `GetResourceOauth2Token` against `workload-identity-directory/default` too: grant the directory, the workload and the vault.

## Aurora DSQL

16. DSQL refuses `SAVEPOINT`, and SQLAlchemy's psycopg dialect looks up `hstore` inside one on first connect: DSQL engines set `use_native_hstore=False`.
17. `sys.wait_for_job` is a procedure: `CALL` it and read its success from the row it returns.
18. `begin_nested()` opens a `SAVEPOINT`: keep the first row with `insert_if_new` (`INSERT ... ON CONFLICT DO NOTHING`); a test fails if one comes back.
