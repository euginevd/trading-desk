# Set by the pipeline: TF_VAR_project, TF_VAR_environment and TF_VAR_region.
variable "project" {
  description = "Project name, the prefix for every resource name"
  type        = string
}

variable "environment" {
  description = "Deployment target, such as dev or prod"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "ap-southeast-2"
}
