output "api_url" {
  description = "Base URL of the HTTP API"
  value       = aws_apigatewayv2_api.api.api_endpoint
}
