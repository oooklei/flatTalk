# AI meal recommendation / 04_kb_pre_retrieve

## Purpose

Retrieve business and dialogue-harvest knowledge from remote Nuwax KBs.

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
