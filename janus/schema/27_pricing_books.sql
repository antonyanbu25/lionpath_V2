-- ============================================================================
-- Janus Data Model - Phase H: Pricing reference data
--
-- Three Firestore collections -- priceBooks, addonPriceBooks,
-- assumptionsBooks -- with no Postgres representation at all. They are
-- effective-dated reference data (spec 7.3): the ARR estimate on a deal cites
-- arrPriceBookVersion and assumptionsBookVersion, so a re-run must be able to
-- find the rows that were in force then.
--
-- Shapes taken from worker/src/domain-model/price-book.ts. The current seed
-- is a hardcoded TypeScript constant (price-book-seed.ts, version
-- 2026-07-24-usd-list); these tables are where it goes.
--
-- Not org-scoped: pricing is a Freshworks list price, identical for everyone,
-- and D2 keeps org scoping out of anything that does not need it.
--
-- Idempotent. Run after 26_account_se_team.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. price_book: product x tier x currency x term
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_book (
    id             text PRIMARY KEY,          -- pb_{product}_{tier}_{cur}_{term}_{from}
    product        text NOT NULL,
    tier           text NOT NULL,
    currency       text NOT NULL,
    term           text NOT NULL,
    unit           text NOT NULL,
    -- NULL price with quote_only=true is an explicit match, not a miss: the
    -- lookup returns found:true, price:null and must never fall back to a
    -- different tier (price-book/lookup.ts).
    price          numeric,
    quote_only     boolean NOT NULL DEFAULT false,
    source         text,
    version        text NOT NULL,
    effective_from date NOT NULL,
    effective_to   date,
    created_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_price_book_quote CHECK (quote_only OR price IS NOT NULL),
    CONSTRAINT chk_price_book_price CHECK (price IS NULL OR price >= 0),
    CONSTRAINT chk_price_book_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- One live row per lookup key. The partial unique index is what makes
-- "the current price of Freshdesk Pro in USD annual" a single-row answer.
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_book_current
    ON price_book(product, tier, currency, term)
    WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_price_book_lookup
    ON price_book(product, tier, currency, term, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_price_book_version ON price_book(version);

COMMENT ON TABLE price_book IS
    'List price by product/tier/currency/term, effective-dated. A deal cites '
    'arrPriceBookVersion so its ARR can be reproduced from the rows that were '
    'in force at the time.';

COMMENT ON COLUMN price_book.quote_only IS
    'Enterprise tiers with no list price. found:true with price:null -- an '
    'explicit "ask sales", never a reason to fall back to a lower tier.';

-- ----------------------------------------------------------------------------
-- 2. addon_price_book
--
-- appliesTo[] and requiresTier[] are arrays in the Firestore row and stay
-- arrays here: they are matched with the containment operator, not joined,
-- and promoting them to junction tables would add two tables to answer a
-- question one GIN index answers.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS addon_price_book (
    id              text PRIMARY KEY,
    addon           text NOT NULL,
    applies_to      text[] NOT NULL DEFAULT '{}',
    requires_tier   text[] NOT NULL DEFAULT '{}',
    unit            text NOT NULL,
    price           numeric,
    included_units  numeric NOT NULL DEFAULT 0,
    included_scope  text,
    quote_only      boolean NOT NULL DEFAULT false,
    note            text,
    currency        text NOT NULL,
    term            text NOT NULL,
    version         text NOT NULL,
    effective_from  date NOT NULL,
    effective_to    date,
    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_addon_quote CHECK (quote_only OR price IS NOT NULL),
    CONSTRAINT chk_addon_price CHECK (price IS NULL OR price >= 0),
    CONSTRAINT chk_addon_included CHECK (included_units >= 0),
    CONSTRAINT chk_addon_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_addon_price_book_current
    ON addon_price_book(addon, currency, term)
    WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_addon_applies_to  ON addon_price_book USING gin(applies_to);
CREATE INDEX IF NOT EXISTS idx_addon_requires_tier ON addon_price_book USING gin(requires_tier);
CREATE INDEX IF NOT EXISTS idx_addon_lookup
    ON addon_price_book(addon, currency, term, effective_from DESC);

COMMENT ON COLUMN addon_price_book.included_units IS
    'Units bundled before the add-on is charged. 0 means charged from the '
    'first unit; the volume assumptions in assumptions_book decide how many '
    'units a deal is modelled at.';

-- ----------------------------------------------------------------------------
-- 3. assumptions_book
--
-- Scoped assumptions: a key can be global, or overridden per product, tier or
-- segment. scope_value is NULL exactly when scope is global.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assumptions_book (
    id             text PRIMARY KEY,
    key            text NOT NULL,
    scope          text NOT NULL,
    scope_value    text,
    value          numeric NOT NULL,
    source         text,
    rationale      text,
    version        text NOT NULL,
    effective_from date NOT NULL,
    effective_to   date,
    created_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_assumptions_scope CHECK (
        (scope = 'global' AND scope_value IS NULL) OR
        (scope <> 'global' AND scope_value IS NOT NULL)
    ),
    CONSTRAINT chk_assumptions_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_assumptions_current
    ON assumptions_book(key, scope, COALESCE(scope_value, '__global__'))
    WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_assumptions_key ON assumptions_book(key, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_assumptions_version ON assumptions_book(version);

COMMENT ON TABLE assumptions_book IS
    'Volume and ratio assumptions behind an ARR estimate (docs/'
    'ADDON_ARR_VOLUME.md). Versioned so a stored estimate stays explainable '
    'after the assumptions change.';

-- ----------------------------------------------------------------------------
-- 4. Reference data is read by everyone, written by nobody at runtime
--
-- No RLS: these rows contain no customer data and every SE needs all of them
-- to price anything. Writes go through the seed script, which runs as the
-- migration role -- so janus_app gets SELECT only, and a bug in the app
-- cannot silently reprice the catalog.
-- ----------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON price_book       FROM janus_app;
REVOKE INSERT, UPDATE, DELETE ON addon_price_book FROM janus_app;
REVOKE INSERT, UPDATE, DELETE ON assumptions_book FROM janus_app;

GRANT SELECT ON price_book       TO janus_app, janus_readonly;
GRANT SELECT ON addon_price_book TO janus_app, janus_readonly;
GRANT SELECT ON assumptions_book TO janus_app, janus_readonly;

-- ----------------------------------------------------------------------------
-- 5. Point-in-time lookup
--
-- The reason these tables are effective-dated. arrComputedAt on a deal plus
-- these functions reproduce the exact price used, even after a repricing.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION price_book_at(
    p_product  text,
    p_tier     text,
    p_currency text,
    p_term     text,
    p_as_of    date DEFAULT current_date
) RETURNS SETOF price_book
LANGUAGE sql STABLE AS $$
    SELECT * FROM price_book
     WHERE product = p_product AND tier = p_tier
       AND currency = p_currency AND term = p_term
       AND effective_from <= p_as_of
       AND (effective_to IS NULL OR effective_to > p_as_of)
     ORDER BY effective_from DESC
     LIMIT 1;
$$;

COMMENT ON FUNCTION price_book_at(text, text, text, text, date) IS
    'The row in force on a given date. Returns zero rows for no match -- the '
    'caller must treat that as found:false and never substitute a tier.';

CREATE OR REPLACE FUNCTION assumption_at(
    p_key         text,
    p_scope       text DEFAULT 'global',
    p_scope_value text DEFAULT NULL,
    p_as_of       date DEFAULT current_date
) RETURNS numeric
LANGUAGE sql STABLE AS $$
    SELECT value FROM assumptions_book
     WHERE key = p_key
       AND scope = p_scope
       AND scope_value IS NOT DISTINCT FROM p_scope_value
       AND effective_from <= p_as_of
       AND (effective_to IS NULL OR effective_to > p_as_of)
     ORDER BY effective_from DESC
     LIMIT 1;
$$;
