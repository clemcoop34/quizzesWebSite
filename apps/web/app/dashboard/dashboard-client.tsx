"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  GAME_MODE_DEFINITIONS,
  QUIZ_CORRECTION_FILTER_THRESHOLD,
  QUIZ_REPORT_HIDE_THRESHOLD,
  type GameModeId
} from "@quiz/shared";

interface DashboardQuiz {
  id: string;
  title: string;
  likesCount: number;
  reportCount: number;
  correctionPercent: number;
  questionsCount: number;
  qpucQuestionCount: number;
  tags: string[];
  sourceType?: string | null;
  sourceCity?: string | null;
  sourceYear?: string | null;
  trainingYear?: string | null;
  compatibleGameModes: GameModeId[];
}

type FilterState = "include" | "exclude";

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
  const [tagFilters, setTagFilters] = useState<Partial<Record<string, FilterState>>>({});
  const [selectedCity, setSelectedCity] = useState("");
  const [selectedSourceYear, setSelectedSourceYear] = useState("");
  const [selectedTrainingYear, setSelectedTrainingYear] = useState("");
  const [gameModeFilters, setGameModeFilters] = useState<Partial<Record<GameModeId, FilterState>>>({});
  const [onlyCorrected, setOnlyCorrected] = useState(false);
  const [isCreatingRoomFor, setIsCreatingRoomFor] = useState<string | null>(null);
  const [quizzes] = useState(initialQuizzes);
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
      const includedTags = Object.entries(tagFilters)
        .filter(([, state]) => state === "include")
        .map(([tag]) => tag);
      const excludedTags = Object.entries(tagFilters)
        .filter(([, state]) => state === "exclude")
        .map(([tag]) => tag);
      const matchesTags =
        includedTags.every((selectedTag) => quiz.tags.includes(selectedTag)) &&
        excludedTags.every((selectedTag) => !quiz.tags.includes(selectedTag));
      const matchesCity = !selectedCity || quiz.sourceCity === selectedCity;
      const matchesSourceYear = !selectedSourceYear || quiz.sourceYear === selectedSourceYear;
      const matchesTrainingYear = !selectedTrainingYear || quiz.trainingYear === selectedTrainingYear;
      const includedGameModes = Object.entries(gameModeFilters)
        .filter(([, state]) => state === "include")
        .map(([modeId]) => modeId as GameModeId);
      const excludedGameModes = Object.entries(gameModeFilters)
        .filter(([, state]) => state === "exclude")
        .map(([modeId]) => modeId as GameModeId);
      const matchesGameModes =
        includedGameModes.every((modeId) => quiz.compatibleGameModes.includes(modeId)) &&
        excludedGameModes.every((modeId) => !quiz.compatibleGameModes.includes(modeId));
      const passesReportFilter = quiz.reportCount < QUIZ_REPORT_HIDE_THRESHOLD || isExactTitleSearch;
      const passesCorrectionFilter =
        !onlyCorrected || quiz.correctionPercent >= QUIZ_CORRECTION_FILTER_THRESHOLD;

      return (
        matchesSearch &&
        matchesTags &&
        matchesCity &&
        matchesSourceYear &&
        matchesTrainingYear &&
        matchesGameModes &&
        passesReportFilter &&
        passesCorrectionFilter
      );
    });
  }, [quizzes, search, tagFilters, selectedCity, selectedSourceYear, selectedTrainingYear, gameModeFilters, onlyCorrected]);

  function toggleTag(tag: string) {
    setTagFilters((previous) => cycleTriStateFilter(previous, tag));
  }

  function toggleGameMode(modeId: GameModeId) {
    setGameModeFilters((previous) => cycleTriStateFilter(previous, modeId));
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
          <h3>Modes</h3>
          <div className="tag-list">
            {(Object.keys(GAME_MODE_DEFINITIONS) as GameModeId[]).map((modeId) => (
              <button
                className={filterPillClass(gameModeFilters[modeId])}
                key={modeId}
                type="button"
                onClick={() => toggleGameMode(modeId)}
                title={`${GAME_MODE_DEFINITIONS[modeId].description} Clic 1 : inclure, clic 2 : exclure.`}
              >
                {GAME_MODE_DEFINITIONS[modeId].shortLabel}
              </button>
            ))}
          </div>
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
              className={filterPillClass(tagFilters[tag])}
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              title="Clic 1 : inclure ce tag. Clic 2 : exclure ce tag."
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
                  {quiz.qpucQuestionCount > 0 ? ` · ${quiz.qpucQuestionCount} face-à-face` : ""}
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
                {quiz.compatibleGameModes.map((modeId) => (
                  <span className="compact-pill compact-pill-mode" key={modeId}>
                    {GAME_MODE_DEFINITIONS[modeId].shortLabel}
                  </span>
                ))}
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
                <button className="secondary-button" type="button" onClick={() => router.push(`/quiz/${quiz.id}/edit`)}>
                  Éditer
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

function cycleTriStateFilter<T extends string>(
  previous: Partial<Record<T, FilterState>>,
  key: T
): Partial<Record<T, FilterState>> {
  const next = { ...previous };

  if (!previous[key]) {
    next[key] = "include";
  } else if (previous[key] === "include") {
    next[key] = "exclude";
  } else {
    delete next[key];
  }

  return next;
}

function filterPillClass(state?: FilterState): string {
  if (state === "include") {
    return "tag-pill tag-pill-selected";
  }

  if (state === "exclude") {
    return "tag-pill tag-pill-excluded";
  }

  return "tag-pill";
}
