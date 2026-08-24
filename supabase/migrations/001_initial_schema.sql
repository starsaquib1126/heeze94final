-- ============================================================
-- IBridge HR Portal — Database Schema
-- Milestone 1: Auth + Multi-Tenant Foundation
-- ============================================================
-- Design principles:
--   - Every tenant's data is isolated via tenant_id + RLS
--   - Platform Owner (Saquib) sees only tenant provisioning,
--     never any client HR data
--   - Employee ID uniqueness enforced atomically at DB level
--   - Append-only tables (events, notifications) never UPDATE
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- PLATFORM LEVEL (Saquib's layer — provisioning only)
-- ============================================================

CREATE TABLE tenants (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,            -- e.g. "iBridge Techsoft Private Limited"
    slug            TEXT NOT NULL UNIQUE,     -- e.g. "ibridge" — used in URLs
    is_active       BOOLEAN NOT NULL DEFAULT true,
    plan            TEXT NOT NULL DEFAULT 'trial',  -- trial | active | suspended
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Employee ID sequence — one row per tenant, atomically incremented.
-- This is the single source of truth for cross-location uniqueness.
-- Never UPDATE this directly — always use the increment_employee_id() function.
CREATE TABLE employee_id_sequences (
    tenant_id       UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    last_number     INTEGER NOT NULL DEFAULT 1000,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Atomic increment function — PostgreSQL guarantees no two concurrent
-- calls ever return the same number, even from different locations.
CREATE OR REPLACE FUNCTION increment_employee_id(p_tenant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_next INTEGER;
BEGIN
    UPDATE employee_id_sequences
    SET    last_number = last_number + 1,
           updated_at  = NOW()
    WHERE  tenant_id = p_tenant_id
    RETURNING last_number INTO v_next;

    IF NOT FOUND THEN
        INSERT INTO employee_id_sequences (tenant_id, last_number)
        VALUES (p_tenant_id, 1001)
        RETURNING last_number INTO v_next;
    END IF;

    RETURN v_next;
END;
$$;

-- ============================================================
-- TENANT STRUCTURE
-- ============================================================

CREATE TABLE locations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,             -- e.g. "Noida", "Bengaluru"
    location_code   TEXT NOT NULL,             -- e.g. "NOI", "BLR" — used in employee IDs
    address         TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, location_code)
);

-- ============================================================
-- USERS (only HR + Super User have logins)
-- ============================================================

-- Extends Supabase's auth.users — one row per authenticated user.
-- Account Managers, Recruiters, Leadership, Candidates never appear here.
CREATE TABLE user_profiles (
    id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    location_id     UUID REFERENCES locations(id),  -- NULL = Super User (tenant-wide)
    full_name       TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('super_user', 'hr')),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- DIRECTORY (configured once by Super User, drives routing)
-- ============================================================

-- Which client company routes to which location/HR
CREATE TABLE directory_clients (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    client_name     TEXT NOT NULL,
    location_id     UUID NOT NULL REFERENCES locations(id),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, client_name)
);

-- Account Managers — the people who submit offer requests via the public link
CREATE TABLE directory_account_managers (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    full_name       TEXT NOT NULL,
    email           TEXT NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, email)
);

