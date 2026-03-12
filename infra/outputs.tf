output "service_url" {
  description = "URL of the deployed Cloud Run service"
  value       = google_cloud_run_v2_service.squared.uri
}

output "cloud_sql_connection_name" {
  description = "Cloud SQL connection name used by Cloud Run"
  value       = google_sql_database_instance.squared.connection_name
}

output "database_name" {
  description = "Provisioned PostgreSQL database name"
  value       = google_sql_database.squared.name
}

output "database_user" {
  description = "Provisioned PostgreSQL application user"
  value       = var.db_user
}
