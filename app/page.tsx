export default function Home() {
  return (
    <main style={{ padding: "var(--spacing-xl)" }}>
      <h1 className="typography-heading">Domora</h1>
      <p className="typography-body" style={{ color: "var(--color-text-muted)" }}>
        Verified property listings. Coming soon.
      </p>
      <div style={{ marginTop: "var(--spacing-md)" }} className="typography-body">
        Search: <a href="/api/v1/listings">GET /api/v1/listings</a>
      </div>
    </main>
  );
}