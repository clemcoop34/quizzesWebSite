import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Multiplayer Quiz",
  description: "MVP quiz multijoueur en rooms"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/">Multiplayer Quiz</Link>
            <nav className="nav">
              <Link href="/dashboard">Dashboard</Link>
              <Link href="/quiz/new">Nouveau quiz</Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
