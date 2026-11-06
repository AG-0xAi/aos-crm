variable "source_code_url" {
  description = "Public URL of the exact source of the deployed image, shown in the sign-in license notice (AGPL section 13). Empty shows that no link is configured."
  type        = string
  default     = ""
}

variable "app_version" {
  description = "Version label of the deployed image shown next to the source code link, as a semantic version, e.g. 0.1.0-beta.<short commit>."
  type        = string
  default     = ""

  validation {
    condition     = var.app_version == "" || can(regex("^[0-9]+[.][0-9]+[.][0-9]+(-[0-9A-Za-z.-]+)?([+][0-9A-Za-z.-]+)?$", var.app_version))
    error_message = "app_version must be empty or a semantic version (e.g. 0.1.0-beta.6fbf59c1): Twenty refuses to start otherwise."
  }
}
