---
name: afia-inventory
description: Use for Afia Leather inventory frontend redesign and feature work that must preserve its brand direction and inventory business rules.
---

# Afia Leather Inventory

Use `docs/locked-requirements.md` when business behavior matters.

## Design direction

Create a premium leather-business workspace, not a generic SaaS dashboard.

Prefer:
- warm off-white surfaces
- near-black typography
- restrained cognac/leather accent
- strong hierarchy
- practical information density
- thin dividers
- clean tables
- deliberate whitespace
- subtle functional motion
- mobile-first usability

Avoid:
- blue/purple SaaS styling
- gradients without purpose
- excessive rounded cards
- card-inside-card layouts
- excessive shadows
- icon bubbles everywhere
- oversized welcome sections
- decorative animations
- generic AI dashboard compositions

Preserve searchable combobox/drawer patterns and all existing functionality.

## Engineering guardrails

For frontend redesign, backend and shared contracts are read-only.

Never silently change:
- inventory calculations
- Rolls/Meter behavior
- sales or purchase calculations
- customer due calculations
- invoice numbering
- authentication
- Prisma schema or migrations
- API request/response contracts

Use `frontend-production-shadcn` for substantial UI design work.

Use `security-best-practices` only when a task actually changes backend, authentication, validation, or security-sensitive code.

Do not use browser automation unless explicitly requested.

Keep edits targeted and avoid unrelated refactors.
