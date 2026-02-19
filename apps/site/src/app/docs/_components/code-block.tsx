"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

export function CodeBlock({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const handleCopy = async () => {
    if (!ref.current) return;
    const text = ref.current.innerText || ref.current.textContent || "";
    await navigator.clipboard.writeText(text.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={cn(
        "bg-gray-50 border border-gray-200 p-4 relative group",
        className,
      )}
    >
      <div className="overflow-x-auto">
        <div ref={ref} className="pr-8">
          {children}
        </div>
      </div>
      <button
        onClick={handleCopy}
        className={cn(
          "absolute top-1/2 -translate-y-1/2 right-2 p-1.5 rounded border bg-white cursor-pointer transition-all duration-150",
          "opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100",
          copied
            ? "border-gray-300 text-gray-500"
            : "border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300 hover:bg-gray-50",
        )}
        aria-label={copied ? "Copied" : "Copy code"}
      >
        <AnimatePresence mode="wait" initial={false}>
          {copied ? (
            <motion.svg
              key="check"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={{ duration: 0.15 }}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </motion.svg>
          ) : (
            <motion.svg
              key="copy"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={{ duration: 0.15 }}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </motion.svg>
          )}
        </AnimatePresence>
      </button>
    </div>
  );
}
