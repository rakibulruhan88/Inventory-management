# Locked product and engineering requirements

## Product language

- The business UI uses **Rolls** and **Meter**, never “Quantity”.
- Products are purchased and sold by **Roll** only. Every sale line sells at least one Roll.
- Meter is optional tracking information. A sale with Meter deducts both Rolls and Meter; a blank Meter deducts only Rolls.
- When a variant reaches zero remaining Rolls, its remaining Meter is normalized to zero.
- Main inventory aggregates Rolls and optional Meter while preserving batch and container history.

## Product identity and stock history

- Container number is unique and cannot be reused.
- Item code identifies one reusable product master across containers.
- Repeated item codes reuse the existing product; they do not create duplicate product masters.
- Each container receipt remains a separate inventory batch.
- Every item has at least one required color. One item can have multiple color variants. Size remains optional.

## Experience

- Mobile-first, light-only, warm off-white and restrained cognac visual language.
- Calm, practical screens for a non-technical shop owner; no generic dashboard styling.
- No default HTML select controls for important data. Use searchable command/combobox patterns, with a sheet or drawer on small screens.
- Products, item codes, rolls, meter, customers, phone numbers, suppliers, containers, purchases, sales, and invoices must be searchable.
- Feedback uses clear loading, disabled, validation, success, and error states. Motion explains state changes and is not decorative.

## Architecture

- React, Vite, TypeScript, Tailwind CSS, shadcn/ui, Radix UI, Lucide React, Motion, AutoAnimate, Sonner, Vaul, TanStack Query/Table, React Hook Form, Zod, date-fns, and Recharts where useful.
- NestJS and TypeScript API with Prisma and PostgreSQL.
- Docker-based local development now, VPS deployment later.
- Business logic stays in the API/domain layer so a future React Native + Expo client can reuse the same API, authentication, and shared contracts.
