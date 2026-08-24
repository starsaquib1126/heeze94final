# IBridge HR Portal

Multi-tenant HR management web portal — manages the full candidate lifecycle from offer request to exit.

## Status: Milestone 10 of 10 — Core build complete

| # | Milestone | Status |
|---|---|---|
| 1 | Database schema + auth + tenant provisioning + directory + public offer form | ✅ Done |
| 2 | HR dashboard + candidate tracker + upcoming joinings | ✅ Done |
| 3 | Offer release + notification pipeline | ✅ Done |
| 4 | Letter block editor + CTC structure builder | ✅ Done |
| 5 | Letter generation (reuses existing engine) | ✅ Done |
| 6 | Full tracker: event history + notification log + Excel export | ✅ Done |
| 7 | Joining flow: ID assignment + document link to candidate + active status | ✅ Done |
| 8 | Exit flow: LWD intimation + 20-day relieving reminder + clearance checkbox | ✅ Done |
| 9 | Hike letter + revise offer | ✅ Done |
| 10 | Document Vault: HR view/download + yearly ZIP generation | ✅ Done |
| 6 | Joining flow: ID assignment + appointment letter | Planned |
| 7 | Hike letter + revise offer | Planned |
| 8 | Exit flow: LWD + 20-day relieving reminder + clearance | Planned |
| 9 | Document vault + yearly ZIP archival | Planned |
| 10 | Scheduled jobs + Excel export + production hardening | Planned |

## Architecture

```
ibridge-portal/
├── backend/                    FastAPI (Python)
│   ├── app/
│   │   ├── main.py             Entry point
│   │   ├── core/
│   │   │   ├── config.py       All settings from env vars
│   │   │   └── auth.py         JWT validation + role dependencies
│   │   ├── db/
│   │   │   └── client.py       Supabase clients (service + user-scoped)
│   │   ├── models/
│   │   │   └── user.py         Pydantic models for all entities
│   │   ├── services/
│   │   │   ├── tenant_service.py     Tenant provisioning (Platform Owner)
│   │   │   ├── user_service.py       HR user management
│   │   │   ├── directory_service.py  Client routing, AM/recruiter/leadership lists
│   │   │   └── email_service.py      All notification emails (Resend)
│   │   └── api/v1/endpoints/
│   │       ├── platform.py    Platform Owner: provision tenants
│   │       ├── admin.py        Super User: directory, locations, users
│   │       └── public.py       No-auth: AM offer request form
│   └── requirements.txt
│
├── frontend/                   React + TypeScript + Tailwind
│   └── src/
│       ├── lib/supabase.ts     Supabase client + Axios API helper
│       ├── store/authStore.ts  Zustand auth state
│       ├── pages/
│       │   ├── LoginPage.tsx
│       │   └── PublicOfferForm.tsx  (Milestone 2)
│       └── App.tsx             Router with auth guards
│
└── supabase/migrations/
    └── 001_initial_schema.sql  Full PostgreSQL schema + RLS policies
```

## Key design decisions

**Multi-tenancy**: Every table has a `tenant_id`. Supabase Row Level Security
enforces isolation at the database level — even if the backend has a bug, an HR
user from Company A cannot see Company B's data. This is not just application-level
filtering: it's enforced by the database itself.

**Platform Owner separation**: Saquib provisions client access but has zero
visibility into any client's HR data. The platform and tenant layers are
completely separate: no foreign keys from tenants into tenant data, no
shared authentication, different API prefix (`/api/v1/platform/` vs `/api/v1/admin/`).

**Atomic Employee ID**: One `employee_id_sequences` row per tenant, incremented
with a `FOR UPDATE` lock inside a PostgreSQL function (`increment_employee_id`).
Two HRs at different locations clicking "Assign" at the same millisecond cannot
get the same number.

**Email notifications**: Every pipeline event (offer released, appointment released,
hike, relieving) sends to: Account Manager + HR + Core Director + Location Director
+ constant `hr@` address. All sends — including failures — are logged to
`notification_log` with the full recipient list, so there's always proof of what
was or wasn't sent.

## Local development setup

