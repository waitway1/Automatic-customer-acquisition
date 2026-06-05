---
name: product-email-outreach
description: Analyze a customer spreadsheet, inspect website signals, generate personalized one-time outreach emails, and send tracked bulk emails with inline product image plus fixed company signature/logo template. Use when the user wants to load a new customer table, evaluate customer websites/titles, personalize product emails, preview before sending, send or resume a campaign, preserve spreadsheet structure, or reuse the common outbound-email workflow with different products, images, workbooks, or sender profiles.
---

# Product Email Outreach

Use this skill to run repeatable one-time outbound product email campaigns from spreadsheets.

## Core Rules

- Default to a single-send task. Do not split future work into first / second / third follow-up stages unless the user explicitly asks for a legacy follow-up run.
- Always inspect the real workbook headers and rows before deciding how to process it.
- Preserve the existing workbook structure unless the user explicitly asks for a structure change.
- Send in current workbook order from top to bottom.
- After each successful send, immediately write the send date/status for that row before moving to the next email.
- Treat runtime state/log files as audit history. Use the current workbook status/date columns as the source of truth for whether a row should be sent.
- Within one batch, if the same email appears more than once, send only the first occurrence and skip later duplicates.
- Ask before any live external send or sender identity change.

## Copywriting Rules

- Use `scripts/outreach_copy_engine.py` as the single shared copy engine for website analysis, product matching, subject lines, and body templates.
- Do not create a new per-task copywriting script when the user changes product, vehicle, image, workbook, or sender.
- Pass task context into the shared engine: vehicle model, product focus, product list, price hint, image list, and campaign angle.
- Analyze website/domain/title/company/country cues before generating each email.
- Match product emphasis to website signals such as off-road, styling, accessories, utility, lighting, protection, pickup parts, body kits, grilles, bull bars, flares, and cargo use.
- Keep each email short and natural. Highlight at most one to three relevant products.
- Vary greeting, subject, and body structure across recipients to avoid obvious template repetition.

## Template Rules

Stable assets:
- `templates/company_signature.html`
- `templates/email_shell.html`
- `templates/variables.json`

Variable campaign assets:
- workbook path
- product image path or image list
- sender profile / SMTP config
- task product context

Normally keep the company signature/logo unchanged and only swap product images and task context.

## Workflow

1. Inspect the spreadsheet structure the user provided.
2. Identify the target sheet and useful columns from existing headers/layout.
3. Build task context from the user's product, image, price, vehicle, and campaign instructions.
4. Use `scripts/outreach_copy_engine.py` to analyze each recipient website and generate email copy.
5. Preview generated emails before live sending.
6. Send only after user confirmation.
7. Log each result and save resumable state.
8. Immediately update the workbook row after each successful send.

## Recommended Skill Files

- `scripts/outreach_copy_engine.py` - shared website-analysis, product-matching, subject, and body-template engine
- `scripts/send_campaign.py` - generic single-send campaign runner
- `templates/company_signature.html` - stable company signature block
- `templates/email_shell.html` - wrapper email layout
- `templates/variables.json` - reusable template config
- `config.example.json` - portable example config with relative paths
- `references/table-schema.md` - spreadsheet handling policy

## Portability

Do not hardcode private absolute paths into reusable skill logic.

Use:
- relative paths inside configs when possible
- per-user config files copied from `config.example.json`
- header-based field mapping
- user-local workbook, image, logo, and SMTP settings

The skill logic should be reusable; the config should change per user/environment.
