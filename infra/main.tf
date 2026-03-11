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

# Artifact Registry repository for Docker images
resource "google_artifact_registry_repository" "squared" {
  location      = var.region
  repository_id = "squared"
  format        = "DOCKER"
  description   = "Docker images for Squared app"
}

# Cloud Run service
resource "google_cloud_run_v2_service" "squared" {
  name     = "squared"
  location = var.region

  template {
    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/squared/squared:${var.image_tag}"

      ports {
        container_port = 8080
      }

      env {
        name  = "GEMINI_API_KEY"
        value = var.gemini_api_key
      }

      env {
        name  = "SQUARED_STATIC_DIR"
        value = "dist"
      }

      env {
        name  = "SQUARED_DATA_DIR"
        value = "/tmp/data"
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
        failure_threshold     = 5
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }
  }

  depends_on = [google_artifact_registry_repository.squared]
}

# Allow unauthenticated access
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.squared.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
