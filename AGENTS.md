# Afia Leather Inventory

- Treat `docs/locked-requirements.md` as the source of truth for business rules.
- During frontend-only redesign tasks, modify `apps/web/**` only unless I explicitly authorize backend changes.
- Do not modify `apps/api/**`, `apps/api/prisma/**`, or `packages/contracts/**` during frontend redesign.
- Preserve all API contracts, authentication, stock logic, sales logic, purchase logic, customer due logic, invoice numbering, and inventory adjustment behavior.
- Do not introduce schema migrations, dependency upgrades, or broad refactors unless explicitly requested.
- Use the existing stack and components where practical.
- I will perform browser and visual testing manually. Do not launch browser automation unless explicitly requested.
- After frontend changes, run only the relevant checks:
  - `npm run typecheck --workspace @afia/web`
  - `npm run build --workspace @afia/web`
- For backend changes, run relevant API tests/typecheck/build.
- Before finishing a task, check `git diff --name-only` and report if any backend or contract file changed.
- Do not commit or push unless explicitly asked.
