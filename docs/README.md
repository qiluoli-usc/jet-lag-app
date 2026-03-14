# Documentation Index

This index defines what each product document is for and which one is authoritative when conflicts appear.

## Priority Order

1. `JetLag_HideSeek_APP_SPEC_CN_v3.md` (highest priority)
2. `JetLag_HideSeek_APP_PRD_CN_v3_Codex.extracted.txt`
3. `JetLag_HideSeek_APP_PRD_CN_v2.extracted.txt` (archive/reference only)

## How To Use

- `JetLag_HideSeek_APP_SPEC_CN_v3.md`
  - Type: Technical specification
  - Use for: API contracts, event protocol, state/phase behavior, validation rules
  - Rule: This is the implementation baseline for backend/client/mobile.

- `JetLag_HideSeek_APP_PRD_CN_v3_Codex.extracted.txt`
  - Type: Product requirement document (v3)
  - Use for: Feature scope, interaction expectations, gameplay flow intent
  - Rule: If wording conflicts with SPEC, update PRD interpretation to match SPEC behavior.

- `JetLag_HideSeek_APP_PRD_CN_v2.extracted.txt`
  - Type: Historical PRD snapshot (v2)
  - Use for: Tracing requirement evolution and backward context
  - Rule: Do not implement directly from v2 without confirming in v3 SPEC/PRD.

## Change Management

- New gameplay/API rules: update `SPEC v3` first.
- Product-level scope updates: then sync `PRD v3`.
- `PRD v2` remains unchanged as archive.