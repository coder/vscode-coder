# A template with no infrastructure. `terraform_data` references the agent
# token so that start builds list the agent among their resources.
terraform {
  required_providers {
    coder = { source = "coder/coder" }
  }
}

data "coder_workspace" "me" {}

data "coder_parameter" "size" {
  name    = "size"
  type    = "string"
  default = "small"
  mutable = true
}

data "coder_workspace_preset" "small" {
  name       = "small"
  parameters = { size = "small" }
}

resource "coder_agent" "dev" {
  os   = "linux"
  arch = "amd64"
}

resource "terraform_data" "dev" {
  count = data.coder_workspace.me.start_count
  input = coder_agent.dev.token
}
