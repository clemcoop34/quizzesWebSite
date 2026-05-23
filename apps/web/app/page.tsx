import Link from "next/link";
import { JoinRoomForm } from "./join-room-form";

export default function HomePage() {
  return (
    <main className="stack">
      <section className="panel stack">
        <h1>Quiz multijoueur en rooms</h1>
        <p className="muted">
          Crée un quiz, ouvre une room, partage le code, puis lance une partie Classic à plusieurs.
        </p>
        <div className="row">
          <Link className="button" href="/dashboard">
            Ouvrir le dashboard
          </Link>
          <Link className="button" href="/quiz/new">
            Créer un quiz
          </Link>
        </div>
      </section>

      <section className="panel stack">
        <h2>Rejoindre une room</h2>
        <JoinRoomForm />
      </section>
    </main>
  );
}