### Prerequisites
- Python 3.12+
- Node 20+
- A free [Supabase](https://supabase.com) project
- A free [Resend](https://resend.com) account

### Backend
```bash
cd backend
python -m venv venv
venv/Scripts/activate          # Windows
pip install -r requirements.txt
cp .env.example .env           # fill in your values
uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env.local     # fill in your values
npm run dev
```

### Database
Run `supabase/migrations/001_initial_schema.sql` in the Supabase SQL editor.

## Deployment (Render + Supabase, $0)

1. Push this repo to GitHub
2. Create a Supabase project (free) — run the migration SQL
3. Create a Render Web Service (free) pointing to `backend/`, build command:
   `pip install -r requirements.txt`, start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
4. Set all `SUPABASE_*`, `RESEND_API_KEY`, `PLATFORM_OWNER_KEY` env vars on Render
5. Create a Render Static Site for the frontend — build command: `npm run build`,
   publish directory: `dist`

## Access model

| Who | How they access the system |
|---|---|
| Platform Owner (Saquib) | Calls `/api/v1/platform/*` with PLATFORM_OWNER_KEY header |
| Super User (Head HR) | Logs in → sees all locations within their company |
| HR | Logs in → sees only their own location |
| Account Manager | Uses the constant public link `/offer/{tenant-slug}` |
| Recruiter | Name captured on AM's form — never touches the system |
| Leadership | Receives email copies only — never logs in |
| Candidate | Receives offer letter directly; later gets a one-time document-upload link |

## QA pass performed before delivery

Milestone 1 was built, then audited end-to-end rather than assumed correct.
Real issues found and fixed:

- **Critical security bug**: `platform.py` defined a `verify_platform_key`
  guard but never actually applied it via `Depends()` on any route — every
  tenant-provisioning endpoint (create tenant, list tenants, suspend tenant,
  create super user) was completely open to anyone. Fixed, and covered by
  `tests/test_platform_auth.py`, which fails loudly if this guard is ever
  un-wired again.
- **Missing `/me` endpoint**: the frontend's `authStore.ts` already called
  `GET /me` after login, but no such route existed anywhere in the backend —
  login would have appeared to succeed and then immediately broken. Added.
- **`public.py`**: fixed a misleading `201 Created` status on the "client
  not in directory" response (nothing is actually created in that case),
  removed dead/confused code from an editing mistake (a variable assigned
  a list then immediately overwritten), removed an unused database query,
  and added a missing tenant-ownership check on `recruiter_id` (the Account
  Manager was already validated this way; the recruiter wasn't — meaning a
  bad request could attach another tenant's recruiter to this tenant's
  candidate record, since this endpoint uses the service key and bypasses RLS).
- **Frontend couldn't actually start**: `index.html`, `main.tsx`, Tailwind/
  PostCSS config, and `tsconfig.node.json` (referenced but missing) didn't
  exist. Added all of them and confirmed with an actual `npm run build`
  (not just "should work") that the full production bundle compiles cleanly.
- 6 missing `__init__.py` files in the backend, and 6 placeholder pages for
  routes `App.tsx` already referenced (`DashboardPage`, `RecruitmentPage`,
  etc.) — added so the app is fully navigable today even though most
  screens don't exist until later milestones.
- Verified every fix against real HTTP requests via FastAPI's `TestClient`,
  not just by reading the code — e.g. confirmed the platform-key guard
  actually returns 403 on a wrong key and 422 on a missing one, confirmed
  `/me` actually returns 401 for an expired/forged/unmatched token.

### Running the tests

```bash
cd backend
pip install -r requirements.txt pytest
python -m pytest tests/ -v
```

17 tests, all passing, no live Supabase connection required — auth and
platform-key enforcement are tested against mocked/forged tokens and a
mocked database client, not a real backend.

## Honest gaps in this delivery

- **Routing was verified with real HTTP requests, but only against a fake
  Supabase URL.** Every code path that assumes a *successful* database
  response (e.g. actually creating a tenant, actually resolving a client
  to a location) has not been exercised against a real Supabase project —
  only the auth/rejection paths have real, passing tests. The first real
  Supabase project should be used to walk through tenant creation → super
  user creation → HR login → directory setup by hand before trusting this
  further.
- No frontend tests exist yet — only a successful build and typecheck.

## What's new in Milestone 2

Read-only visibility layer for HR — the tracker and dashboard. No actions
yet (release offer, assign ID, etc. — those are Milestone 3+); this
milestone is entirely about what HR sees when they log in.

**Backend:**
- `candidate_service.py` — every query scoped by role: Super User sees
  the whole tenant, HR sees only their own location. This is the most
  important access boundary in a multi-tenant system, so it's covered
  by 5 dedicated tests (`tests/test_candidate_scoping.py`) that check
  the actual query-building logic, not just an endpoint's HTTP response.
- `GET /candidates` — the tracker list, filterable by stage and searchable
  by name/email/client.
- `GET /candidates/{id}` and `GET /candidates/{id}/events` — candidate
  detail plus its full event history. Both return the same 404 whether a
  candidate doesn't exist or simply isn't visible to the caller — a
  distinct "exists but forbidden" response would leak which candidate
  IDs are valid to someone who shouldn't know that.
- `GET /dashboard/summary` — stage counts, upcoming joinings (within the
  configured lookahead window), and candidates joining today, all scoped
  the same way.

**Frontend:**
- Real `DashboardPage` — stat cards per stage, a "Joining Today" alert
  banner (only rendered when something actually needs attention), and
  an upcoming-joinings list.
- Real `RecruitmentPage` — the full tracker table, with stage tabs and a
  search box.
- Real `CandidateDetailPage` — full candidate fields plus a visual event
  timeline.
- `AppShell` — shared sidebar/navigation wrapping every authenticated
  page, with an Admin link that only Super Users see.
- Fixed a real type mismatch found while building this: the sidebar
  needed the logged-in user's email, but `UserProfile` never carried it
  (email lives in Supabase's separate `auth.users` table, not
  `user_profiles`). Fixed end-to-end — `/me` now populates it from the
  JWT payload rather than a second database query.

### Verification performed before shipping

- 5 new tests directly exercise the scoping logic: Super User query has
  no location filter, HR query has both tenant AND location filters, an
  HR profile with a NULL location_id fails loudly instead of silently
  matching everything, and a candidate invisible to the caller never
  leaks its event history.
- All 22 backend tests pass (17 from Milestone 1 + 5 new).
- Frontend type-checks cleanly and produces a real production build —
  confirmed the three new pages compile into real bundled chunks (a few
  KB each with actual content), not the ~180-byte placeholder stubs they
  replaced.

## What's new in Milestone 3

The first real write action, plus the Account Manager's actual public
entry point (built in Milestone 1 on the backend, left as a placeholder
on the frontend until now).

**Backend:**
- `CandidateService.release_offer()` — transitions a candidate from
  `requested` to `offered`. Deliberately refuses to touch any other
  stage: revising an already-released offer is a distinct capability
  reserved for Milestone 7, so this method raises rather than
  reinterpreting a second release as a revision.
- `POST /candidates/{id}/release-offer` — performs the release, then
  builds the full notification recipient list (Account Manager + HR +
  Core Director + Location Director + constant `hr@` address) and sends
  via the `EmailService.notify_offer_released()` method that was already
  built in Milestone 1 but never had a caller until now.
- Refactored a duplicated inline pattern (looking up a user's email via
  Supabase's admin API) into `UserService.get_auth_email()`, used by
  both `public.py` and the new release-offer endpoint.

**Frontend:**
- Real `PublicOfferForm` — the Account Manager's actual form: picks
  themselves and a recruiter from dropdowns, types a client name
  (autocompleted against known clients), enters candidate details, and
  submits. Handles the "unrouted" case (client not in the directory) by
  revealing an HR picker and letting the AM resubmit against a manually
  selected HR — the exact fallback flow designed back when the routing
  logic was first discussed.
- "Release Offer" button on `CandidateDetailPage`, visible only when a
  candidate is still in the `requested` stage, wired to invalidate the
  tracker, dashboard, and event history so every view reflects the
  change immediately without a manual refresh.

### Verification performed before shipping

- 5 new tests on `release_offer` covering: successful release from
  `requested`, rejection from every other stage (parametrized across
  all 6 non-requested stages), rejection for a candidate invisible to
  the caller, confirmation that an event gets logged with the correct
  actor, and confirmation that the UPDATE call itself is tenant-scoped
  (not just the preceding read) — 32 backend tests total, all passing.
- Frontend type-checks cleanly and produces a real production build;
  confirmed `PublicOfferForm` and the updated `CandidateDetailPage`
  compiled into substantial real bundles (7KB and 8KB respectively),
  not placeholder stubs.

## What's new in Milestone 4

The CTC Structure Builder and the block-based Letter Editor — the two
admin-facing configuration tools that everything downstream depends on.
This milestone builds the *content*, not generation itself (that's
Milestone 5).

**CTC formula engine** (`ctc_engine.py`), ported from the desktop app
and extended with a guided-builder translator (percent-of, flat, and
slab component types → formula strings, evaluated by the same safe
AST-walker either way — never `eval()`). **Found and fixed a real bug
while testing it**: the slab translator built its nested `IF()` chain
with thresholds in the wrong order, so a monthly CTC well above every
bracket could silently fall into the *wrong* (lower) tax slab, since
`IF()` short-circuits on the first true condition. Caught by testing a
realistic high-CTC case, not just the boundary values — kept as a
permanent regression test.

**CTC Structure Service** — versioning (editing a structure never
mutates it, always creates a new version, so historical offers stay
tied to the formula that actually produced them) and clone-across-
locations, both with dedicated tests. Structures are scoped per
location — Super User manages any location in their tenant, HR manages
only their own; both can view.

**Letter Template Service** — block-based content (Heading, Paragraph,
Bullet/Numbered List, CTC Table marker, Signature), placeholder
scanning that splits detected placeholders into recognized (auto-
filled) vs. custom (need a mandatory flag or a default value — the
review step feeds directly into the UI's "Review Placeholders" panel).
**Found and fixed a second real bug while wiring this up**: my first
draft of the create-template endpoint had a broken, nonsensical
parameter signature that looked like it enforced "Super User only" but
enforced nothing at all — the same category of mistake as the Milestone
1 platform-key bug. Fixed using the existing `SuperUser` dependency
type and verified with real HTTP requests, not just source inspection.

**Frontend**: real `CtcStructuresPage` (guided component picker with
percent-of/flat/slab presets plus a raw-formula escape hatch, a live
"Test This Structure" panel, and a location picker for Super Users
creating a brand-new structure) and `LetterTemplatesPage` (the block
editor itself — paragraphs support multiple text runs each with its own
bold toggle, since preserving mixed-run bold within one paragraph is
exactly what mattered in the real iBridge letters reviewed earlier in
this project; a placeholder picker dropdown inserts tokens as their own
run rather than requiring the admin to type `{{...}}` by hand; branding
upload for logo/signature).

**A route-permission mismatch caught before shipping**: the CTC
structures backend deliberately allows HR to manage their own location
(not Super-User-only), but my first pass at the frontend route gated
the whole page behind `RequireSuperUser` anyway — which would have
silently blocked HR from a page they're actually allowed to use.
Caught by cross-checking the route guard against the actual backend
endpoint signatures rather than assuming they matched, and fixed before
packaging.

### Verification performed before shipping

- 28 new backend tests (22 for the formula engine's security and slab
  logic, 6 for structure versioning/cloning) — **60 backend tests
  total, all passing** (verified by actually running the count, not
  estimating it).
- Confirmed with real HTTP requests (not just reading the source) that
  every new endpoint is registered and correctly rejects unauthenticated
  access.
- Frontend type-checks cleanly and produces a real production build —
  confirmed `CtcStructuresPage` (11KB) and `LetterTemplatesPage` (13KB)
  compiled into substantial real bundles.
- A known, deliberate simplification for this milestone: bullet/numbered
  list items support a single text run each (no mixed bold within one
  list item yet) — paragraphs and headings get full multi-run support
  where it was proven to matter most.

## What's new in Milestone 5

Real document generation — the block content and CTC structures built
in Milestone 4 now actually become `.docx` files for real candidates,
and releasing an offer produces a genuine attached letter instead of
just a tracker state change.

**`document_generator.py`** compiles block content into a `.docx`,
porting two pieces of logic *exactly* from the desktop app because both
were the product of real bugs found through actual visual verification,
not just written once and trusted:
- Placeholder substitution happens per-run, never by collapsing a
  paragraph — collapsing silently destroys bold on specific words.
- The CTC table's exact formatting (measured column widths, "auto"/black
  border color, centered numeric columns, a genuine two-line "Yearly /
  (INR)" header, spacer rows positioned after a subtotal rather than
  before it).

**Two more real bugs found this milestone, both caught by actually
rendering the output through LibreOffice and looking at it** — not by
reading the code:
1. A sloppy no-op line in the heading block handler (`x.font.size =
   x.font.size`, changing nothing) — fixed to set a real, distinct
   heading size.
2. The CTC table was using Python's default Western digit grouping
   ("1,200,000") instead of the Indian grouping ("12,00,000") that was
   specifically supposed to be preserved — the correct formatter already
   existed and was used for other placeholders, it just wasn't reused in
   this one call site. Confirmed via a rendered PDF, not a passing
   assertion, and now covered by a permanent test.

**A third, more serious bug found while wiring the pieces together**:
the `Candidate` Pydantic model was missing `offer_letter_path`,
`appointment_letter_path`, and `relieving_letter_path` — even though the
database schema has always had them, and `release_offer` explicitly
writes to one. Pydantic v2 silently drops fields a model doesn't
declare, so this would have meant a real candidate's letter path quietly
vanished the moment their database row was parsed back into a
`Candidate` object — breaking the download feature with no error
anywhere. Fixed, and now guarded by a dedicated test that fails loudly
if the model and schema ever drift apart again.

**`LetterGenerationService`** ties candidate data, the tenant's active
template, an optional CTC structure, and uploaded logo/signature
together into one generated file, uploaded to Supabase Storage.

**`release_offer` now generates for real, fail-closed**: document
generation must succeed *before* the tracker stage ever changes — there
is deliberately no state where a candidate shows as "Offered" with no
actual letter behind it. Verified with tests that check
`CandidateService.release_offer` is never even called if generation
fails first.

**Frontend**: the Candidate Detail page now shows a CTC structure picker
before releasing an offer (when the tenant has one configured for that
location), and a download button for each generated letter — clicking
it fetches a fresh, time-limited signed URL rather than exposing a raw
storage path.

### Verification performed before shipping

- 16 new backend tests (12 for the document generator's bold-preservation,
  CTC table formatting, and mandatory-placeholder blocking; 2 for the
  fail-closed release_offer integration; 2 guarding against the
  Candidate model/schema drift bug) — **76 backend tests total, all
  passing**, confirmed by actually running the count.
- Generated a full realistic Offer Letter (heading, bold placeholders, a
  computed CTC table, a signature placeholder) and rendered it through
  LibreOffice to a real PDF, visually confirming correct output — this
  is what caught the digit-grouping bug that pure XML-level assertions
  had missed on the first pass.
- Frontend type-checks cleanly and produces a real production build;
  confirmed `CandidateDetailPage` grew from 5.23KB to 6.95KB with the
  new download/CTC-picker functionality — a real, substantive change,
  not a no-op.

## What's new in Milestone 6

The tracker's remaining two pieces from the original design conversation:
notification log visibility and filterable Excel export. The append-only
event history (`candidate_events`) and notification logging itself
(`notification_log`) were actually already built back in Milestones 1-3
— every email send has always been logged with its recipients and
success/failure status — but nothing yet exposed that data anywhere.
This milestone adds the viewing/export surface on top of data that was
already being captured correctly.

**A real routing bug found and fixed**: `/candidates/export` was
registered *after* `/candidates/{candidate_id}` in the endpoints file.
FastAPI/Starlette resolve routes in registration order, so a request to
`/candidates/export` was being captured by the earlier, more general
`{candidate_id}` route — which then failed UUID validation on the
literal string "export" with a 422, and the export endpoint's own logic
never ran at all. This was invisible to a shallow test: an
*unauthenticated* request returns 401 either way (this FastAPI version
runs the auth dependency before path parameter validation), so the bug
only became visible once I made a properly authenticated request and
checked *which service method actually got called* — not just the
status code. Fixed by moving the static route ahead of the parameterized
one, and covered by a permanent regression test that fails loudly if
this order ever gets disturbed again.

**Backend**:
- `GET /candidates/{id}/notifications` — every email sent for a
  candidate, proof of delivery or failure, with the same 404-for-
  invisible-candidate pattern already used for event history.
- `GET /candidates/export` — filterable Excel export (stage, date range,
  recruiter, Account Manager), matching the earlier design decision that
  this is for periodic incentive/reporting use, not a single unfiltered
  dump. Account Manager and Recruiter IDs are resolved to actual names
  in batch (one query per lookup table, not one per candidate) — a sheet
  full of UUIDs would be useless for the incentive calculations this is
  actually for.

**Frontend**: a "Notifications Sent" section on the Candidate Detail
page (recipients, subject, sent/failed status, timestamp), and an
"Export to Excel" panel on the Recruitment Tracker with date-range
filters that triggers a real file download.

### Verification performed before shipping

- 4 new backend tests: 2 for the Excel export's name-resolution and
  batch-query-efficiency, 2 for the route-ordering regression — **78
  backend tests total, all passing**, confirmed by actually running the
  count rather than estimating it.
- The routing bug was verified with a real authenticated request and a
  mocked service layer, checking which method was actually invoked —
  not just the HTTP status code, which was misleading on its own.
- Frontend type-checks cleanly and produces a real production build;
  confirmed `RecruitmentPage` (3.98KB → 5.81KB) and `CandidateDetailPage`
  (6.95KB → 8.05KB) grew with real, substantive new functionality, not
  no-op changes.

## What's new in Milestone 7

The joining flow — the sequence from an accepted offer through to a
real, active employee: confirm joining, assign an Employee ID, release
the Appointment Letter, and hand the candidate a link to submit their
own documents.

**`CandidateService`** gains three more state-machine transitions,
following the exact same pattern established by `release_offer` in
Milestone 3 — each one only valid from a specific prior stage, raising
rather than silently reinterpreting an out-of-order call:
- `confirm_joining`: `offered`/`revised` → `joined`
- `assign_employee_id`: `joined` → `id_assigned` — auto-suggests the
  next number from the shared cross-location sequence (the atomic
  `increment_employee_id()` Postgres function built back in Milestone 1)
  formatted as `IB-<LOCATION_CODE>-<number>`, but always accepts a
  manual override, per the explicit design requirement that this stays
  a human decision. A new `suggest-employee-id` endpoint previews the
  suggestion without consuming a number from the sequence, so reopening
  the dialog never burns through IDs nobody ended up using.
- `release_appointment`: `id_assigned` → `active` — same fail-closed
  guarantee as `release_offer` (document generation must succeed before
  the stage changes), and on success creates the candidate's
  document-submission token and fires the same AM/HR/Leadership
  notification pipeline.

**A real bug found and fixed via an actual request, not code review**:
the new candidate document upload endpoint declared `document_type`
with FastAPI's `Path(...)`, but it isn't part of the URL template
(`/documents/{token}/upload`) — it's a form field submitted alongside
the file. This would have broken the endpoint the moment a real
multipart request hit it. Caught by actually making one (not by reading
the code or confirming the app imports, which both looked fine) and
fixed by switching to `Form(...)`; now covered by a permanent
regression test that submits a real multipart request.

**Backend**: the candidate-facing document link (`/public/documents/
{token}`) deliberately allows multiple uploads over its 30-day validity
window rather than expiring after the first submission — a candidate
realistically submits PAN, Aadhaar, and a resume across a few visits,
not as one atomic batch.

**Frontend**: a "Next Action" panel on the Candidate Detail page that
shows the right action for the candidate's current stage (Confirm
Joining → Assign Employee ID → Release Appointment Letter), and a new
public `DocumentUploadPage` — no login, greets the candidate by name,
shows which documents are already submitted, lets them upload the rest.

### Verification performed before shipping

- 20 new backend tests: 16 for the joining-flow state machine (including
  parametrized coverage of every wrong-stage rejection, and confirming
  the manual-override path never touches the atomic RPC), 4 for document
  submission (including the Path/Form regression) — **98 backend tests
  total, all passing**.
- The document upload fix was verified with an actual multipart HTTP
  request through the full FastAPI stack, not just an import check.
- Frontend type-checks cleanly and produces a real production build;
  confirmed `DocumentUploadPage` compiled as a genuine new 3.53KB bundle
  and `CandidateDetailPage` grew from 8.05KB to 12.55KB with real
  functional additions.

## What's new in Milestone 8

The exit flow, and the first genuinely scheduled background jobs in
this project — everything before this ran in direct response to a
request; this milestone adds work that has to happen on its own, once
a day, with no one watching.

**`CandidateService`** gains three more state-machine transitions,
consistent with every prior milestone's pattern:
- `log_resignation`: `active` → `resigned`, records both a resignation
  date and Last Working Day, and — the one email in this entire system
  sent directly to an employee's own address rather than the internal
  AM/HR/Leadership distribution — confirms their LWD to them.
- `mark_clearance_received`: a manual checkbox, exactly as designed —
  this system never verifies clearance itself, it only records that HR
  has confirmed the Client told them clearance came through.
- `release_relieving`: gated on `clearance_received`, and that gate
  lives in the **service layer itself**, not just hidden behind a UI
  state — so no future caller (a different endpoint, a script, a bug)
  can release a relieving letter before clearance without deliberately
  removing the check.

**Scheduled jobs** (`scheduled_jobs.py`, wired into the FastAPI lifespan
via APScheduler): a daily DOJ reminder and a daily 20-day relieving
reminder, both iterating every active tenant independently. Along the
way, this closed a real gap: `notify_doj_reminder` existed since
Milestone 1 but had never actually been called from anywhere — only the
passive "Joining Today" dashboard section (Milestone 2) existed, not
the active email.

**Verified with something more than an import check**: a plain `from
app.main import app` would never catch a broken job registration, since
`scheduler.add_job()` only runs inside the FastAPI lifespan context
manager, not at module import time. Confirmed the scheduler actually
starts, both jobs register with their correct cron triggers, and it
shuts down cleanly by exercising the real lifespan via `TestClient`'s
`with` block.

**Frontend**: three more "Next Action" panels on the Candidate Detail
page — Log Resignation (visible only when `active`), and a combined
Clearance/Release panel for `resigned` candidates that only reveals the
"Release Relieving Letter" button once clearance is actually recorded,
mirroring the backend's own gate in the UI (not a substitute for it).

### Verification performed before shipping

- 21 new backend tests: 16 for the exit-flow state machine (with the
  clearance gate specifically tested both for correct rejection and
  correct success), 5 for the scheduler wiring and both reminder jobs'
  iteration/dispatch logic — **119 backend tests total, all passing**.
- The scheduler test suite exercises the real FastAPI lifespan, not
  just an import — this is what actually proves the jobs get registered
  correctly, not just that the code defining them is syntactically valid.
- Frontend type-checks cleanly and produces a real production build;
  confirmed `CandidateDetailPage` grew from 12.55KB to 16.41KB with the
  new exit-flow panels.

## What's new in Milestone 9

Hike Letter and Revise Offer — the two remaining letter-generating
actions from the original workflow design, each following a
deliberately different data pattern from everything built so far.

**Hike Letter is an append-only log, not a stage transition** — the
candidate's stage stays `active` across any number of hikes over their
tenure, since an employee can receive multiple raises and none of them
change what stage they're in. The property that mattered most here:
**`previous_ctc` is always derived by the service itself**, never
supplied by the caller — it's the most recent hike's `revised_ctc`, or
the candidate's original `proposed_ctc` if they've never had one. A
structural test confirms `release_hike`'s signature doesn't even accept
a `previous_ctc` parameter, so there's no way for a caller to pass one
in and have it silently drift out of sync with a candidate's real
history across their second, third, or later hike.

**Revise Offer overwrites and tags "Revised"** — a deliberately
different pattern from CTC structures (which version) and hikes (which
append), matching the explicit design decision made earlier in this
project. Only the fields the caller actually provides get changed;
anything left blank keeps its current value, verified with a test that
checks the update payload contains only what was actually supplied.

**Backend**: `HikeService` (the CTC-derivation logic above) and
`CandidateService.revise_offer()`, both following the same fail-closed
generation-before-record pattern as every prior release action —
document generation must succeed before either the hike log or the
tracker state actually changes.

**Frontend**: a "Revise Offer" toggle next to Release Offer for
`offered`/`revised` candidates, and a "Hike Letters" panel for `active`
employees showing the full history (previous → revised CTC, effective
date) with a form to release a new one.

### Verification performed before shipping

- 16 new backend tests: 6 for `revise_offer`'s state machine and
  partial-update behavior, 10 for the hike CTC-derivation logic
  (including the structural check that `release_hike` can't even accept
  a `previous_ctc` argument) — **135 backend tests total, all passing**.
- Frontend type-checks cleanly and produces a real production build;
  confirmed `CandidateDetailPage` grew from 16.41KB to 21.08KB with the
  new panels.

## What's new in Milestone 10

The Document Vault — HR viewing/downloading everything a candidate has
submitted, and the yearly ZIP backup job.

**Per the explicit design decision made earlier in this project, the
yearly archive is a backup, not a replacement**: originals stay
individually viewable and downloadable in a candidate's record
permanently, even after being bundled into a year's ZIP. Confirmed by
a test that checks archiving never touches or deletes an original
document's `storage_path` — it only ever adds a ZIP file and flips an
`is_archived` flag.

**A real bug found and fixed**: `financial_year` was never actually
being set when a candidate uploaded a document (a gap from Milestone
7). Since the archive job's query filters directly on that field, every
document would have silently never matched, and the yearly archive
would have quietly done nothing, forever, with no error to surface the
problem. Fixed at the upload endpoint, with a permanent regression
test.

**A second bug caught while testing the scheduled job**: `run_yearly_
archive` did its own local import of `DirectoryService`, which
bypassed the module-level mock in tests entirely — traced to the exact
failing line via a full traceback rather than guessing, then fixed by
relying on the already-correct module-level import the other two jobs
use.

**The archive job's trigger is deliberately a daily check, not a
once-a-year cron** — checked every day but only acts on April 1st. A
once-a-year trigger that's ever missed (a deploy outage, a scheduler
restart at the wrong moment) silently never fires again; a daily
no-op self-corrects on the very next day it runs.

**Backend**: `DocumentService` (HR-facing listing + signed downloads,
plus `generate_yearly_archive`), `financial_year_for_date` /
`previous_financial_year` (tested against real calendar boundaries —
March 31 vs. April 1), and `run_yearly_archive` wired into the same
scheduler as the DOJ and relieving reminders.

**Frontend**: a "Documents" section on the Candidate Detail page
listing every submitted document with its type, upload date, financial
year, and backup status, each with its own download button.

### Verification performed before shipping

- 10 new backend tests: 6 for `DocumentService` (financial-year math,
  archive integrity, and resilience to a single missing/corrupt file
  during bundling), 4 for the scheduled job's April-1st-only trigger
  and tenant/location iteration — **145 backend tests total, all
  passing**.
- Frontend type-checks cleanly and produces a real production build;
  confirmed `CandidateDetailPage` grew from 21.08KB to 22.76KB with the
  new Documents panel.

---

## Closing summary: the full 10-milestone build

Every milestone in the original plan is now built and tested — 145
backend tests, real production frontend builds confirmed at every
step, and a running total of real bugs found and fixed through actual
verification (rendering documents through LibreOffice and looking at
them, making genuine authenticated HTTP requests instead of trusting
that code "looked right," tracing failures to exact source lines
instead of guessing):

- A critical, completely unprotected platform-owner authentication gap (Milestone 1)
- A Pydantic model silently missing fields the database always had (Milestone 5)
- Digit-grouping and CTC-table formatting bugs caught only by rendering actual output (Milestone 5)
- A route-ordering bug where a static path was silently captured by a parameterized one (Milestone 6)
- A `Path()`/`Form()` mixup that would have broken a real multipart upload on first use (Milestone 7)
- A slab-formula ordering bug that could put someone in the wrong tax bracket (Milestone 4)
- A financial-year field that was never actually being set, silently breaking archival forever (Milestone 10)

None of these were found by "the code looks right" — each one required actually running something and checking the real result, which is the same standard this whole build has tried to hold throughout.

**What remains before this is a real, usable product**: none of it has
ever been deployed. Every test in this project has run against fake,
placeholder Supabase credentials — the query logic, access boundaries,
and generation pipeline are thoroughly verified, but nobody has yet
clicked through this against a live database with real data. The
natural next step is exactly what was discussed earlier: create a real
Supabase project, run the schema, deploy the backend to Render and the
frontend to a static host, and walk through the actual first-tenant
setup end to end.
