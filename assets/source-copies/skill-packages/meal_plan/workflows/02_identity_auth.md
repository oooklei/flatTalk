# AI meal recommendation / 02_identity_auth

## Purpose

Resolve account, terminal, role, and data scope.

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
