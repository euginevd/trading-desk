# Cleaning up AWS

How to remove everything a project puts in AWS, so nothing is charged, then prove it. The code and the GitHub repo stay, so you can redeploy. Run it per account (`dev`, then `prod`), by hand: the agent never touches AWS ([AGENTS.md](../AGENTS.md) rule 25). Delete the bootstrap last, once the account is shown empty (rule 27). Run the AWS commands in **AWS CloudShell**, in the project's region.

Set these first, in CloudShell:

```bash
P=<project-name>; R=ap-southeast-2
```

## 1. Destroy the Terraform units

From the repo:

```bash
gh workflow run aws.yml -f target=dev -f unit=all -f action=destroy
```

Approve the run once its plans pass. Every `apply (<unit>)` job must end green; rerun a failed one with `-f unit=<unit>`. Buckets, repositories and secrets delete at once only if their Terraform sets `force_destroy`, `force_delete` or no recovery window for `dev`.

## 2. Verify

Each command should print nothing except the bootstrap's own stack, bucket and roles. Add a line for each service the project used, in the same form.

```bash
aws cloudformation list-stacks --region $R --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE DELETE_FAILED --query "StackSummaries[?contains(StackName,'$P')].StackName" --output text
aws s3api list-buckets --query "Buckets[?contains(Name,'$P')].Name" --output text
aws lambda list-functions --region $R --query "Functions[?contains(FunctionName,'$P')].FunctionName" --output text
aws apigatewayv2 get-apis --region $R --query "Items[?contains(Name,'$P')].Name" --output text
aws iam list-roles --query "Roles[?starts_with(RoleName,'$P')].RoleName" --output text
aws iam list-policies --scope Local --query "Policies[?starts_with(PolicyName,'$P')].PolicyName" --output text
aws logs describe-log-groups --region $R --query "logGroups[?contains(logGroupName,'$P')].logGroupName" --output text
```

## 3. Delete the bootstrap stack, last

The OIDC provider is one per account. If this lists roles from other projects, keep it: deploy the bootstrap with `CreateOidcProvider=false` next time, or remove the provider from the stack before deleting it.

```bash
aws iam list-roles --query "Roles[?contains(to_string(AssumeRolePolicyDocument), 'token.actions.githubusercontent.com')].RoleName" --output text
```

Empty the versioned state bucket, delete the CLI user's access keys (CloudFormation can't delete a user that has one), then delete the stack:

```bash
for k in $(aws iam list-access-keys --user-name $P-cli --query 'AccessKeyMetadata[].AccessKeyId' --output text); do
  aws iam delete-access-key --user-name $P-cli --access-key-id "$k"
done
B=$P-tfstate-$(aws sts get-caller-identity --query Account --output text)
for kind in Versions DeleteMarkers; do
  aws s3api list-object-versions --bucket "$B" --query "{Objects: $kind[].{Key: Key, VersionId: VersionId}, Quiet: \`true\`}" --output json > /tmp/del.json
  grep -q '"Key"' /tmp/del.json && aws s3api delete-objects --bucket "$B" --delete file:///tmp/del.json
done
aws cloudformation delete-stack --region $R --stack-name $P-bootstrap
aws cloudformation wait stack-delete-complete --region $R --stack-name $P-bootstrap && echo "bootstrap deleted"
```

## 4. Tidy up GitHub

1. So the workflows skip their AWS jobs instead of failing: `gh variable delete PROJECT_NAME`.
2. Delete the `aws-<env>-plan` and `aws-<env>-apply` environments in Settings → Environments, or keep them to redeploy.
3. Revoke any API keys the app used, at their provider, if you won't redeploy soon.

## Notes

1. **Trust each service's own list.** `aws resourcegroupstaggingapi get-resources --tag-filters Key=Project,Values=$P` can show deleted resources for up to a day.
2. **Paste commands one at a time** in CloudShell: a multi-line paste can run a later line as part of an earlier one.
3. **Check the bill** in Cost Explorer a day later: anything still charging is something the list above missed.
4. **Redeploy:** set `PROJECT_NAME` again and follow [01-using-the-template.md](01-using-the-template.md), section 2, step 4.
