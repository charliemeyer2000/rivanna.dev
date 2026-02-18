export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold tracking-tight">
        rivanna<span className="text-orange-accent">.dev</span>
      </h1>
      <p className="mt-4 text-lg text-muted-foreground">
        effortless GPU computing on UVA&apos;s Rivanna cluster
      </p>
      <pre className="mt-8 rounded-lg border bg-card p-4 text-sm">
        curl -fsSL https://rivanna.dev/install.sh | bash
      </pre>
    </main>
  );
}
