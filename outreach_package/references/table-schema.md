# Spreadsheet Handling Policy

There is no fixed required spreadsheet schema for this skill.

Policy:
- Read the spreadsheet structure the user provides
- Infer and map useful columns from the existing headers/layout
- Do not add, remove, or reorder columns unless the user explicitly asks
- Do not assume fixed column letters
- Prefer header-based or inferred-field mapping over hardcoded layouts

Typical useful fields may include:
- company name
- website
- email
- country
- phone
- quality
- send status
- send result
- send timestamp
- product/category/title notes

But the actual table may differ every time, and the skill should adapt.
