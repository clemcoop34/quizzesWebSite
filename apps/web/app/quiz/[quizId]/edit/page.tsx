import Link from "next/link";
import { QuizBuilder, type InitialQuizForBuilder } from "../../new/quiz-builder";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function getTags() {
  try {
    const response = await fetch(`${apiUrl}/quizzes/tags`, { cache: "no-store" });
    if (!response.ok) return [];
    return response.json();
  } catch {
    return [];
  }
}

async function getMetadataOptions() {
  try {
    const response = await fetch(`${apiUrl}/quizzes/metadata-options`, { cache: "no-store" });
    if (!response.ok) return { cities: [], sourceYears: [], trainingYears: [] };
    return response.json();
  } catch {
    return { cities: [], sourceYears: [], trainingYears: [] };
  }
}

async function getQuiz(id: string): Promise<InitialQuizForBuilder | null> {
  try {
    const response = await fetch(`${apiUrl}/quizzes/${id}`, { cache: "no-store" });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

export default async function EditQuizPage({ params }: { params: Promise<{ quizId: string }> }) {
  const { quizId } = await params;
  const [quiz, tags, metadataOptions] = await Promise.all([getQuiz(quizId), getTags(), getMetadataOptions()]);

  if (!quiz) {
    return (
      <main className="stack">
        <section className="panel stack">
          <h1>Quiz introuvable</h1>
          <p className="muted">Impossible de charger ce quiz pour l'éditer.</p>
          <Link className="button" href="/dashboard">
            Retour au dashboard
          </Link>
        </section>
      </main>
    );
  }

  return (
    <QuizBuilder
      initialQuiz={quiz}
      initialMetadataOptions={metadataOptions}
      initialTags={tags.map((tag: { name: string }) => tag.name)}
    />
  );
}
