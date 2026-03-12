terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  service_account_id = "squared-cloud-run"
  app_host           = trimsuffix(replace(replace(var.app_url, "https://", ""), "http://", ""), "/")
  app_is_https       = startswith(lower(var.app_url), "https://")
  secret_ids = {
    gemini_api_key        = "squared-gemini-api-key"
    google_client_secret  = "squared-google-client-secret"
    database_url          = "squared-database-url"
    db_password           = "squared-db-password"
  }
}

resource "google_project_service" "required" {
  for_each = toset([
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "compute.googleapis.com",
    "servicenetworking.googleapis.com",
    "vpcaccess.googleapis.com",
    "monitoring.googleapis.com",
  ])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "squared" {
  location      = var.region
  repository_id = "squared"
  format        = "DOCKER"
  description   = "Docker images for Squared app"

  depends_on = [google_project_service.required["artifactregistry.googleapis.com"]]
}

data "google_compute_network" "private" {
  name = var.vpc_network_name

  depends_on = [google_project_service.required["compute.googleapis.com"]]
}

resource "google_compute_global_address" "private_service_range" {
  name          = "${var.db_instance_name}-private-range"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = data.google_compute_network.private.id

  depends_on = [google_project_service.required["servicenetworking.googleapis.com"]]
}

resource "google_service_networking_connection" "private_vpc_connection" {
  network                 = data.google_compute_network.private.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_service_range.name]

  depends_on = [google_project_service.required["servicenetworking.googleapis.com"]]
}

resource "google_vpc_access_connector" "cloud_run" {
  name          = "squared-run-connector"
  region        = var.region
  network       = data.google_compute_network.private.name
  ip_cidr_range = var.vpc_connector_cidr
  min_instances = 2
  max_instances = 3

  depends_on = [google_project_service.required["vpcaccess.googleapis.com"]]
}

resource "google_sql_database_instance" "squared" {
  name                = var.db_instance_name
  database_version    = "POSTGRES_17"
  region              = var.region
  deletion_protection = var.db_deletion_protection

  settings {
    tier    = var.db_tier
    edition = "ENTERPRISE"

    ip_configuration {
      ipv4_enabled       = false
      private_network    = data.google_compute_network.private.id
      allocated_ip_range = google_compute_global_address.private_service_range.name
    }

    backup_configuration {
      enabled = true
    }
  }

  depends_on = [
    google_project_service.required["sqladmin.googleapis.com"],
    google_service_networking_connection.private_vpc_connection,
  ]
}

resource "google_sql_database" "squared" {
  name     = var.db_name
  instance = google_sql_database_instance.squared.name
}

resource "google_service_account" "cloud_run" {
  account_id   = local.service_account_id
  display_name = "Squared Cloud Run service account"
}

resource "google_secret_manager_secret" "gemini_api_key" {
  secret_id = local.secret_ids.gemini_api_key

  replication {
    auto {}
  }

  depends_on = [google_project_service.required["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret" "google_client_secret" {
  secret_id = local.secret_ids.google_client_secret

  replication {
    auto {}
  }

  depends_on = [google_project_service.required["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret" "database_url" {
  secret_id = local.secret_ids.database_url

  replication {
    auto {}
  }

  depends_on = [google_project_service.required["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret" "db_password" {
  secret_id = local.secret_ids.db_password

  replication {
    auto {}
  }

  depends_on = [google_project_service.required["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_iam_member" "gemini_api_key_accessor" {
  secret_id = google_secret_manager_secret.gemini_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "google_client_secret_accessor" {
  secret_id = google_secret_manager_secret.google_client_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "database_url_accessor" {
  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_cloud_run_v2_service" "squared" {
  name     = "squared"
  location = var.region

  template {
    service_account = google_service_account.cloud_run.email

    vpc_access {
      connector = google_vpc_access_connector.cloud_run.id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/squared/squared:${var.image_tag}"

      ports {
        container_port = 8080
      }

      env {
        name = "GEMINI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.gemini_api_key.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "GOOGLE_CLIENT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.google_client_secret.secret_id
            version = "latest"
          }
        }
      }

      env {
        name  = "PGSSLMODE"
        value = var.pg_sslmode
      }

      env {
        name  = "SQUARED_STATIC_DIR"
        value = "dist"
      }

      env {
        name  = "SQUARED_DATA_DIR"
        value = "/tmp/data"
      }

      env {
        name  = "GOOGLE_CLIENT_ID"
        value = var.google_client_id
      }

      env {
        name  = "APP_URL"
        value = var.app_url
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }

      startup_probe {
        http_get {
          path = "/api/health"
          port = 8080
        }
        initial_delay_seconds = 2
        period_seconds        = 3
        failure_threshold     = 10
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }
  }

  depends_on = [
    google_artifact_registry_repository.squared,
    google_secret_manager_secret_iam_member.gemini_api_key_accessor,
    google_secret_manager_secret_iam_member.google_client_secret_accessor,
    google_secret_manager_secret_iam_member.database_url_accessor,
    google_sql_database.squared,
    google_vpc_access_connector.cloud_run,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.squared.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_monitoring_notification_channel" "email" {
  for_each = toset(var.alert_notification_emails)

  display_name = "Squared ${each.value}"
  type         = "email"
  labels = {
    email_address = each.value
  }

  depends_on = [google_project_service.required["monitoring.googleapis.com"]]
}

resource "google_monitoring_uptime_check_config" "api_health" {
  display_name = "Squared API health"
  timeout      = "10s"
  period       = "60s"

  http_check {
    path         = "/api/health"
    port         = local.app_is_https ? 443 : 80
    use_ssl      = local.app_is_https
    validate_ssl = local.app_is_https
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      host       = local.app_host
      project_id = var.project_id
    }
  }

  selected_regions = ["USA"]

  depends_on = [google_project_service.required["monitoring.googleapis.com"]]
}

resource "google_monitoring_alert_policy" "api_health" {
  display_name = "Squared API health check failing"
  combiner     = "OR"
  enabled      = true

  conditions {
    display_name = "Uptime check failed"

    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.labels.check_id=\"${google_monitoring_uptime_check_config.api_health.uptime_check_id}\""
      duration        = "120s"
      comparison      = "COMPARISON_LT"
      threshold_value = 1

      aggregations {
        alignment_period   = "120s"
        per_series_aligner = "ALIGN_NEXT_OLDER"
      }

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close = "1800s"
  }

  documentation {
    mime_type = "text/markdown"
    content   = "Runbook: `docs/runbooks/production-operations.md` in the squared repository"
  }

  notification_channels = [for channel in google_monitoring_notification_channel.email : channel.name]

  depends_on = [google_monitoring_uptime_check_config.api_health]
}
