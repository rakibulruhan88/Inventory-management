# Locked product and engineering requirements

## Product language

- The business UI uses **Rolls** and **Meter**, never “Quantity”.
- Products are purchased and sold by **Roll** only. Every sale line sells at least one Roll.
- Meter is optional tracking information. A sale with Meter deducts both Rolls and Meter; a blank Meter deducts only Rolls.
- When a variant reaches zero remaining Rolls, its remaining Meter is normalized to zero.
- Main inventory aggregates Rolls and optional Meter while preserving batch and container history.

## Product identity and stock history

- The supplier Commercial Invoice Contract No. is the Container Number (`containerNumber`). It is unique and cannot be reused; there is no separate contract number.
- Item code identifies one reusable product master across containers.
- Repeated item codes reuse the existing product; they do not create duplicate product masters.
- Each container receipt remains a separate inventory batch.
- Every item has one optional **Description / Size** in `Product.description`, shared by all colors (for example `1.2mm*54"*36.5m`). Colors never have their own size. Item Code and Description / Size are sufficient; product name is optional.
- Every item has at least one required color. `ProductVariant.color` contains the complete textual supplier **Color Code** (for example `02#Pine green`), never a CSS/hex color. Do not fabricate swatches.
- Receive Purchase enters Item Code and Description / Size once, then one Color Code, Rolls, and optional Meter per color. Existing item codes reuse their master and description. A conflicting description is rejected; use an explicit Inventory edit first.
- Legacy variant sizes and hex codes are retained only for migration review. Backfill an item description only when sizes agree; record conflicts instead of guessing. Ambiguous legacy variants cannot be reused by receiving a purchase until explicitly resolved.
- New sales snapshot the item description and supplier color; historical invoice snapshots remain unchanged.

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