-- Recruiters — captured in requests for data/incentive tracking only
CREATE TABLE directory_recruiters (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    full_name       TEXT NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Leadership — who gets CC'd on all communications
-- Core Director is tenant-wide (location_id NULL); Location Directors are per-location
CREATE TABLE directory_leadership (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    location_id     UUID REFERENCES locations(id),  -- NULL = Core Director (company-wide)
    full_name       TEXT NOT NULL,
    email           TEXT NOT NULL,
    role_label      TEXT,                -- e.g. "Core Director", "Regional Head"
    is_constant     BOOLEAN NOT NULL DEFAULT false, -- true for hr@ibridgetechsoft.com type entries
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CTC STRUCTURES (per location, versioned on edit)
-- ============================================================

CREATE TABLE ctc_structures (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    location_id     UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,         -- e.g. "CTC with PF"
    version         INTEGER NOT NULL DEFAULT 1,
    is_current      BOOLEAN NOT NULL DEFAULT true,  -- only one current per name per location
    cloned_from_id  UUID REFERENCES ctc_structures(id),  -- tracks clone lineage
    created_by      UUID REFERENCES user_profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(location_id, name, version)
);

CREATE TABLE ctc_line_items (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    structure_id    UUID NOT NULL REFERENCES ctc_structures(id) ON DELETE CASCADE,
    key             TEXT NOT NULL,
    label           TEXT NOT NULL,
    section         TEXT NOT NULL DEFAULT 'Earnings',
    -- guided_type: which formula-translation the engine applies.
    -- NULL means raw formula (custom/escape-hatch path handled the same
    -- as 'custom' — both skip guided translation entirely).
    guided_type     TEXT CHECK (guided_type IN (
                        'percent_of', 'flat', 'slab', 'custom'
                    )),
    formula         TEXT,                 -- raw formula for custom/escape-hatch items
    -- guided params stored as JSONB for the common cases, e.g.:
    -- {"type": "percent_of", "base": "basic_monthly", "percent": 40}
    -- {"type": "flat", "amount": 1800}
    -- {"type": "slab", "slabs": [{"max": 15000, "value": 0}, {"min": 15001, "value": 200}]}
    guided_params   JSONB,
    display_text    TEXT DEFAULT '',      -- "*As Applicable" etc.
    is_subtotal     BOOLEAN NOT NULL DEFAULT false,
    spacer_after    BOOLEAN,
    item_order      INTEGER NOT NULL DEFAULT 0,
    UNIQUE(structure_id, key)
);

-- ============================================================
-- LETTER TEMPLATES (per tenant, block-editor content)
-- ============================================================

CREATE TABLE letter_templates (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    letter_type         TEXT NOT NULL CHECK (letter_type IN (
                            'offer', 'appointment', 'hike', 'relieving',
                            'experience', 'confirmation', 'warning', 'appreciation', 'promotion'
                        )),
    name                TEXT NOT NULL,
    -- Full block editor content stored as JSONB array of blocks
    blocks              JSONB NOT NULL DEFAULT '[]',
    -- Compiled .docx stored in Supabase Storage; path relative to tenant's bucket
    docx_storage_path   TEXT,
    -- Which placeholders are marked mandatory by the admin
    mandatory_placeholders  TEXT[] NOT NULL DEFAULT '{}',
    -- Custom placeholder defaults set at template registration time
    custom_placeholder_defaults JSONB NOT NULL DEFAULT '{}',
    is_active           BOOLEAN NOT NULL DEFAULT true,
    version             INTEGER NOT NULL DEFAULT 1,
    created_by          UUID REFERENCES user_profiles(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tenant-level branding assets (logo + signature — one set per tenant)
CREATE TABLE tenant_branding (
    tenant_id           UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    logo_storage_path   TEXT,
    signature_storage_path  TEXT,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CANDIDATES & TRACKER
-- ============================================================

CREATE TABLE candidates (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    location_id             UUID NOT NULL REFERENCES locations(id),

    -- Request details
    request_date            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    account_manager_id      UUID REFERENCES directory_account_managers(id),
    recruiter_id            UUID REFERENCES directory_recruiters(id),
    client_name             TEXT NOT NULL,

    -- Candidate details (from AM's public form)
    full_name               TEXT NOT NULL,
    email                   TEXT NOT NULL,
    phone                   TEXT,
    designation             TEXT,
    department              TEXT,
    work_location           TEXT,
    proposed_ctc            NUMERIC(14, 2),
    expected_doj            DATE,
    -- Selected by the Account Manager on the offer request (or HR, for
    -- direct creation) — drives the Employer PF formula at generation
    -- time: 'standard' (capped at ₹1,800 once salary crosses the
    -- threshold), 'max' (full 12%, no cap), 'none' (PF excluded
    -- entirely).
    pf_type                 TEXT NOT NULL DEFAULT 'standard'
                             CHECK (pf_type IN ('standard', 'max', 'none')),

    -- Current pipeline stage
    stage                   TEXT NOT NULL DEFAULT 'requested' CHECK (stage IN (
                                'requested',      -- AM submitted, HR not yet acted
                                'offered',        -- Offer Letter released
                                'revised',        -- Offer revised (most recent is active)
                                'joined',         -- Joining confirmed
                                'id_assigned',    -- Employee ID assigned
                                'active',         -- Appointment Letter sent, docs submitted
                                'rejected',       -- Declined or no-show
                                'resigned',       -- Submitted resignation
                                'exited'          -- Relieving Letter released
                            )),

    -- Offer tracking
    offer_released_at       TIMESTAMPTZ,
    offer_letter_path       TEXT,
    is_revised              BOOLEAN NOT NULL DEFAULT false,

    -- Joining tracking
    confirmed_doj           DATE,
    employee_id             TEXT,              -- e.g. "IB-NOI-1042"
    employee_id_auto        BOOLEAN,           -- true = auto-assigned, false = manual override
    employee_id_number      INTEGER,           -- the raw sequence number

    -- Post-joining
    appointment_released_at TIMESTAMPTZ,
    appointment_letter_path TEXT,
    documents_link_sent_at  TIMESTAMPTZ,
    documents_submitted_at  TIMESTAMPTZ,

    -- Exit
    resignation_date        DATE,
    last_working_day        DATE,
    clearance_received      BOOLEAN NOT NULL DEFAULT false,
    clearance_date          DATE,
    relieving_released_at   TIMESTAMPTZ,
    relieving_letter_path   TEXT,

    -- Meta
    hr_owner_id             UUID REFERENCES user_profiles(id),
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only event history — never UPDATE, only INSERT
CREATE TABLE candidate_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    candidate_id    UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_type      TEXT NOT NULL CHECK (event_type IN (
                        'request_raised',
                        'offer_released', 'offer_revised',
                        'joining_confirmed', 'employee_id_assigned',
                        'appointment_released',
                        'documents_link_sent', 'documents_submitted',
                        'hike_released',
                        'resignation_logged', 'lwd_set',
                        'clearance_received', 'relieving_released',
                        'rejected', 'note_added'
                    )),
    performed_by    UUID REFERENCES user_profiles(id),  -- NULL for system events
    details         JSONB NOT NULL DEFAULT '{}', -- varies per event type
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only notification log — proof of delivery
CREATE TABLE notification_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    candidate_id    UUID REFERENCES candidates(id) ON DELETE SET NULL,
    event_type      TEXT NOT NULL,
    recipients      JSONB NOT NULL,   -- [{email, name, role}, ...]
    subject         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
    error_message   TEXT,
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Verifies the Account Manager submitting a public offer request is
-- genuinely them: a one-time code emailed to their registered address
-- (never one they type themselves) before their request is accepted.
-- Single-use, short-lived.
CREATE TABLE am_verification_codes (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    account_manager_id  UUID NOT NULL REFERENCES directory_account_managers(id) ON DELETE CASCADE,
    code                TEXT NOT NULL,
    expires_at          TIMESTAMPTZ NOT NULL,
    used_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_am_verification_codes_am ON am_verification_codes (account_manager_id, created_at DESC);

-- Hike letters (separate from offer/appointment — repeatable per employee)
CREATE TABLE hike_letters (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    candidate_id    UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    previous_ctc    NUMERIC(14, 2) NOT NULL,
    revised_ctc     NUMERIC(14, 2) NOT NULL,
    effective_date  DATE NOT NULL,
    letter_path     TEXT,
    released_by     UUID REFERENCES user_profiles(id),
    released_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- DOCUMENT VAULT
-- ============================================================

CREATE TABLE candidate_documents (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    candidate_id    UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    document_type   TEXT NOT NULL,   -- "pan", "aadhaar", "resume", "photo", etc.
    original_name   TEXT NOT NULL,
    storage_path    TEXT NOT NULL,   -- Supabase Storage path
    financial_year  TEXT,            -- e.g. "2025-26" — set when archived
    is_archived     BOOLEAN NOT NULL DEFAULT false,
    archived_zip_path TEXT,          -- path to the FY zip if archived
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CANDIDATE DOCUMENT REQUEST
-- (the one-time link sent to candidate post-appointment)
-- ============================================================

CREATE TABLE document_request_tokens (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    candidate_id    UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    token           TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
    used_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Personal/bank/statutory details a new joiner submits themselves via
-- the same private token link used for document uploads — replaces the
-- real "Urgent: Bank & Personal Details" manual email process. Kept as
-- its own table, deliberately separate from `candidates`, because this
-- is meaningfully more sensitive data (bank account, PAN, Aadhaar, DOB)
-- than anything else in the system — never included in the general
-- tracker view or bulk exports, only accessible via a dedicated view.
CREATE TABLE candidate_personal_details (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    candidate_id                UUID NOT NULL UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,

    -- Personal
    name_as_per_pan             TEXT,
    contact_number              TEXT,
    emergency_contact_name      TEXT,
    emergency_contact_relation  TEXT,
    emergency_contact_mobile    TEXT,
    date_of_birth               DATE,
    blood_group                 TEXT,
    aadhaar_number               TEXT,
    pan_number                   TEXT,
    pf_uan_number                 TEXT,
    fathers_name                  TEXT,
    mothers_name                  TEXT,
    temporary_address             TEXT,
    permanent_address             TEXT,

    -- Bank
    bank_account_holder_name     TEXT,
    bank_name                     TEXT,
    bank_account_number           TEXT,
    bank_ifsc_code                 TEXT,
    bank_branch_name               TEXT,

    -- Insurance / dependents
    insurance_option                TEXT CHECK (insurance_option IN ('self', 'family')),
    spouse_name                     TEXT,
    spouse_dob                      DATE,
    child_1_name                    TEXT,
    child_1_gender                  TEXT,
    child_1_dob                     DATE,
    child_2_name                    TEXT,
    child_2_gender                  TEXT,
    child_2_dob                     DATE,

    -- Statutory — from the real PF filing spreadsheet, not just the email
    nationality                     TEXT,
    qualification                   TEXT,
    marital_status                  TEXT CHECK (marital_status IN ('married', 'unmarried')),
    is_international_worker         BOOLEAN NOT NULL DEFAULT FALSE,
    country_of_origin               TEXT,
    passport_number                  TEXT,
    passport_valid_from              DATE,
    passport_valid_to                DATE,
    has_physical_handicap            BOOLEAN NOT NULL DEFAULT FALSE,
    has_locomotive_disability        BOOLEAN NOT NULL DEFAULT FALSE,
    has_hearing_disability           BOOLEAN NOT NULL DEFAULT FALSE,
    has_visual_disability            BOOLEAN NOT NULL DEFAULT FALSE,
    previous_pf_member_id            TEXT,

    submitted_at                     TIMESTAMPTZ,
    created_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Enable RLS on every tenant-scoped table
ALTER TABLE locations                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE directory_clients          ENABLE ROW LEVEL SECURITY;
ALTER TABLE directory_account_managers ENABLE ROW LEVEL SECURITY;
ALTER TABLE directory_recruiters       ENABLE ROW LEVEL SECURITY;
ALTER TABLE directory_leadership       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ctc_structures             ENABLE ROW LEVEL SECURITY;
ALTER TABLE ctc_line_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE letter_templates           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_branding            ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidates                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE hike_letters               ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_documents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_request_tokens    ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_personal_details ENABLE ROW LEVEL SECURITY;

-- Helper: get the current user's profile
CREATE OR REPLACE FUNCTION auth_user_profile()
RETURNS user_profiles
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT * FROM user_profiles WHERE id = auth.uid()
$$;

-- Helper: get the current user's tenant_id
CREATE OR REPLACE FUNCTION auth_tenant_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT tenant_id FROM user_profiles WHERE id = auth.uid()
$$;

-- Helper: get the current user's role
CREATE OR REPLACE FUNCTION auth_user_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT role FROM user_profiles WHERE id = auth.uid()
$$;

-- Helper: get the current user's location_id (NULL if super_user)
CREATE OR REPLACE FUNCTION auth_location_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT location_id FROM user_profiles WHERE id = auth.uid()
$$;

-- ---- Policies ----
-- Pattern: Super User sees everything in their tenant.
--          HR sees only their own location's data.
--          Platform Owner has no RLS policies here (they use a service key
--          scoped to the tenants table only, never tenant data).

-- Locations
CREATE POLICY "tenant_isolation" ON locations
    FOR ALL USING (tenant_id = auth_tenant_id());

-- User profiles
CREATE POLICY "tenant_isolation" ON user_profiles
    FOR ALL USING (tenant_id = auth_tenant_id());

-- Directory tables
CREATE POLICY "tenant_isolation" ON directory_clients
    FOR ALL USING (tenant_id = auth_tenant_id());
CREATE POLICY "tenant_isolation" ON directory_account_managers
    FOR ALL USING (tenant_id = auth_tenant_id());
CREATE POLICY "tenant_isolation" ON directory_recruiters
    FOR ALL USING (tenant_id = auth_tenant_id());
CREATE POLICY "tenant_isolation" ON directory_leadership
    FOR ALL USING (tenant_id = auth_tenant_id());

-- CTC structures — Super User sees all, HR sees only their location
CREATE POLICY "super_user_all" ON ctc_structures
    FOR ALL USING (
        tenant_id = auth_tenant_id()
        AND auth_user_role() = 'super_user'
    );
CREATE POLICY "hr_own_location" ON ctc_structures
    FOR SELECT USING (
        tenant_id = auth_tenant_id()
        AND auth_user_role() = 'hr'
        AND location_id = auth_location_id()
    );

CREATE POLICY "via_structure" ON ctc_line_items
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM ctc_structures s
            WHERE s.id = ctc_line_items.structure_id
            AND s.tenant_id = auth_tenant_id()
            AND (
                auth_user_role() = 'super_user'
                OR s.location_id = auth_location_id()
            )
        )
    );

-- Letter templates — tenant-wide (same template for all locations)
CREATE POLICY "tenant_isolation" ON letter_templates
    FOR ALL USING (tenant_id = auth_tenant_id());
CREATE POLICY "tenant_isolation" ON tenant_branding
    FOR ALL USING (tenant_id = auth_tenant_id());

-- Candidates — Super User sees all, HR sees only their location
CREATE POLICY "super_user_all" ON candidates
    FOR ALL USING (
        tenant_id = auth_tenant_id()
        AND auth_user_role() = 'super_user'
    );
CREATE POLICY "hr_own_location" ON candidates
    FOR ALL USING (
        tenant_id = auth_tenant_id()
        AND auth_user_role() = 'hr'
        AND location_id = auth_location_id()
    );

-- Events and logs follow the same location scoping as candidates
CREATE POLICY "via_candidate" ON candidate_events
    FOR ALL USING (
        tenant_id = auth_tenant_id()
        AND (
            auth_user_role() = 'super_user'
            OR EXISTS (
                SELECT 1 FROM candidates c
                WHERE c.id = candidate_events.candidate_id
                AND c.location_id = auth_location_id()
            )
        )
    );

CREATE POLICY "via_candidate" ON notification_log
    FOR ALL USING (
        tenant_id = auth_tenant_id()
        AND (
            auth_user_role() = 'super_user'
            OR EXISTS (
                SELECT 1 FROM candidates c
                WHERE c.id = notification_log.candidate_id
                AND c.location_id = auth_location_id()
            )
        )
    );

CREATE POLICY "via_candidate" ON hike_letters
    FOR ALL USING (
        tenant_id = auth_tenant_id()
        AND (
            auth_user_role() = 'super_user'
            OR EXISTS (
                SELECT 1 FROM candidates c
                WHERE c.id = hike_letters.candidate_id
                AND c.location_id = auth_location_id()
            )
        )
    );

CREATE POLICY "via_candidate" ON candidate_documents
    FOR ALL USING (
        tenant_id = auth_tenant_id()
        AND (
            auth_user_role() = 'super_user'
            OR EXISTS (
                SELECT 1 FROM candidates c
                WHERE c.id = candidate_documents.candidate_id
                AND c.location_id = auth_location_id()
            )
        )
    );

CREATE POLICY "via_candidate" ON document_request_tokens
    FOR ALL USING (
        tenant_id = auth_tenant_id()
        AND (
            auth_user_role() = 'super_user'
            OR EXISTS (
                SELECT 1 FROM candidates c
                WHERE c.id = document_request_tokens.candidate_id
                AND c.location_id = auth_location_id()
            )
        )
    );

CREATE POLICY "via_candidate" ON candidate_personal_details
    FOR ALL USING (
        tenant_id = auth_tenant_id()
        AND (
            auth_user_role() = 'super_user'
            OR EXISTS (
                SELECT 1 FROM candidates c
                WHERE c.id = candidate_personal_details.candidate_id
                AND c.location_id = auth_location_id()
            )
        )
    );

-- ============================================================
-- TIMESTAMPS: auto-update updated_at on every relevant table
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON candidates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON letter_templates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON tenant_branding
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON candidate_personal_details
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- INDEXES (for the most common query patterns)
-- ============================================================

CREATE INDEX idx_candidates_tenant_location ON candidates (tenant_id, location_id);
CREATE INDEX idx_candidates_stage           ON candidates (tenant_id, stage);
CREATE INDEX idx_candidates_expected_doj    ON candidates (tenant_id, expected_doj);
CREATE INDEX idx_candidates_lwd             ON candidates (tenant_id, last_working_day);
CREATE INDEX idx_personal_details_candidate ON candidate_personal_details (candidate_id);
CREATE INDEX idx_events_candidate           ON candidate_events (candidate_id);
CREATE INDEX idx_events_tenant              ON candidate_events (tenant_id);
CREATE INDEX idx_notif_candidate            ON notification_log (candidate_id);
CREATE INDEX idx_ctc_structures_location    ON ctc_structures (location_id, is_current);
CREATE INDEX idx_dir_clients_tenant         ON directory_clients (tenant_id, client_name);
CREATE INDEX idx_doc_tokens_token           ON document_request_tokens (token);
