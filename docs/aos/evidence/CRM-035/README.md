# CRM-035: workflow CODE steps on AWS Lambda, least privilege

Base commit `bd8e266ff8`, worktree `.aos/worktrees/2026-11-09T20-39-54-267Z-CRM-035-229b9090`.

## 1. Every AWS SDK command the Lambda driver sends, and the IAM action/resource it needs

Resource ARNs use `<prefix>` for `LOGIC_FUNCTION_LAMBDA_NAME_PREFIX`
(`local.logic_function_name_prefix` in `deploy/aws/logic-function.tf`, applied to every name via
`applyLambdaNamePrefix`, `packages/twenty-server/src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/utils/apply-lambda-name-prefix.util.ts`).

| SDK command | File:line | IAM action | Resource pattern |
| --- | --- | --- | --- |
| `InvokeCommand` (executor, `lambda.driver.ts`'s `execute`) | `drivers/lambda.driver.ts:208` | `lambda:InvokeFunction` | `function:<prefix>*` |
| `InvokeCommand` (builder tool fn, `transpile`) | `drivers/lambda/services/lambda-tool-functions.service.ts:76` | `lambda:InvokeFunction` | `function:<prefix>*` |
| `InvokeCommand` (yarn-install tool fn, `runYarnInstallCreateLayer`) | `drivers/lambda/services/lambda-tool-functions.service.ts:144` | `lambda:InvokeFunction` | `function:<prefix>*` |
| `CreateFunctionCommand` (`ensureYarnInstallLambdaExists`) | `drivers/lambda/services/lambda-tool-functions.service.ts:256` | `lambda:CreateFunction` | `function:<prefix>*` |
| `CreateFunctionCommand` (`ensureBuilderLambdaExists`) | `drivers/lambda/services/lambda-tool-functions.service.ts:297` | `lambda:CreateFunction` | `function:<prefix>*` |
| `PublishLayerVersionCommand` (`ensureCommonLayerExists`) | `drivers/lambda/services/lambda-tool-functions.service.ts:201` | `lambda:PublishLayerVersion` | `layer:<prefix>*` |
| `DeleteFunctionCommand` (`delete`) | `drivers/lambda/services/lambda-executor-manager.service.ts:93` | `lambda:DeleteFunction` | `function:<prefix>*` |
| `UpdateFunctionCodeCommand` (`installPrebuiltBundle`) | `drivers/lambda/services/lambda-executor-manager.service.ts:234` | `lambda:UpdateFunctionCode` | `function:<prefix>*` |
| `TagResourceCommand` (prebuilt bundle checksum) | `drivers/lambda/services/lambda-executor-manager.service.ts:252` | `lambda:TagResource` | `function:<prefix>*` |
| `TagResourceCommand` (SDK client checksum) | `drivers/lambda/services/lambda-executor-manager.service.ts:407` | `lambda:TagResource` | `function:<prefix>*` |
| `UpdateFunctionConfigurationCommand` (`updateExecutorConfiguration`) | `drivers/lambda/services/lambda-executor-manager.service.ts:427` | `lambda:UpdateFunctionConfiguration` | `function:<prefix>*` |
| `CreateFunctionCommand` (`createExecutor`) | `drivers/lambda/services/lambda-executor-manager.service.ts:477` | `lambda:CreateFunction` | `function:<prefix>*` |
| `PublishLayerVersionCommand` (deps layer, from S3) | `drivers/lambda/services/lambda-layer-manager.service.ts:286` | `lambda:PublishLayerVersion` | `layer:<prefix>*` |
| `PublishLayerVersionCommand` (SDK layer, in-memory zip) | `drivers/lambda/services/lambda-layer-manager.service.ts:354` | `lambda:PublishLayerVersion` | `layer:<prefix>*` |
| `ListLayerVersionsCommand` (`deleteAllLayerVersions`) | `drivers/lambda/services/lambda-layer-manager.service.ts:380` | `lambda:ListLayerVersions` | `layer:<prefix>*` |
| `DeleteLayerVersionCommand` | `drivers/lambda/services/lambda-layer-manager.service.ts:401` | `lambda:DeleteLayerVersion` | `layer:<prefix>*` |
| `GetFunctionCommand` (`getFunction`) | `drivers/lambda/services/lambda-aws-client.service.ts:140` | `lambda:GetFunction` | `function:<prefix>*` |
| `waitUntilFunctionActiveV2` (polls `GetFunction`) | `drivers/lambda/services/lambda-aws-client.service.ts:105` | `lambda:GetFunction` | `function:<prefix>*` |
| `waitUntilFunctionUpdatedV2` (polls `GetFunction`) | `drivers/lambda/services/lambda-aws-client.service.ts:115` | `lambda:GetFunction` | `function:<prefix>*` |
| `ListLayerVersionsCommand` (`getExistingLayerArn`) | `drivers/lambda/services/lambda-aws-client.service.ts:175` | `lambda:ListLayerVersions` | `layer:<prefix>*` |
| `PutObjectCommand` (presigned upload, deps layer zip) | `drivers/lambda/services/lambda-aws-client.service.ts:92` | `s3:PutObject` | `arn:aws:s3:::<layer-bucket>/*` |
| *(implied by `CreateFunctionCommand`/`UpdateFunctionConfigurationCommand`'s `Layers: [...]`)* | `lambda-executor-manager.service.ts:429,463` | `lambda:GetLayerVersion` | `layer:<prefix>*` |
| *(implied by `CreateFunctionCommand`'s `Role: ...`)* | `lambda-tool-functions.service.ts:249,290`, `lambda-executor-manager.service.ts:465` | `iam:PassRole`, condition `iam:PassedToService = lambda.amazonaws.com` | the execution role ARN only |

Not in this table: `AssumeRoleCommand` (`lambda-aws-client.service.ts:200`, `sts:AssumeRole`) only fires when
`LOGIC_FUNCTION_LAMBDA_SUBHOSTING_ROLE` is set (a separate AWS account this beta does not use) and needs a
trust policy on *that* account's role, not a grant on this account's user; out of scope for CRM-035.

This table is exactly what `deploy/aws-bootstrap/logic-function-user/policy-template.json` grants, and
exactly what `deploy/aws/logic-function.tf`'s execution-role policy does **not** grant it (that role only gets
CloudWatch Logs, since the Lambda functions themselves never call back into the AWS API).

## 2. `LOGIC_FUNCTION_LAMBDA_NAME_PREFIX`: one helper, applied everywhere

`applyLambdaNamePrefix` (new util) is the single choke point; every other naming util
(`buildLambdaResourceName`, `computeHashedLambdaResourceName`, `getLambdaDepsLayerName`,
`getLambdaSdkLayerName`, `getLambdaExecutorFunctionName`) threads `namePrefix` through it. The driver
validates at construction (`validateLambdaNamePrefixUtil.assertLambdaNamePrefixFitsNameLimits`, called
from `lambda.driver.ts`'s constructor) that the configured prefix still leaves room for the longest fixed
suffix the driver builds (the yarn-install tool function name) within Lambda's 64-character function-name
limit; layers' 140-character limit is never the binding constraint given these fixed-length components, so
one check against 64 covers both.

```
$ cd packages/twenty-server && npx jest src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/utils --silent
Test Suites: 12 passed, 12 total
Tests:       44 passed, 44 total
```

## 3. Terraform (`deploy/aws`), static only -- no AWS credentials, no plan/apply

Same posture as CRM-027's evidence: Docker, Terraform pinned by digest
(`hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd`, v1.9.8),
`--network none` except `init` (needs the Terraform Registry for providers, no AWS credentials mounted or
passed either way).

```
$ docker run --rm --network none --user "$(id -u):$(id -g)" -e AWS_EC2_METADATA_DISABLED=true \
    -v "$PWD/deploy/aws:/w" -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    fmt -check -recursive
exit 0 (no output: everything already canonical)

$ docker run --rm --user "$(id -u):$(id -g)" -e AWS_EC2_METADATA_DISABLED=true \
    -v "$PWD/deploy/aws:/w" -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    init -backend=false
exit 0 ("Terraform has been successfully initialized!"; reused hashicorp/aws 5.100.0 and
hashicorp/random 3.9.1 from the existing dependency lock file)

$ docker run --rm --network none --user "$(id -u):$(id -g)" -e AWS_EC2_METADATA_DISABLED=true \
    -v "$PWD/deploy/aws:/w" -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    validate
exit 0 ("Success! The configuration is valid.")

$ sh deploy/aws/scripts/scan-secrets.sh
exit 0 (no output: no 12-digit account id, no AKIA/ASIA access key id, no hardcoded secret literal)

$ node scripts/aos/verify-privacy.mjs
PASS: all 15 privacy checks passed.
exit 0
```

What changed: `logic-function.tf` (new -- execution role, layer bucket, two empty secrets),
`variables.tf` (`logic_function_type`, default `"DISABLED"`), `ecs.tf` (the variable replaces the hardcoded
`LOGIC_FUNCTION_TYPE = "DISABLED"`, four new `LOGIC_FUNCTION_LAMBDA_*` env entries, two new conditional
`app_secrets` entries), `iam.tf` (the two new secret ARNs added to the execution role's existing
`read-app-secrets` policy, exact ARNs, no wildcard), `outputs.tf` (role ARN, layer bucket name, name prefix,
and the two new secret ARNs in the existing map), `terraform.tfvars.example` (commented
`logic_function_type` line, same pattern as `outbound_email_enabled`).

Applying this alone enables nothing: `logic_function_type` defaults to `"DISABLED"`, same posture SEC-01
(`SECURITY_AUDIT.md`) already had hardcoded.

## 4. `shellcheck` on the founder's CloudShell script

```
$ docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck:stable \
    deploy/aws-bootstrap/logic-function-user/create-user.sh
exit 0 (no output)
```

Sanity-checked the tool itself against a deliberately bad script (unquoted `$1`) in the same container
invocation style: it correctly reported `SC2086` and exited 1, confirming the clean result above is real.

## 5. Everything else the dispatch's Checks section asked for

```
$ cd packages/twenty-server && npx oxlint <touched .ts files, from inside packages/twenty-server>
Found 0 warnings and 0 errors.

$ npx oxfmt --check <same files>
(clean after one auto-format pass on a new test file's wrapping)

$ corepack yarn nx affected -t typecheck --base=origin/betty/factory --parallel=1
Successfully ran target typecheck for project twenty-server and 7 tasks it depends on
```
