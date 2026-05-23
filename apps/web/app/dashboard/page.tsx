import Link from "next/link";
import { DashboardClient } from "./dashboard-client";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function getQuizzes() {
  try {
    const response = await fetch(`${apiUrl}/quizzes`, { cache: "no-store" });
    if (!response.ok) return [];
    return response.json();
  } catch {
    return [];
  }
}

async function getTags() {
  try {
    const response = await fetch(`${apiUrl}/quizzes/tags`, { cache: "no-store" });
    if (!response.ok) return [];
    return response.json();
  } catch {
    return [];
  }
}

export default async function DashboardPage() {
  const [quizzes, tags] = await Promise.all([getQuizzes(), getTags()]);

  return (
    <main className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Quiz disponibles pour lancer une room locale.</p>
        </div>
        <Link className="button" href="/quiz/new">
          Nouveau quiz
        </Link>
      </div>

      <DashboardClient
        initialQuizzes={quizzes.map(toDashboardQuiz)}
        tags={tags.map((tag: { name: string }) => tag.name)}
      />
    </main>
  );
}

function toDashboardQuiz(quiz: {
  id: string;
  title: string;
  likesCount?: number;
  reportCount?: number;
  correctionPercent?: number;
  sourceType?: string | null;
  sourceCity?: string | null;
  sourceYear?: string | null;
  trainingYear?: string | null;
  _count?: { questions: number };
  quizTags?: Array<{ tag: { name: string } }>;
}) {
  return {
    id: quiz.id,
    title: quiz.title,
    likesCount: quiz.likesCount ?? 0,
    reportCount: quiz.reportCount ?? 0,
    correctionPercent: quiz.correctionPercent ?? 0,
    sourceType: quiz.sourceType ?? null,
    sourceCity: quiz.sourceCity ?? null,
    sourceYear: quiz.sourceYear ?? null,
    trainingYear: quiz.trainingYear ?? null,
    questionsCount: quiz._count?.questions ?? 0,
    tags: quiz.quizTags?.map((quizTag) => quizTag.tag.name) ?? []
  };
}
