# AI meal recommendation / 08_handoff_execute

## Purpose

Prepare remote handoff actions or report missing remote resources.

## Business Context

- Excel item: AI膳食
- Package key: meal_plan
- Runtime policy: remote Nuwax resources are required.

## Inputs

- normalized request text
- role and terminal context
- remote table and knowledge base availability

## Outputs

- structured workflow state
- remote gap list when dependencies are unavailable
- backend page template contract
