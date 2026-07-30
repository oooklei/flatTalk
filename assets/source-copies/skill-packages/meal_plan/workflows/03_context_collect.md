# AI meal recommendation / 03_context_collect

## Purpose

Collect request slots, elder scope, location, time, and scene.

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
