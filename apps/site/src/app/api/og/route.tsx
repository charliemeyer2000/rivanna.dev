import { ImageResponse } from "next/og";

export const runtime = "edge";

async function loadGoogleFont(font: string, text: string) {
  const url = `https://fonts.googleapis.com/css2?family=${font}&text=${encodeURIComponent(text)}`;
  const css = await (await fetch(url)).text();
  const resource = css.match(
    /src: url\((.+)\) format\('(opentype|truetype)'\)/,
  );

  if (resource) {
    const response = await fetch(resource[1]);
    if (response.ok) {
      return await response.arrayBuffer();
    }
  }

  throw new Error("failed to load font data");
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const title = searchParams.get("title") || "rivanna.dev";
    const subtitle =
      searchParams.get("subtitle") ||
      "effortless GPU computing on UVA's Rivanna cluster";

    const text = `${title}${subtitle}rivanna.dev`;
    const fontData = await loadGoogleFont("IBM+Plex+Mono", text);

    return new ImageResponse(
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          backgroundColor: "#ffffff",
          padding: "80px",
          fontFamily: '"IBM Plex Mono", monospace',
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "32px",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 72,
              fontWeight: 600,
              color: "#000000",
              letterSpacing: "-0.02em",
            }}
          >
            rivanna<span style={{ color: "#ff7700" }}>.dev</span>
          </div>

          <div
            style={{
              fontSize: 32,
              color: "#767676",
              maxWidth: "800px",
              lineHeight: 1.4,
            }}
          >
            {subtitle}
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            bottom: "80px",
            left: "80px",
            right: "80px",
            height: "3px",
            backgroundColor: "#ff7700",
          }}
        />

        <div
          style={{
            position: "absolute",
            bottom: "40px",
            left: "80px",
            fontSize: 18,
            color: "#767676",
          }}
        >
          rivanna.dev
        </div>
      </div>,
      {
        width: 1200,
        height: 630,
        fonts: [
          {
            name: "IBM Plex Mono",
            data: fontData,
            style: "normal",
            weight: 400,
          },
        ],
      },
    );
  } catch (e: unknown) {
    console.error(e);
    return new Response("Failed to generate the image", {
      status: 500,
    });
  }
}
