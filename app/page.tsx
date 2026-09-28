"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

type PropertyType = "APARTMENT" | "HOUSE" | "DUPLEX" | "LAND" | "COMMERCIAL" | "OTHER";
type ListingStatus = "ACTIVE" | "PENDING_REVIEW" | "DRAFT" | "SUSPENDED";
type SortKey = "createdAt" | "price" | "title";
type OrderKey = "asc" | "desc";

interface ListingImageInfo {
  id: string;
  uploadedAt: string;
}

interface Listing {
  id: string;
  title: string;
  price: number;
  address: string;
  latitude: number;
  longitude: number;
  country: string | null;
  propertyType: PropertyType;
  status: ListingStatus;
  hasOpenReports: boolean;
  createdAt: string;
  images: ListingImageInfo[];
}

interface ListMeta {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

interface ListEnvelope {
  data: Listing[];
  meta: ListMeta;
}

interface ApiErrorBody {
  error: { code: string; message: string };
}

interface SearchFilters {
  propertyType: "" | PropertyType;
  minPriceNaira: string;
  maxPriceNaira: string;
  sort: SortKey;
  order: OrderKey;
  status: "" | ListingStatus;
}

interface LoadError {
  status: number;
  message: string;
}

const PAGE_SIZE = 20;

const PROPERTY_TYPES: readonly PropertyType[] = [
  "APARTMENT",
  "HOUSE",
  "DUPLEX",
  "LAND",
  "COMMERCIAL",
  "OTHER",
];

const STATUSES: readonly ListingStatus[] = [
  "ACTIVE",
  "PENDING_REVIEW",
  "DRAFT",
  "SUSPENDED",
];

const DEFAULT_FILTERS: SearchFilters = {
  propertyType: "",
  minPriceNaira: "",
  maxPriceNaira: "",
  sort: "createdAt",
  order: "desc",
  status: "",
};

const STATUS_LABELS: Record<ListingStatus, string> = {
  ACTIVE: "Active · live on search",
  PENDING_REVIEW: "Pending review",
  DRAFT: "Draft",
  SUSPENDED: "Suspended",
};

const SORT_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "createdAt:desc", label: "Newest first" },
  { value: "createdAt:asc", label: "Oldest first" },
  { value: "price:asc", label: "Price: low to high" },
  { value: "price:desc", label: "Price: high to low" },
  { value: "title:asc", label: "Title A–Z" },
  { value: "title:desc", label: "Title Z–A" },
];

function formatPrice(smallestUnit: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(smallestUnit / 100);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-NG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadgeClass(status: ListingStatus): string {
  if (status === "ACTIVE") return styles.badgeActive;
  if (status === "SUSPENDED") return styles.badgeDanger;
  if (status === "PENDING_REVIEW") return styles.badgeWarning;
  return styles.badge;
}

function buildUrl(filters: SearchFilters, offset: number): string {
  const params = new URLSearchParams();
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(offset));
  params.set("sort", filters.sort);
  params.set("order", filters.order);
  if (filters.propertyType) params.set("propertyType", filters.propertyType);
  const minNaira = Number(filters.minPriceNaira);
  if (Number.isFinite(minNaira) && minNaira > 0) {
    params.set("minPrice", String(Math.round(minNaira * 100)));
  }
  const maxNaira = Number(filters.maxPriceNaira);
  if (Number.isFinite(maxNaira) && maxNaira > 0) {
    params.set("maxPrice", String(Math.round(maxNaira * 100)));
  }
  // The API defaults to ACTIVE when status is absent, so only a
  // non-active status is sent explicitly.
  if (filters.status && filters.status !== "ACTIVE") {
    params.set("status", filters.status);
  }
  return `/api/v1/listings?${params.toString()}`;
}

function hasActiveFilters(filters: SearchFilters): boolean {
  return (
    filters.propertyType !== "" ||
    filters.minPriceNaira !== "" ||
    filters.maxPriceNaira !== "" ||
    filters.sort !== "createdAt" ||
    filters.order !== "desc" ||
    filters.status !== ""
  );
}

function activeChips(filters: SearchFilters): string[] {
  const chips: string[] = [];
  if (filters.propertyType) chips.push(filters.propertyType);
  if (filters.minPriceNaira) chips.push(`Min ₦${filters.minPriceNaira}`);
  if (filters.maxPriceNaira) chips.push(`Max ₦${filters.maxPriceNaira}`);
  if (filters.status) chips.push(STATUS_LABELS[filters.status]);
  return chips;
}

