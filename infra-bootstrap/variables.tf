variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region used for bootstrap provider configuration"
  type        = string
  default     = "us-central1"
}

variable "bucket_location" {
  description = "Location for the Terraform state bucket"
  type        = string
  default     = "US"
}

variable "state_bucket_name" {
  description = "Name of the GCS bucket that stores Terraform state"
  type        = string
}
