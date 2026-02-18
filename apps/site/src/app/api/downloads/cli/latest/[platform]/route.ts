import { NextRequest, NextResponse } from "next/server";

const GITHUB_REPO = "charliemeyer2000/rivanna.dev";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform } = await params;

  const fileMap: Record<string, string> = {
    "rv-linux": "rv-linux",
    "rv-macos": "rv-macos",
  };

  const fileName = fileMap[platform];
  if (!fileName) {
    return NextResponse.json({ error: "Invalid platform" }, { status: 404 });
  }

  try {
    const releaseResponse = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );

    if (!releaseResponse.ok) {
      throw new Error("Failed to fetch release info");
    }

    const release = await releaseResponse.json();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const asset = release.assets.find((a: any) => a.name === fileName);
    if (!asset) {
      return NextResponse.json(
        { error: `File not found for ${platform}` },
        { status: 404 },
      );
    }

    const fileResponse = await fetch(asset.url, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/octet-stream",
      },
    });

    if (!fileResponse.ok) {
      throw new Error("Failed to download file");
    }

    const fileData = await fileResponse.arrayBuffer();

    return new NextResponse(fileData, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": fileData.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error("Error serving file:", error);
    return NextResponse.json(
      { error: "Failed to serve file" },
      { status: 500 },
    );
  }
}
