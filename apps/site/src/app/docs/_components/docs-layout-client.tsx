"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import { useState, ViewTransition } from "react";

const docNavItems = [
  {
    href: "/docs",
    label: "getting started",
    subheadings: [
      { label: "install", id: "install" },
      { label: "setup", id: "setup" },
      { label: "first job", id: "first-job" },
      { label: "what's next?", id: "whats-next" },
    ],
  },
  {
    href: "/docs/commands",
    label: "commands",
    subheadings: [
      { label: "rv up", id: "rv-up" },
      { label: "rv run", id: "rv-run" },
      { label: "rv ps", id: "rv-ps" },
      { label: "rv stop", id: "rv-stop" },
      { label: "rv attach", id: "rv-attach" },
      { label: "rv ssh", id: "rv-ssh" },
      { label: "rv logs", id: "rv-logs" },
      { label: "rv status", id: "rv-status" },
      { label: "rv sync", id: "rv-sync" },
      { label: "rv forward", id: "rv-forward" },
      { label: "rv env", id: "rv-env" },
      { label: "rv cost", id: "rv-cost" },
      { label: "rv exec", id: "rv-exec" },
      { label: "rv init", id: "rv-init" },
    ],
  },
  {
    href: "/docs/allocator",
    label: "smart allocator",
    subheadings: [
      { label: "how it works", id: "how-it-works" },
      { label: "fan-out strategy", id: "fan-out" },
      { label: "backfill detection", id: "backfill" },
      { label: "checkpoint-restart", id: "checkpoint-restart" },
      { label: "gpu types", id: "gpu-types" },
    ],
  },
  {
    href: "/docs/configuration",
    label: "configuration",
    subheadings: [
      { label: "config file", id: "config-file" },
      { label: "defaults", id: "defaults" },
      { label: "notifications", id: "notifications" },
      { label: "ai naming", id: "ai-naming" },
      { label: "environment variables", id: "environment-variables" },
      { label: "scratch keepalive", id: "scratch-keepalive" },
      { label: "shared storage", id: "shared-storage" },
      { label: "paths", id: "paths" },
    ],
  },
];

export default function DocsLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  function isActiveDocSection(href: string): boolean {
    if (href === "/docs") {
      return pathname === "/docs" || pathname?.endsWith("/docs") || false;
    }
    return pathname?.includes(href) ?? false;
  }

  return (
    <main className="max-w-7xl mx-auto px-4 py-6 sm:px-8 sm:py-8 min-h-screen font-mono">
      <div>
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <Link
              href="/"
              className="text-2xl sm:text-3xl font-normal tracking-tight hover:text-gray-700 transition-colors"
            >
              rivanna<span className="text-orange-accent">.dev</span>
            </Link>
            <a
              href="https://github.com/charliemeyer2000/rivanna.dev"
              className="text-sm text-gray-500 hover:text-black transition-colors"
            >
              github
            </a>
          </div>

          <div className="h-[3px] bg-orange-accent mt-4 mb-4" />

          <nav className="flex items-center gap-3 sm:gap-6">
            <Link
              href="/"
              className="text-sm text-gray-500 hover:text-black transition-colors"
            >
              home
            </Link>
            <Link
              href="/docs"
              className="text-sm text-black font-medium border-b-2 border-orange-accent pb-0.5"
            >
              docs
            </Link>
          </nav>
        </div>

        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="md:hidden text-sm text-gray-500 hover:text-black transition-colors mb-4"
        >
          {sidebarOpen ? "— hide menu" : "+ show menu"}
        </button>

        <div className="flex flex-col md:flex-row gap-4 md:gap-8">
          <nav className="hidden md:block w-48 flex-shrink-0">
            <ul className="space-y-1">
              {docNavItems.map((item) => {
                const isActive = isActiveDocSection(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "block py-2 px-3 text-sm border-l-2 transition-colors",
                        isActive
                          ? "border-orange-accent bg-orange-accent/5 text-black font-medium"
                          : "border-transparent text-gray-500 hover:border-gray-300 hover:text-black",
                      )}
                    >
                      {item.label}
                    </Link>
                    <AnimatePresence initial={false}>
                      {isActive && item.subheadings.length > 0 && (
                        <motion.ul
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: "easeInOut" }}
                          className="overflow-hidden"
                        >
                          {item.subheadings.map((sub, i) => (
                            <motion.li
                              key={sub.id}
                              initial={{ opacity: 0, x: -4 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{
                                duration: 0.15,
                                delay: 0.05 + i * 0.03,
                              }}
                            >
                              <a
                                href={`#${sub.id}`}
                                className="block py-1 pl-6 pr-3 text-xs border-l-2 border-transparent text-gray-400 hover:text-gray-700 transition-colors"
                              >
                                {sub.label}
                              </a>
                            </motion.li>
                          ))}
                        </motion.ul>
                      )}
                    </AnimatePresence>
                  </li>
                );
              })}
            </ul>
          </nav>

          <AnimatePresence>
            {sidebarOpen && (
              <motion.nav
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
                className="md:hidden w-full overflow-hidden"
              >
                <ul className="space-y-1">
                  {docNavItems.map((item, index) => {
                    const isActive = isActiveDocSection(item.href);
                    return (
                      <motion.li
                        key={item.href}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{
                          duration: 0.15,
                          delay: 0.03 + index * 0.04,
                        }}
                      >
                        <Link
                          href={item.href}
                          onClick={() => setSidebarOpen(false)}
                          className={cn(
                            "block py-2 px-3 text-sm border-l-2 transition-colors",
                            isActive
                              ? "border-orange-accent bg-orange-accent/5 text-black font-medium"
                              : "border-transparent text-gray-500 hover:border-gray-300 hover:text-black",
                          )}
                        >
                          {item.label}
                        </Link>
                        {isActive && item.subheadings.length > 0 && (
                          <ul>
                            {item.subheadings.map((sub, i) => (
                              <motion.li
                                key={sub.id}
                                initial={{ opacity: 0, x: -4 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{
                                  duration: 0.15,
                                  delay: 0.08 + index * 0.04 + i * 0.03,
                                }}
                              >
                                <a
                                  href={`#${sub.id}`}
                                  onClick={() => setSidebarOpen(false)}
                                  className="block py-1 pl-6 pr-3 text-xs border-l-2 border-transparent text-gray-400 hover:text-gray-700 transition-colors"
                                >
                                  {sub.label}
                                </a>
                              </motion.li>
                            ))}
                          </ul>
                        )}
                      </motion.li>
                    );
                  })}
                </ul>
              </motion.nav>
            )}
          </AnimatePresence>

          <ViewTransition name="docs-content">
            <article className="flex-1 min-w-0">{children}</article>
          </ViewTransition>
        </div>
      </div>
    </main>
  );
}
