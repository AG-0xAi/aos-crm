# CRM-035: workflow CODE steps on AWS Lambda, least privilege

Base commit `bd8e266ff8`, worktree `.aos/worktrees/2026-11-09T20-39-54-267Z-CRM-035-229b9090`.

**Fix-forward pass** (this worktree, branch `crm035/funciones-lambda-2`, merged on top of the prior
run's tip `ec3720a006`): closes the review's two majors (missing `s3:GetObject`; no driver/service-
level tests with mocked AWS SDK clients) and four minors (Terraform prefix-length guard; an
orphaned access key on a failed `put-secret-value`; two deleted upstream tests; a wrong apply order
and env-var count in the runbook), and adds the founder's "Programar serie" example logic function.
Sections below are updated in place where the fix changed what they describe; new sections 6-8 cover
what section 1-5 didn't.

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
| *(implied by `PublishLayerVersionCommand`'s `Content.S3Bucket`/`S3Key`, deps layer)* | `drivers/lambda/services/lambda-layer-manager.service.ts:286-291` | `s3:GetObject` | `arn:aws:s3:::<layer-bucket>/*` |
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
Tests:       46 passed, 46 total
```

`get-lambda-sdk-layer-name.util.spec.ts`'s upstream tests ("joins prefix with workspaceId and
applicationUniversalIdentifier", "produces distinct names for distinct identifiers") were deleted by
the prior run and are restored above (2 more tests: 44 -> 46); the prefix cases it added sit next to
them, not instead of them.

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
`variables.tf` (`logic_function_type`, default `"DISABLED"`; **this pass adds a `validation` block on
`environment`** so a value that would make `local.logic_function_name_prefix` -- `aos-crm-<environment>-lf-`
-- exceed 21 characters fails at `plan` time, e.g. `environment = "production"` gives a 22-character
prefix and is refused with a message naming the exact limit and reason), `ecs.tf` (the variable
replaces the hardcoded `LOGIC_FUNCTION_TYPE = "DISABLED"`, **five** new `LOGIC_FUNCTION_LAMBDA_*` env
entries -- `REGION`, `ROLE`, `LAYER_BUCKET`, `LAYER_BUCKET_REGION`, `NAME_PREFIX` -- two new conditional
`app_secrets` entries gated on `logic_function_type == "LAMBDA"`), `iam.tf` (the two new secret ARNs
added to the execution role's existing `read-app-secrets` policy, exact ARNs, no wildcard), `outputs.tf`
(role ARN, layer bucket name, name prefix, and the two new secret ARNs in the existing map),
`terraform.tfvars.example` (commented `logic_function_type` line, same pattern as
`outbound_email_enabled`).

Applying this alone enables nothing: `logic_function_type` defaults to `"DISABLED"`, same posture SEC-01
(`SECURITY_AUDIT.md`) already had hardcoded.

Proof that the `environment` validation actually fails at plan time (not just `validate`, which never
evaluates it against a non-default value since `terraform validate` takes no `-var`): a scratch copy of
`deploy/aws` with the `s3` backend block stripped (so `plan` can run locally, still `--network none`,
still no AWS credentials -- it fails later on the `aws_caller_identity` data source, but only after the
variable validation already ran and raised first):

```
$ docker run --rm --network none --user "$(id -u):$(id -g)" -e AWS_EC2_METADATA_DISABLED=true \
    -e TF_VAR_environment=production <...other required vars...> \
    -v "<scratch-copy>:/w" -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd plan
Error: Invalid value for variable
  on variables.tf line 301:
environment "production" makes the Lambda name prefix "aos-crm-production-lf-" 22 characters long,
but LOGIC_FUNCTION_LAMBDA_NAME_PREFIX must be at most 21 characters (...). Use a shorter environment
tag (at most 9 characters).
```

With `environment=staging` (9 characters, the default) the same command passes that check and only
fails later for an unrelated reason (no real AWS credentials in this sandbox).

## 4. `shellcheck` on the founder's CloudShell script

```
$ docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck:stable \
    deploy/aws-bootstrap/logic-function-user/create-user.sh
exit 0 (no output)
```

Sanity-checked the tool itself against a deliberately bad script (unquoted `$1`) in the same container
invocation style: it correctly reported `SC2086` and exited 1, confirming the clean result above is real.

**This pass**: if `aws secretsmanager put-secret-value` fails after `aws iam create-access-key` already
succeeded, an `EXIT` trap (`cleanup_new_key_on_failure`) now deletes that just-created key with
`aws iam delete-access-key` and exits non-zero, instead of leaving a live, unstored credential behind
that nothing could ever find again. The trap forces `set +x` before touching the key and never prints
it (not even the access key id) in its own message. `shellcheck` above re-ran clean after this change.

## 6. Driver and service tests with mocked AWS SDK clients (the review's other major)

New: `packages/twenty-server/src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda.driver.spec.ts`
and four files under `.../drivers/lambda/__tests__/`, one per service named in the dispatch
(`lambda-aws-client.service.spec.ts`, `lambda-executor-manager.service.spec.ts`,
`lambda-layer-manager.service.spec.ts`, `lambda-tool-functions.service.spec.ts`), plus shared test
support (`__tests__/support/fake-lambda-client.ts`, a tiny in-memory stand-in for the AWS Lambda
control plane that records every command sent and simulates CreateFunction -> GetFunction,
PublishLayerVersion -> ListLayerVersions/DeleteLayerVersion state across calls within one test;
`__tests__/support/lambda-test-fixtures.ts` for `FlatLogicFunction`/`FlatApplication`/collaborator-
service fixtures). `@aws-sdk/client-lambda`'s `Lambda` class (and, where needed, `@aws-sdk/client-s3`'s
`S3Client` and `@aws-sdk/s3-request-presigner`'s `getSignedUrl`) are `jest.mock`ed per the pattern
already established in `file-storage/drivers/__tests__/s3.driver.spec.ts`; every other AWS SDK export
(commands, exceptions, enums) stays real via `jest.requireActual`.

Every command the dispatch named is asserted, with its `FunctionName`/`Resource`/`LayerName` carrying
the prefix when `namePrefix` is set and the bare name when it is empty:

| Command | Asserted in |
| --- | --- |
| `InvokeCommand` (executor) | `lambda.driver.spec.ts` |
| `InvokeCommand` (builder, yarn-install) | `lambda-tool-functions.service.spec.ts` |
| `CreateFunctionCommand` (builder, yarn-install, executor) | `lambda-tool-functions.service.spec.ts`, `lambda-executor-manager.service.spec.ts` |
| `UpdateFunctionCodeCommand` | `lambda-executor-manager.service.spec.ts` |
| `UpdateFunctionConfigurationCommand` | `lambda-executor-manager.service.spec.ts` |
| `DeleteFunctionCommand` | `lambda-executor-manager.service.spec.ts`, `lambda.driver.spec.ts` |
| `GetFunctionCommand` | `lambda-aws-client.service.spec.ts` (direct), exercised again through every executor-manager/driver test |
| `TagResourceCommand` | `lambda-executor-manager.service.spec.ts` |
| `PublishLayerVersionCommand` (common, deps-from-S3, SDK-in-memory) | `lambda-tool-functions.service.spec.ts`, `lambda-layer-manager.service.spec.ts` |
| `ListLayerVersionsCommand` | `lambda-aws-client.service.spec.ts`, `lambda-layer-manager.service.spec.ts` |
| `DeleteLayerVersionCommand` | `lambda-layer-manager.service.spec.ts` |

```
$ cd packages/twenty-server && npx jest src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda --silent
Test Suites: 17 passed, 17 total
Tests:       70 passed, 70 total
```

**Proof the suite bites** (done live, not left in the tree): temporarily changed
`LambdaExecutorManagerService.getFunctionName` to `return flatLogicFunction.id;` (bypassing
`getLambdaExecutorFunctionName`/the prefix entirely), re-ran `lambda-executor-manager.service.spec.ts`
and `lambda.driver.spec.ts` -- 5 of the 10 tests in those two files failed, each on the exact prefix
assertion (`Expected: "aos-crm-prod-lf-...", Received: "..."`), one on a cascading build failure once
the fake Lambda's seeded state no longer matched the (unprefixed) name it polled for. Reverted the
change (confirmed via `git diff`, empty) and re-ran: 70/70 green again.

A real `Lambda`/`S3Client`/`getSignedUrl` were never constructed; every AWS-shaped object in these
tests is either the real SDK's command/exception class (inert data, never sent anywhere) or this
fake client's in-memory state.

**Incidental finding, not a CRM-035 defect**: `jest.config.mjs`'s `fakeTimers: { enableGlobally: true }`
breaks `archiver`'s (and `unzipper`'s) first `require`, since those libraries cache a `setImmediate`
reference at module-load time and fake timers never auto-advance it, hanging any test that reaches
`createZipFile`/`reprefixLambdaZipEntries` for the first time while fake timers are still active. Worked
around locally, per spec file, by calling `jest.useRealTimers()` in `beforeAll` and dynamic-`import`ing
the service under test afterward (so its first `require` of `create-zip-file.ts` happens under real
timers) -- not a repo-wide config change, since that is a judgment call for whoever owns the global
Jest config, not this track.

## 7. Founder's acceptance case: "Programar serie" send dates

`docs/aos/examples/logic-functions/registration-schedule/` -- a pure-TypeScript, dependency-free,
secret-free example CODE-step handler (`export const main = async (params) => ...`, the shape Twenty's
executor expects) that computes 09:00 Europe/Madrid, as UTC, for a registration date plus a list of
day offsets, using `Intl.DateTimeFormat` and date arithmetic only (no timezone library). Covers both
DST transitions, offset 0, and the full `0,2,4...18` list from the dispatch.

```
$ node --test docs/aos/examples/logic-functions/registration-schedule/registration-schedule.test.ts
tests 4
pass 4
fail 0
```

`BETA_RUNBOOK.md` §11 documents how to paste it into a CODE step, and corrects the apply order to what
is actually true of this stack: (a) first apply with `logic_function_type = "DISABLED"` creates the
role/bucket/secrets and extends `read-app-secrets` without activating anything; (b) the founder's
script writes the access key into those two secrets; (c) a second apply with `"LAMBDA"` makes the
`secrets` block (gated on `logic_function_type == "LAMBDA"`, confirmed in `ecs.tf`) appear and resolve
them; (d) the CODE-step test. Applying with `"LAMBDA"` before (b) would otherwise have ECS try to
resolve two still-empty secrets and fail with `ResourceInitializationError` -- the previous runbook
text put the founder's script first, ahead of the apply that actually creates the secrets it writes to.

## 8. Everything else the dispatch's Checks section asked for (this pass)

```
$ cd packages/twenty-server && npx oxlint <this pass's touched .ts files under packages/twenty-server>
Found 0 warnings and 0 errors.

$ npx oxfmt --check <same files, plus the two docs/aos/examples/... files>
(clean after one auto-format pass on the new service spec files)

$ corepack yarn nx affected -t typecheck --base=origin/betty/factory --parallel=1
Successfully ran target typecheck for project twenty-server and 7 tasks it depends on

$ docker run --rm --network none --user "$(id -u):$(id -g)" -e AWS_EC2_METADATA_DISABLED=true \
    -v "$PWD/deploy/aws:/w" -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    validate
exit 0 ("Success! The configuration is valid.")

$ docker run --rm --network none --user "$(id -u):$(id -g)" -e AWS_EC2_METADATA_DISABLED=true \
    -v "$PWD/deploy/aws:/w" -w /w \
    hashicorp/terraform@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd \
    fmt -check -recursive
exit 0 (no output: everything already canonical)

$ docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck:stable \
    deploy/aws-bootstrap/logic-function-user/create-user.sh
exit 0 (no output)

$ sh deploy/aws/scripts/scan-secrets.sh
exit 0 (no output)

$ node scripts/aos/verify-privacy.mjs
PASS: all 15 privacy checks passed.
exit 0
```
