# Staff access rollout and manual checks

Team & Access is available to the Owner from desktop navigation and the mobile More menu. Create a staff account, choose a preset or individual permissions, and save. An active account with no permissions can use only Account settings. Presets are starting points, not new roles; Owner and Staff remain the stored roles.

The additive migration `20261010000000_staff_access` adds User permissions, sessionVersion and deletedAt, without rewriting stock or financial history. It has been applied to the configured local database. Apply pending migrations on another environment with `npm exec --workspace @afia/api -- prisma migrate deploy`, then restart its API using the regenerated Prisma client. No dependencies were upgraded.

Existing Owner logins remain valid at session version zero. Existing Staff must receive explicit access. Saving a staff account revokes its sessions; the staff member signs in again to use updated access. Deleted usernames remain reserved because the user record retains document and audit relationships.

## Manual browser checks

1. As Owner, open Team & Access. Create Sales staff with a username and initial password. Review the enabled permissions before saving.
2. In a separate private window, sign in as that staff member. Confirm the landing page, desktop/mobile navigation and available actions match their access. Visit `/team`, `/activity` and a restricted page directly; access must be unavailable.
3. Create a sale and open its invoice. Confirm Prepared by in the document corner, print preview, downloaded PDF and emailed PDF. Check long staff names and Bengali names.
4. Create a Cashier with customer-payment and money-entry access. Receive old due, record Money In/Expense/Supplier Payment/Money Out, and check Prepared by on each document. Confirm void is unavailable until separately granted.
5. Grant/revoke permissions or deactivate staff while their other window is open. Their next request must require sign-in; the app also refreshes account access while active. Reactivate and confirm the old session does not recover.
6. Reset a staff password. The old password and old session must fail; the new password must work. Staff can also change their own password in Account settings.
7. Rename and delete a staff member. Confirm their original document attribution and Activity events remain, the account disappears from Team & Access, and sign-in is blocked.
8. Check Activity for staff creation, access/status changes, password resets and deletion. Credentials must never appear.
9. Check desktop/tablet/mobile layouts, search, empty/error/loading states, keyboard focus, long names and delete confirmation. Browser automation was not run.

## Follow-up checks: login and work summary

- Open the root URL in a logged-out/private window. It should finish the session check and open Login, without repeatedly showing Opening your store.
- After Owner login, open the root URL again: Dashboard should open. Staff with no overview access should open their first permitted page.
- Select an existing staff member in Team & Access. Check the Work summary for All time / This month and its View activity link. This month uses Bangladesh recording dates.
- Record a sale, customer, customer payment or manual money entry with delegated access. Its corresponding count should increase once. Retries and later voids should not add another creation count. Repeated stock adjustments count individually.
- Remove a permission from staff who already saved work. The existing count remains marked Past access. Older records without an actor are excluded; counts are not reconstructed from guesses.
