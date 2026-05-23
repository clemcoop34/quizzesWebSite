"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { QUIZ_CORRECTION_FILTER_THRESHOLD, QUIZ_REPORT_HIDE_THRESHOLD } from "@quiz/shared";

interface DashboardQuiz {
  id: string;
  title: string;
  likesCount: number;
  reportCount: number;
  correctionPercent: number;
  questionsCount: number;
  tags: string[];
  sourceType?: string | null;
  sourceCity?: string | null;
  sourceYear?: string | null;
  trainingYear?: string | null;
}

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const correctionDisplayMinPercent = 5;
const visibleTagLimit = 4;

export function DashboardClient({
  initialQuizzes,
  tags
}: {
  initialQuizzes: DashboardQuiz[];
  tags: string[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [pendingRoomQuizId, setPendingRoomQuizId] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedCity, setSelectedCity] = useState("");
  const [selectedSourceYear, setSelectedSourceYear] = useState("");
  const [selectedTrainingYear, setSelectedTrainingYear] = useState("");
  const [onlyCorrected, setOnlyCorrected] = useState(false);
  const [isCreatingRoomFor, setIsCreatingRoomFor] = useState<string | null>(null);
  const [quizzes, setQuizzes] = useState(initialQuizzes);
  const filterOptions = useMemo(
    () => ({
      cities: uniqueSorted(quizzes.map((quiz) => quiz.sourceCity)),
      sourceYears: uniqueAcademicYears(quizzes.map((quiz) => quiz.sourceYear)),
      trainingYears: uniqueSorted(quizzes.map((quiz) => quiz.trainingYear))
    }),
    [quizzes]
  );

  const filteredQuizzes = useMemo(() => {
    const searchTokens = search
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    return quizzes.filter((quiz) => {
      const isExactTitleSearch = search.trim().toLowerCase() === quiz.title.toLowerCase();
      const searchableWords = [
        ...quiz.title.toLowerCase().split(/\s+/),
        ...quiz.tags,
        quiz.sourceCity,
        quiz.sourceYear,
        quiz.trainingYear
      ]
        .filter((word): word is string => Boolean(word))
        .map((word) => word.toLowerCase());
      const matchesSearch =
        searchTokens.length === 0 ||
        searchTokens.every((token) => searchableWords.some((word) => word.includes(token)));
      const matchesTags =
        selectedTags.length === 0 || selectedTags.every((selectedTag) => quiz.tags.includes(selectedTag));
      const matchesCity = !selectedCity || quiz.sourceCity === selectedCity;
      const matchesSourceYear = !selectedSourceYear || quiz.sourceYear === selectedSourceYear;
      const matchesTrainingYear = !selectedTrainingYear || quiz.trainingYear === selectedTrainingYear;
      const passesReportFilter = quiz.reportCount < QUIZ_REPORT_HIDE_THRESHOLD || isExactTitleSearch;
      const passesCorrectionFilter =
        !onlyCorrected || quiz.correctionPercent >= QUIZ_CORRECTION_FILTER_THRESHOLD;

      return (
        matchesSearch &&
        matchesTags &&
        matchesCity &&
        matchesSourceYear &&
        matchesTrainingYear &&
        passesReportFilter &&
        passesCorrectionFilter
      );
    });
  }, [quizzes, search, selectedTags, selectedCity, selectedSourceYear, selectedTrainingYear, onlyCorrected]);

  function toggleTag(tag: string) {
    setSelectedTags((previous) =>
      previous.includes(tag) ? previous.filter((selectedTag) => selectedTag !== tag) : [...previous, tag]
    );
  }

  async function createRoom(quizId: string) {
    if (!creatorName.trim()) {
      return;
    }

    setIsCreatingRoomFor(quizId);
    const response = await fetch(`${apiUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quizId, hostDisplayName: creatorName.trim() })
    });
    const room = await response.json();
    if (room.currentPlayerId) {
      window.sessionStorage.setItem(`quiz-room:${room.code}:player-id`, room.currentPlayerId);
    }
    router.push(`/room/${room.code}`);
  }

  async function deleteQuiz(quizId: string) {
    const confirmed = window.confirm("Supprimer ce quiz et ses données associées ?");

    if (!confirmed) {
      return;
    }

    const response = await fetch(`${apiUrl}/quizzes/${quizId}`, { method: "DELETE" });

    if (response.ok) {
      setQuizzes((previous) => previous.filter((quiz) => quiz.id !== quizId));
    }
  }

  return (
    <div className="dashboard-layout">
      <aside className="sidebar stack">
        <h2>Filtres</h2>
        <div className="filter-group stack">
          <h3>Annales UNESS</h3>
          <select
            aria-label="Filtrer par ville"
            value={selectedCity}
            onChange={(event) => setSelectedCity(event.target.value)}
          >
            <option value="">Toutes les villes</option>
            {filterOptions.cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrer par année"
            value={selectedSourceYear}
            onChange={(event) => setSelectedSourceYear(event.target.value)}
          >
            <option value="">Toutes les années</option>
            {filterOptions.sourceYears.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrer par année de formation"
            value={selectedTrainingYear}
            onChange={(event) => setSelectedTrainingYear(event.target.value)}
          >
            <option value="">Toutes les formations</option>
            {filterOptions.trainingYears.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group stack">
          <h3>Tags</h3>
        <div className="tag-list">
          <button
            className={onlyCorrected ? "tag-pill tag-pill-selected" : "tag-pill"}
            type="button"
            onClick={() => setOnlyCorrected((previous) => !previous)}
            title={`Afficher seulement les quiz corrigés à ${QUIZ_CORRECTION_FILTER_THRESHOLD}% ou plus`}
          >
            Corrigés
          </button>
          {tags.map((tag) => (
            <button
              className={selectedTags.includes(tag) ? "tag-pill tag-pill-selected" : "tag-pill"}
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
        </div>
      </aside>

      <section className="stack">
        <input
          aria-label="Recherche quiz"
          placeholder="Rechercher par nom ou tag"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <div className="grid">
          {filteredQuizzes.map((quiz) => (
            <article className="card stack" key={quiz.id}>
              <div className="quiz-card-header">
                <h2>{quiz.title}</h2>
                <p className="muted">
                  {quiz.questionsCount} questions · {quiz.likesCount} likes
                </p>
              </div>
              {quiz.sourceType === "uness" ? (
                <div className="compact-meta-list">
                  <span className="compact-pill">UNESS</span>
                  {quiz.sourceCity ? <span className="compact-pill">{quiz.sourceCity}</span> : null}
                  {quiz.sourceYear ? <span className="compact-pill">{quiz.sourceYear}</span> : null}
                  {quiz.trainingYear ? <span className="compact-pill">{quiz.trainingYear}</span> : null}
                </div>
              ) : null}
              <div className="compact-meta-list">
                {quiz.correctionPercent > correctionDisplayMinPercent ? (
                  <span className="compact-pill compact-pill-accent">Corrigé {quiz.correctionPercent}%</span>
                ) : null}
                {quiz.tags.slice(0, visibleTagLimit).map((tag) => (
                  <span className="compact-pill" key={tag}>
                    {tag}
                  </span>
                ))}
                {quiz.tags.length > visibleTagLimit ? (
                  <span className="compact-pill">+{quiz.tags.length - visibleTagLimit}</span>
                ) : null}
              </div>
              <div className="row">
                <button
                  type="button"
                  disabled={isCreatingRoomFor === quiz.id}
                  onClick={() => {
                    setCreatorName("");
                    setPendingRoomQuizId(quiz.id);
                  }}
                >
                  {isCreatingRoomFor === quiz.id ? "Création..." : "Créer une room"}
                </button>
                <button className="secondary-button" type="button" onClick={() => router.push(`/solo/${quiz.id}`)}>
                  Solo
                </button>
                <button className="danger-button" type="button" onClick={() => deleteQuiz(quiz.id)}>
                  Supprimer
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {pendingRoomQuizId ? (
        <div className="modal-backdrop" role="presentation">
          <form
            className="modal stack"
            onSubmit={(event) => {
              event.preventDefault();
              void createRoom(pendingRoomQuizId);
            }}
          >
            <h2>Créer une room</h2>
            <label className="stack">
              Ton nom
              <input
                autoFocus
                value={creatorName}
                onChange={(event) => setCreatorName(event.target.value)}
                placeholder="Nom du créateur"
              />
            </label>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setPendingRoomQuizId(null);
                  setCreatorName("");
                }}
              >
                Annuler
              </button>
              <button type="submit" disabled={!creatorName.trim() || isCreatingRoomFor === pendingRoomQuizId}>
                {isCreatingRoomFor === pendingRoomQuizId ? "Création..." : "Créer"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort(
    (a, b) => a.localeCompare(b, "fr")
  );
}

function uniqueAcademicYears(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort(
    (a, b) => getAcademicStartYear(b) - getAcademicStartYear(a)
  );
}

function getAcademicStartYear(value: string): number {
  const year = Number(value.match(/\d{4}/)?.[0] ?? 0);
  return Number.isFinite(year) ? year : 0;
}
