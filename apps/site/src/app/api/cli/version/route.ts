import { NextResponse } from "next/server";

const GITHUB_REPO = "charliemeyer2000/rivanna.dev";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

export async function GET() {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      throw new Error("Failed to fetch release info");
    }

    const release = await response.json();
    const tag: string = release.tag_name; // "cli-v0.0.4"
    const version = tag.replace(/^cli-v/, "");

    return NextResponse.json({ version });
  } catch (error) {
    console.error("Error fetching version:", error);
    return NextResponse.json(
      { error: "Failed to fetch version" },
      { status: 500 },
    );
  }
}
