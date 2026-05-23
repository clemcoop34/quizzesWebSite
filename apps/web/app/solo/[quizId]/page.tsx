import { SoloQuizClient } from "./solo-quiz-client";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function getQuiz(quizId: string) {
  const response = await fetch(`${apiUrl}/quizzes/${quizId}`, { cache: "no-store" });

  if (!response.ok) {
    return null;
  }

  return response.json();
}

export default async function SoloQuizPage({ params }: { params: Promise<{ quizId: string }> }) {
  const { quizId } = await params;
  const quiz = await getQuiz(quizId);

  if (!quiz) {
    return (
      <main>
        <section className="panel">
          <h1>Quiz introuvable</h1>
        </section>
      </main>
    );
  }

  return <SoloQuizClient quiz={quiz} />;
}
