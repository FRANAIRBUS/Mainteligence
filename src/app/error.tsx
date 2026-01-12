"use client";

import * as React from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ padding: 16, fontFamily: "ui-sans-serif, system-ui" }}>
      <h2 style={{ fontSize: 18, fontWeight: 700 }}>Error en la aplicación</h2>
      <p style={{ marginTop: 8, opacity: 0.8 }}>
        Se produjo un error en el cliente. Aquí tienes el mensaje real:
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

      {error?.digest ? (
        <p style={{ marginTop: 8, opacity: 0.8 }}>
          Digest: <code>{error.digest}</code>
        </p>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          onClick={() => reset()}
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #CBD5E1",
            background: "white",
            fontWeight: 600,
          }}
        >
          Reintentar
        </button>

        <button
          onClick={() => {
            const text = `${error?.message || error}`;
            navigator.clipboard?.writeText(text);
          }}
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #CBD5E1",
            background: "white",
            fontWeight: 600,
          }}
        >
          Copiar error
        </button>
      </div>
    </div>
  );
}