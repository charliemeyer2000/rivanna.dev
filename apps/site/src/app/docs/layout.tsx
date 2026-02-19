import { Metadata } from "next";
import DocsLayoutClient from "./_components/docs-layout-client";

export const metadata: Metadata = {
  title: "docs | rivanna.dev",
  description: "documentation for rv, the CLI for GPU computing on Rivanna",
};

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DocsLayoutClient>{children}</DocsLayoutClient>;
}
