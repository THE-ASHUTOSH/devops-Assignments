variable "aws_region" {
  description = "Region to create the bucket in"
  type        = string
  default     = "ap-south-1"
}

variable "bucket_name" {
  description = "Bucket name, has to be globally unique"
  type        = string
}

variable "environment" {
  description = "Tag so I can tell my resources apart"
  type        = string
  default     = "dev"
}