export default function Home() {
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS);
  const [items, setItems] = useState<Listing[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LoadError | null>(null);
  const [requestedUrl, setRequestedUrl] = useState("");
  const [raw, setRaw] = useState<unknown>(null);

  const tokenRef = useRef(0);

  const runSearch = useCallback(
    async (nextOffset: number) => {
      setLoading(true);
      setError(null);
      const url = buildUrl(filters, nextOffset);
      setRequestedUrl(url);
      const token = ++tokenRef.current;
      try {
        const res = await fetch(url, { headers: { accept: "application/json" } });
        const body = (await res.json().catch(() => null)) as
          | ListEnvelope
          | ApiErrorBody
          | null;
        if (token !== tokenRef.current) return;
        if (!res.ok) {
          const message =
            body !== null && "error" in body
              ? body.error.message
              : `Request failed with status ${res.status}`;
          setRaw(body);
          setItems([]);
          setTotal(0);
          setHasMore(false);
          setOffset(0);
          setError({ status: res.status, message });
          return;
        }
        const envelope = body as ListEnvelope;
        setRaw(body);
        setItems(envelope.data);
        setTotal(envelope.meta.total);
        setHasMore(envelope.meta.hasMore);
        setOffset(envelope.meta.offset);
        setError(null);
      } catch (err) {
        if (token !== tokenRef.current) return;
        setRaw(null);
        setItems([]);
        setTotal(0);
        setHasMore(false);
        setOffset(0);
        setError({
          status: 0,
          message: err instanceof Error ? err.message : "Network error",
        });
      } finally {
        if (token === tokenRef.current) setLoading(false);
      }
    },
    [filters],
  );

  useEffect(() => {
    void runSearch(0);
  }, [runSearch]);

  function onSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch(0);
  }

  function onReset() {
    setFilters(DEFAULT_FILTERS);
    void runSearch(0);
  }

  function onNextPage() {
    if (hasMore) void runSearch(offset + PAGE_SIZE);
  }

  function onPrevPage() {
    if (offset > 0) void runSearch(Math.max(0, offset - PAGE_SIZE));
  }

  return (
    <div className={styles.page}>
      <header className={styles.masthead}>
        <div className={styles.mastheadInner}>
          <p className={`${styles.brand} typography-title-medium`}>Domora</p>
          <h1 className="typography-display-small">Verified property listings.</h1>
          <p className={`${styles.tagline} typography-body-medium`}>
            Browse listings from agents, agencies, and landlords whose identity
            has been verified before their first listing goes live.
          </p>
        </div>
      </header>

      <main className={styles.container}>
        <section className={styles.searchPanel} aria-label="Search properties">
          <form className={styles.searchForm} onSubmit={onSearchSubmit}>
            <label className={styles.field}>
              <span className={`${styles.fieldLabel} typography-label-small`}>
                Property type
              </span>
              <select
                className={styles.select}
                value={filters.propertyType}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    propertyType: e.target.value as SearchFilters["propertyType"],
                  }))
                }
              >
                <option value="">Any</option>
                {PROPERTY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.charAt(0) + type.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span className={`${styles.fieldLabel} typography-label-small`}>
                Min price (₦)
              </span>
              <input
                className={styles.input}
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={filters.minPriceNaira}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, minPriceNaira: e.target.value }))
                }
                placeholder="0"
              />
            </label>

            <label className={styles.field}>
              <span className={`${styles.fieldLabel} typography-label-small`}>
                Max price (₦)
              </span>
              <input
                className={styles.input}
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={filters.maxPriceNaira}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, maxPriceNaira: e.target.value }))
                }
                placeholder="Any"
              />
            </label>

            <label className={styles.field}>
              <span className={`${styles.fieldLabel} typography-label-small`}>
                Sort
              </span>
              <select
                className={styles.select}
                value={`${filters.sort}:${filters.order}`}
                onChange={(e) => {
                  const [sort, order] = e.target.value.split(":") as [SortKey, OrderKey];
                  setFilters((f) => ({ ...f, sort, order }));
                }}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span className={`${styles.fieldLabel} typography-label-small`}>
                Status
              </span>
              <select
                className={styles.select}
                value={filters.status}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    status: e.target.value as SearchFilters["status"],
                  }))
                }
              >
                <option value="">Active (API default)</option>
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>

            <div className={styles.actions}>
              <button type="submit" className={styles.primaryBtn} disabled={loading}>
                {loading ? "Searching…" : "Search"}
              </button>
              <button type="button" className={styles.ghostBtn} onClick={onReset}>
                Reset
              </button>
            </div>
          </form>
        </section>

        <div aria-live="polite">
          <div className={styles.summaryRow}>
            <p className="typography-title-medium">
              {loading
                ? "Searching…"
                : error !== null
                  ? "Search failed"
                  : `${total.toLocaleString("en-NG")} ${total === 1 ? "listing" : "listings"}`}
            </p>
            {activeChips(filters).length > 0 && (
              <div className={styles.chips}>
                {activeChips(filters).map((chip) => (
                  <span key={chip} className={styles.chip}>
                    {chip}
                  </span>
                ))}
              </div>
            )}
          </div>
          <p className={`${styles.apiUrl} typography-body-small`}>
            Request: GET {requestedUrl}
          </p>
        </div>

        {error !== null && (
          <section className={styles.errorBanner} role="alert">
            <p className="typography-title-small">Error ({error.status || "network"}):</p>
            <p className="typography-body-medium">{error.message}</p>
            {error.status === 401 && (
              <p className="typography-body-medium">
                Public browsing is session-gated in this MVP. To inspect the API
                locally,{" "}
                <a href="/api/grant-session?to=/">grant a local dev session</a>{" "}
                (development only), then Search again.
              </p>
            )}
            <p className="typography-body-medium">
              <button type="button" className={styles.ghostBtn} onClick={() => void runSearch(0)}>
                Retry
              </button>
            </p>
          </section>
        )}

        {error === null && items.length === 0 && !loading && (
          <section className={styles.emptyState}>
            <p className="typography-title-medium">No listings match your filters.</p>
            <p className="typography-body-medium">
              Try clearing a filter, or change the status option to browse other
              listing states.
            </p>
          </section>
        )}

        {items.length > 0 && (
          <section className={styles.cards} aria-label="Search results">
            {items.map((listing) => (
              <article key={listing.id} className={styles.card}>
                <div className={styles.cardThumb}>
                  {listing.propertyType.charAt(0) +
                    listing.propertyType.slice(1).toLowerCase() +
                    " · " +
                    listing.id.slice(0, 8)}
                </div>
                <div className={styles.cardBody}>
                  <h2 className={`${styles.cardTitle} typography-title-large`}>
                    {listing.title}
                  </h2>
                  <p className={`${styles.cardAddress} typography-body-medium`}>
                    {listing.address}
                    {listing.country ? `, ${listing.country}` : ""}
                  </p>
                  <div className={styles.cardRow}>
                    <span className={styles.price}>{formatPrice(listing.price)}</span>
                    <span
                      className={`${styles.badge} ${statusBadgeClass(listing.status)}`}
                      title={listing.status}
                    >
                      <span className={styles.dot} aria-hidden="true" />
                      {STATUS_LABELS[listing.status]}
                    </span>
                    {listing.hasOpenReports && (
                      <span
                        className={`${styles.badge} ${styles.badgeWarning}`}
                        title="Listing has open reports under review"
                      >
                        <span className={styles.dot} aria-hidden="true" />
                        Under review
                      </span>
                    )}
                  </div>
                  <p className={`${styles.cardFooter} typography-body-small`}>
                    Listed {formatDate(listing.createdAt)}
                  </p>
                </div>
              </article>
            ))}
          </section>
        )}

        {items.length > 0 && (
          <nav className={styles.paging} aria-label="Pagination">
            <button
              type="button"
              className={styles.pagingBtn}
              onClick={onPrevPage}
              disabled={offset === 0 || loading}
            >
              ← Prev
            </button>
            <button
              type="button"
              className={styles.pagingBtn}
              onClick={onNextPage}
              disabled={!hasMore || loading}
            >
              Next →
            </button>
            <span className={`${styles.apiUrl} typography-body-small`}>
              Showing {items.length} of {total.toLocaleString("en-NG")}
            </span>
          </nav>
        )}

        <details className={styles.raw}>
          <summary>API response (raw JSON)</summary>
          <pre className={styles.rawPre}>{JSON.stringify(raw, null, 2)}</pre>
        </details>
      </main>
    </div>
  );
}