import { QuizBuilder } from "./quiz-builder";

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

export default async function NewQuizPage() {
  const [tags, metadataOptions] = await Promise.all([getTags(), getMetadataOptions()]);

  return (
    <QuizBuilder
      initialMetadataOptions={metadataOptions}
      initialTags={tags.map((tag: { name: string }) => tag.name)}
    />
  );
}
