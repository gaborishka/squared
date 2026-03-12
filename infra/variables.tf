variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for Cloud Run and Artifact Registry"
  type        = string
  default     = "us-central1"
}

variable "google_client_id" {
  description = "Google OAuth Client ID for user authentication"
  type        = string
}

variable "app_url" {
  description = "Hosted public base URL for Squared"
  type        = string
}

variable "pg_sslmode" {
  description = "sslmode value appended to DATABASE_URL"
  type        = string
  default     = "disable"
}

variable "image_tag" {
  description = "Docker image tag to deploy"
  type        = string
  default     = "latest"
}

variable "db_instance_name" {
  description = "Cloud SQL instance name for Squared"
  type        = string
  default     = "squared-pg"
}

variable "db_name" {
  description = "PostgreSQL database name for Squared"
  type        = string
  default     = "squared"
}

variable "db_user" {
  description = "PostgreSQL application user for Squared"
  type        = string
  default     = "squared"
}

variable "db_tier" {
  description = "Cloud SQL machine tier"
  type        = string
  default     = "db-f1-micro"
}

variable "db_deletion_protection" {
  description = "Whether to enable deletion protection on the Cloud SQL instance"
  type        = bool
  default     = true
}

variable "vpc_network_name" {
  description = "VPC network name used for private Cloud SQL connectivity"
  type        = string
  default     = "default"
}

variable "vpc_connector_cidr" {
  description = "CIDR range reserved for the Serverless VPC Access connector"
  type        = string
  default     = "10.8.0.0/28"
}

variable "alert_notification_emails" {
  description = "Email addresses that receive uptime alerts"
  type        = list(string)
  default     = []
}
