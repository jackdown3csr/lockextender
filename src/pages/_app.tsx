import type { AppProps } from "next/app";
import { Analytics } from "@vercel/analytics/next";
import { useRouter } from "next/router";

const bannerText = {
  en: <>◈ Planning to burn some gUBI? <a href="https://flambeur.xyz" target="_blank" rel="noopener noreferrer" style={{ color: "#238636", textDecoration: "none", fontWeight: "bold" }}>flambeur.xyz ↗</a> — get bonus WGNET for your gUBI without the burn.</>,
  fr: <>◈ Vous prévoyez de brûler des gUBI ? <a href="https://flambeur.xyz" target="_blank" rel="noopener noreferrer" style={{ color: "#238636", textDecoration: "none", fontWeight: "bold" }}>flambeur.xyz ↗</a> — obtenez des WGNET avec bonus sans brûler vos gUBI.</>,
};

export default function App({ Component, pageProps }: AppProps) {
  const { locale } = useRouter();
  const text = locale === "fr" ? bannerText.fr : bannerText.en;
  return (
    <>
      <div style={{ fontFamily: "monospace", fontSize: 12, color: "#8b949e", background: "#0d1117", borderBottom: "1px solid #30363d", padding: "6px 16px", letterSpacing: "0.02em" }}>
        {text}
      </div>
      <Component {...pageProps} />
      <Analytics />
    </>
  );
}