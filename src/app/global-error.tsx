"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ padding: 16, fontFamily: "ui-sans-serif, system-ui" }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Error global</h2>
        <p style={{ marginTop: 8, opacity: 0.8 }}>
          Este error ocurrió a nivel global (posiblemente en layout/AppShell).
        </p>

        <pre
          style={{
            marginTop: 12,
            padding: 12,
            background: "#111827",
            color: "#E5E7EB",
            borderRadius: 8,
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {String(error?.message || error)}
        </pre>

        <button
          onClick={() => reset()}
          style={{
            marginTop: 12,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #CBD5E1",
            background: "white",
            fontWeight: 600,
          }}
        >
          Reintentar
        </button>
      </body>
    </html>
  );
}