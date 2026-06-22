# Private Workspace Setup

The site uses Cloudflare Access for verified identity and Pages Functions with D1 for per-resource authorization.

## Protected Applications

Create or maintain three Cloudflare Access self-hosted applications:

1. `t-hawthorne.com/private/*`
2. `t-hawthorne.com/tools/fire-drill-training/*`
3. `t-hawthorne.com/tools/th-operations-scheduler/*`

Each application should use an **Allow** policy with the configured login method. To let a new verified user create a private-workspace profile and request access, include the One-time PIN login method. Do not use a Bypass policy.

Cloudflare Access verifies the email identity. The Pages Functions authorization layer still denies scheduler, fire drill, staff, and admin data unless permission has been granted inside the site.

## Pages Variables

The Pages project requires:

- `OWNER_EMAIL`: `athletetyreseh@gmail.com`
- `CF_ACCESS_TEAM_DOMAIN`: the Cloudflare Zero Trust team domain
- `CF_ACCESS_AUD`: comma-separated application audience tags for all three Access applications
- D1 binding `SCHEDULER_DB`: the existing scheduler database
- `RESEND_API_KEY` (secret, optional): enables direct staff email delivery
- `STAFF_EMAIL_FROM` (optional): verified sender such as `Tyrese Hawthorne <operations@t-hawthorne.com>`

`SCHEDULER_DEV_BYPASS` must not be enabled in production.

## First Use

1. Open `https://t-hawthorne.com/private/` and sign in as the owner.
2. The first authenticated request creates the private access and staff tables in D1 if they do not exist.
3. Other users sign in at the same URL and request specific resources.
4. Open `https://t-hawthorne.com/private/admin/` as the owner.
5. Approve or deny requests, or directly set `No access`, `View`, or `Edit` for each user and resource.

## Resource Behavior

- **Scheduler:** edit permission opens the shared owner schedule. It does not create a separate schedule for each user.
- **Fire Drill Viewer:** view permission protects the HTML viewer, every slide image, and the PowerPoint download.
- **Staff Directory:** view permission reads staff records; edit permission also creates and updates them.
- **Staff Messaging:** with Resend configured, edit users can send one BCC message to up to 50 selected staff or separate messages to up to 100 selected staff. Without it, the interface opens BCC or individual drafts in the device mail client.
- **Occurrences:** call off = 2 points, no call/no show = 4, late = 1, left early = 1, and documentation-only entries = 0. Points are assigned by the server rather than the browser.
- **Exports:** roster and occurrence views generate local `.xlsx` files without transmitting export data to another service.
- **Admin:** owner-only and cannot be delegated from the interface.
