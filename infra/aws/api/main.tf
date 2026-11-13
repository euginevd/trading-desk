data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition
  # Every role Terraform creates carries the bootstrap stack's permissions boundary.
  boundary_arn = "arn:${local.partition}:iam::${local.account_id}:policy/${var.project}-boundary"
}

# The app's code from apps/api; it has no third-party packages, so the source is the whole bundle.
data "archive_file" "handler" {
  type        = "zip"
  source_dir  = "${path.module}/../../../apps/api/src"
  output_path = "${path.module}/handler.zip"
  excludes    = ["**/__pycache__/**"]
}

resource "aws_iam_role" "lambda" {
  name                 = "${var.project}-api-lambda-${var.environment}"
  description          = "Execution role for the ${var.project} API function"
  permissions_boundary = local.boundary_arn

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "lambda_logs" {
  name = "logs"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "${aws_cloudwatch_log_group.lambda.arn}:*"
    }]
  })
}

resource "aws_cloudwatch_log_group" "lambda" {
  #checkov:skip=CKV_AWS_158: AWS-managed encryption is enough for app logs; a customer key adds a key policy to run
  #checkov:skip=CKV_AWS_338: 30-day retention keeps cost down; raise it per environment if audits need more
  name              = "/aws/lambda/${var.project}-api-${var.environment}"
  retention_in_days = 30
}

resource "aws_lambda_function" "api" {
  #checkov:skip=CKV_AWS_117: no private resources to reach, so no VPC; add one when the function needs a database
  #checkov:skip=CKV_AWS_116: invoked synchronously by the HTTP API, so a dead-letter queue never receives anything
  #checkov:skip=CKV_AWS_115: the API's throttling caps the load; reserved concurrency can fail in new accounts
  #checkov:skip=CKV_AWS_50: tracing is off in the sample; turn on X-Ray when the app has more than one hop
  #checkov:skip=CKV_AWS_272: code signing needs a signer profile; add it before prod if policy requires it
  function_name    = "${var.project}-api-${var.environment}"
  role             = aws_iam_role.lambda.arn
  runtime          = "python3.13"
  handler          = "api.handler.handler"
  filename         = data.archive_file.handler.output_path
  source_code_hash = data.archive_file.handler.output_base64sha256
  timeout          = 10
  memory_size      = 256

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.lambda.name
  }

  depends_on = [aws_iam_role_policy.lambda_logs]
}

resource "aws_apigatewayv2_api" "api" {
  name          = "${var.project}-api-${var.environment}"
  protocol_type = "HTTP"
}

resource "aws_cloudwatch_log_group" "api_access" {
  #checkov:skip=CKV_AWS_158: AWS-managed encryption is enough for app logs; a customer key adds a key policy to run
  #checkov:skip=CKV_AWS_338: 30-day retention keeps cost down; raise it per environment if audits need more
  name              = "/aws/apigateway/${var.project}-api-${var.environment}"
  retention_in_days = 30
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true

  # Throttle every route so a flood of requests can't run up the bill.
  default_route_settings {
    throttling_burst_limit = 50
    throttling_rate_limit  = 20
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_access.arn
    format = jsonencode({
      requestId = "$context.requestId"
      ip        = "$context.identity.sourceIp"
      route     = "$context.routeKey"
      status    = "$context.status"
      latency   = "$context.responseLatency"
    })
  }
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "health" {
  #checkov:skip=CKV_AWS_309: /health is public on purpose and returns no data; every other route needs an authoriser
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /health"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_lambda_permission" "api" {
  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}
