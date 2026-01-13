export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex min-h-screen items-center justify-center bg-muted/40 px-6 py-10">
      {children}
    </section>
  );
}
