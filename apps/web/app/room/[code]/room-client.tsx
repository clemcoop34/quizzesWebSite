"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { io, type Socket } from "socket.io-client";
import { GAME_MODE_DEFINITIONS, ROOM_GAME_MODE_IDS } from "@quiz/shared";
import type {
  ClientToServerEvents,
  GameFinishedPayload,
  GameBuzzStartedPayload,
  GameModeId,
  GameQuestionTimingMode,
  GameQuestionEndedPayload,
  GameQuestionStartedPayload,
  ImagePointDto,
  ImageRegionDto,
  PlayerDto,
  RoomQuizPreviewDto,
  RoomStateDto,
  QuizReportReason,
  ServerToClientEvents
} from "@quiz/shared";

const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000";
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type QuizSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type QuizPickerItem = {
  id: string;
  title: string;
  correctionPercent?: number;
  sourceType?: string | null;
  sourceCity?: string | null;
  sourceYear?: string | null;
  trainingYear?: string | null;
  _count?: { questions: number };
  quizTags?: Array<{ tag: { name: string } }>;
};

export function RoomClient({ code }: { code: string }) {
  const [displayName, setDisplayName] = useState("");
  const [room, setRoom] = useState<RoomStateDto | null>(null);
  const [question, setQuestion] = useState<GameQuestionStartedPayload | null>(null);
  const [ended, setEnded] = useState<GameQuestionEndedPayload | null>(null);
  const [finished, setFinished] = useState<GameFinishedPayload | null>(null);
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(null);
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<ImagePointDto | null>(null);
  const [textAnswer, setTextAnswer] = useState("");
  const [qpucAnswerText, setQpucAnswerText] = useState("");
  const [answerValidated, setAnswerValidated] = useState(false);
  const [timingMode, setTimingMode] = useState<GameQuestionTimingMode>("dynamic_timer");
  const [selectedGameMode, setSelectedGameMode] = useState<GameModeId>("classic");
  const [selectedQuestionCount, setSelectedQuestionCount] = useState<number | null>(null);
  const [answerStatusByPlayerId, setAnswerStatusByPlayerId] = useState<
    Record<string, { hasAnswer: boolean; validated: boolean }>
  >({});
  const [explanationsSkipped, setExplanationsSkipped] = useState(false);
  const [liveScores, setLiveScores] = useState<Record<string, number>>({});
  const [likedQuizIds, setLikedQuizIds] = useState<string[]>([]);
  const [reportedQuizIds, setReportedQuizIds] = useState<string[]>([]);
  const [quizOptions, setQuizOptions] = useState<QuizPickerItem[]>([]);
  const [showQuizPicker, setShowQuizPicker] = useState(false);
  const [quizPickerSearch, setQuizPickerSearch] = useState("");
  const [isLoadingQuizOptions, setIsLoadingQuizOptions] = useState(false);
  const [reportReason, setReportReason] = useState<QuizReportReason | "">("");
  const [showReportModal, setShowReportModal] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isLiking, setIsLiking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [activeBuzz, setActiveBuzz] = useState<(GameBuzzStartedPayload & { pauseStartedAtMs: number }) | null>(null);
  const [pausedDurationMs, setPausedDurationMs] = useState(0);
  const [qpucHandOverride, setQpucHandOverride] = useState<{ segmentIndex: number; playerId: string } | null>(null);
  const [qpucAttemptsByPlayerId, setQpucAttemptsByPlayerId] = useState<
    Record<string, { text: string; isCorrect?: boolean }>
  >({});
  const [qpucAwardByPlayerId, setQpucAwardByPlayerId] = useState<Record<string, number>>({});
  const [qpucCorrectStreak, setQpucCorrectStreak] = useState<{ playerId: string; count: number } | null>(null);
  const socketRef = useRef<QuizSocket | null>(null);
  const questionPanelRef = useRef<HTMLElement | null>(null);
  const explanationPanelRef = useRef<HTMLDivElement | null>(null);
  const liveScoresRef = useRef<Record<string, number>>({});
  const hasReceivedInitialRoomStateRef = useRef(false);

  useEffect(() => {
    const instance: QuizSocket = io(socketUrl, { autoConnect: true });
    socketRef.current = instance;
    instance.on("room:state_updated", (payload) => {
      setIsJoining(false);
      const isInitialRoomState = !hasReceivedInitialRoomStateRef.current;
      hasReceivedInitialRoomStateRef.current = true;

      if (isInitialRoomState && !payload.currentPlayerId) {
        setCurrentPlayerId(null);
        window.sessionStorage.removeItem(playerStorageKey(code));
      }

      setRoom((previous) => ({
        ...payload,
        currentPlayerId: payload.currentPlayerId ?? (isInitialRoomState ? undefined : previous?.currentPlayerId)
      }));

      if (payload.status === "lobby") {
        setQuestion(null);
        setEnded(null);
        setFinished(null);
        setActiveBuzz(null);
        setQpucAttemptsByPlayerId({});
        setQpucAwardByPlayerId({});
        setQpucCorrectStreak(null);
        const resetScores = Object.fromEntries(payload.players.map((player) => [player.id, player.score]));
        liveScoresRef.current = resetScores;
        setLiveScores(resetScores);
      }

      if (payload.currentPlayerId) {
        setCurrentPlayerId(payload.currentPlayerId);
        window.sessionStorage.setItem(playerStorageKey(code), payload.currentPlayerId);
      }
    });
    instance.on("game:question_started", (payload) => {
      setQuestion(payload);
      setEnded(null);
      setSelectedOptionIds([]);
      setSelectedPoint(null);
      setTextAnswer("");
      setQpucAnswerText("");
      setAnswerValidated(false);
      setAnswerStatusByPlayerId({});
      setActiveBuzz(null);
      setPausedDurationMs(0);
      setQpucHandOverride(null);
      setQpucAttemptsByPlayerId({});
      setQpucAwardByPlayerId({});
      setExplanationsSkipped(false);
      setFinished(null);
    });
    instance.on("game:buzz_started", (payload) => {
      setQpucAnswerText("");
      setActiveBuzz({ ...payload, pauseStartedAtMs: Date.now() });
    });
    instance.on("game:buzz_ended", (payload) => {
      setActiveBuzz((previous) => {
        if (previous && previous.sessionId === payload.sessionId && previous.questionId === payload.questionId) {
          setPausedDurationMs((duration) => duration + Math.max(0, Date.now() - previous.pauseStartedAtMs));
        }

        return null;
      });
      setQpucAnswerText("");

      if (payload.endsAt) {
        setQuestion((previous) =>
          previous && previous.sessionId === payload.sessionId
            ? {
                ...previous,
                endsAt: payload.endsAt
              }
            : previous
        );
      }

      if (payload.handPlayerId && payload.segmentIndex !== undefined) {
        setQpucHandOverride({
          segmentIndex: payload.segmentIndex,
          playerId: payload.handPlayerId
        });
      }
    });
    instance.on("game:answer_received", (payload) => {
      setAnswerStatusByPlayerId((previous) => ({
        ...previous,
        [payload.playerId]: {
          hasAnswer: payload.hasAnswer,
          validated: payload.validated
        }
      }));
      if (payload.textAnswer) {
        setQpucAttemptsByPlayerId((previous) => ({
          ...previous,
          [payload.playerId]: {
            text: payload.textAnswer ?? "",
            isCorrect: payload.isCorrect
          }
        }));
      }
    });
    instance.on("game:question_ended", (payload) => {
      setEnded(payload);
      setActiveBuzz(null);
      setQpucAnswerText("");
      setQpucHandOverride(null);
      setExplanationsSkipped(false);
      const scoringResult = payload.playerResults.find((result) => result.status === "perfect");
      setQpucCorrectStreak((previous) =>
        scoringResult
          ? {
              playerId: scoringResult.playerId,
              count: previous?.playerId === scoringResult.playerId ? previous.count + 1 : 1
            }
          : null
      );
      const previousScores = liveScoresRef.current;
      const scoreDeltas = Object.fromEntries(
        Object.entries(payload.scores).map(([playerId, score]) => [playerId, score - (previousScores[playerId] ?? 0)])
      );
      setQpucAwardByPlayerId(scoreDeltas);
      liveScoresRef.current = payload.scores;
      setLiveScores(payload.scores);
    });
    instance.on("game:finished", (payload) => {
      setFinished(payload);
      liveScoresRef.current = payload.scores;
      setLiveScores(payload.scores);
    });
    instance.on("error", (payload) => setError(payload.message));
    instance.on("error", () => setIsJoining(false));

    const storedPlayerId = window.sessionStorage.getItem(playerStorageKey(code));
    if (storedPlayerId) {
      setCurrentPlayerId(storedPlayerId);
    }
    setLikedQuizIds(JSON.parse(window.localStorage.getItem("liked-quiz-ids") ?? "[]") as string[]);
    setReportedQuizIds(JSON.parse(window.localStorage.getItem("reported-quiz-ids") ?? "[]") as string[]);

    instance.emit("room:watch", { code, playerId: storedPlayerId ?? undefined });

    return () => {
      instance.disconnect();
      socketRef.current = null;
    };
  }, [code]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!showQuizPicker) {
      return;
    }

    setIsLoadingQuizOptions(true);
    fetch(`${apiUrl}/quizzes`)
      .then((response) => (response.ok ? response.json() : []))
      .then((items: QuizPickerItem[]) => setQuizOptions(items))
      .catch(() => setQuizOptions([]))
      .finally(() => setIsLoadingQuizOptions(false));
  }, [showQuizPicker]);

  useEffect(() => {
    if (!question || !questionPanelRef.current) {
      return;
    }

    questionPanelRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [question?.question.id]);

  useEffect(() => {
    if (!ended || !explanationPanelRef.current) {
      return;
    }

    explanationPanelRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [ended?.questionId]);

  const currentPlayer = room?.players.find((player) => player.id === currentPlayerId);
  const quizPreview: RoomQuizPreviewDto | null = room?.quiz ?? null;
  const roomCompatibleGameModes = useMemo(
    () =>
      (quizPreview?.compatibleGameModes ?? []).filter((modeId) =>
        (ROOM_GAME_MODE_IDS as readonly GameModeId[]).includes(modeId)
      ),
    [quizPreview?.compatibleGameModes]
  );
  const hostPlayer = room?.players.find((player) => player.id === room.hostPlayerId);
  const isJoined = Boolean(currentPlayer);
  const isHost = Boolean(currentPlayer?.isHost);
  const isOpenTextQuestion = question?.question.type === "open_text";
  const isImageRegionQuestion = question?.question.type === "image_region";
  const isQpucQuestion = Boolean(question?.question.clues?.length);
  const questionOptionLabels = new Map(question?.question.options.map((option) => [option.id, option.label]) ?? []);
  const explanationsByOptionId = new Map(ended?.explanations.map((item) => [item.optionId, item.explanation]) ?? []);
  const playerResultById = new Map(ended?.playerResults.map((result) => [result.playerId, result.status]) ?? []);
  useEffect(() => {
    if (!quizPreview || roomCompatibleGameModes.includes(selectedGameMode)) {
      return;
    }

    setSelectedGameMode(roomCompatibleGameModes[0] ?? "classic");
  }, [quizPreview, roomCompatibleGameModes, selectedGameMode]);

  useEffect(() => {
    if (selectedGameMode === "qpuc_face_to_face") {
      setTimingMode("dynamic_timer");
    }
  }, [selectedGameMode]);

  useEffect(() => {
    if (!quizPreview || selectedGameMode !== "classic") {
      return;
    }

    const maxQuestions = quizPreview.questions.length;
    setSelectedQuestionCount((current) =>
      current && current > 0 && current <= maxQuestions ? current : maxQuestions
    );
  }, [quizPreview, selectedGameMode]);

  const rankedPlayers = useMemo(
    () =>
      [...(room?.players ?? [])].sort(
        (a, b) => (liveScores[b.id] ?? b.score) - (liveScores[a.id] ?? a.score) || a.displayName.localeCompare(b.displayName)
      ),
    [room?.players, liveScores]
  );
  const filteredQuizOptions = useMemo(() => {
    const tokens = quizPickerSearch
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    if (tokens.length === 0) {
      return quizOptions;
    }

    return quizOptions.filter((quiz) => {
      const searchableText = [
        quiz.title,
        quiz.sourceCity,
        quiz.sourceYear,
        quiz.trainingYear,
        ...(quiz.quizTags ?? []).map((quizTag) => quizTag.tag.name)
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return tokens.every((token) => searchableText.includes(token));
    });
  }, [quizOptions, quizPickerSearch]);
  const isNoTimerQuestion = question?.timingMode === "no_timer";
  const effectiveNow = activeBuzz ? activeBuzz.pauseStartedAtMs : now;
  const remainingMs = question?.endsAt ? Math.max(0, Date.parse(question.endsAt) - effectiveNow) : null;
  const remainingRatio = question?.endsAt
    ? Math.max(
        0,
        Math.min(
          1,
          (Date.parse(question.endsAt) - effectiveNow) / (Date.parse(question.endsAt) - Date.parse(question.startedAt))
        )
      )
    : 0;
  const qpucElapsedMs =
    question && isQpucQuestion ? Math.max(0, effectiveNow - Date.parse(question.startedAt) - pausedDurationMs) : 0;
  const qpucDurationMs = question?.question.durationMs ?? 1;
  const qpucElapsedRatio = Math.max(0, Math.min(1, qpucElapsedMs / qpucDurationMs));
  const qpucSegmentIndex = Math.min(3, Math.max(0, Math.floor(qpucElapsedRatio * 4)));
  const visibleQpucClueCount = question?.question.clues ? visibleClueCount(question.question.clues, qpucElapsedRatio) : 0;
  const visibleQpucClues =
    question?.question.clues && visibleQpucClueCount > 0 ? [question.question.clues[visibleQpucClueCount - 1]] : [];
  const qpucPointsAvailable = pointsForQpucElapsedRatio(qpucElapsedRatio);
  const leftQpucPlayer = room?.players.find((player) => player.isHost) ?? room?.players[0];
  const rightQpucPlayer = room?.players.find((player) => player.id !== leftQpucPlayer?.id);
  const qpucBaseHandPlayerId = question?.handPlayerId ?? leftQpucPlayer?.id;
  const qpucNaturalHandPlayerId =
    qpucSegmentIndex % 2 === 0 ? qpucBaseHandPlayerId : getOpposingPlayerId(room?.players ?? [], qpucBaseHandPlayerId);
  const qpucCurrentHandPlayerId =
    qpucHandOverride?.segmentIndex === qpucSegmentIndex ? qpucHandOverride.playerId : qpucNaturalHandPlayerId;
  const activeBuzzIsMine = activeBuzz?.playerId === currentPlayerId;
  const buzzAnswerRemainingSeconds = activeBuzz ? Math.ceil(Math.max(0, Date.parse(activeBuzz.answerEndsAt) - now) / 1000) : 0;
  const qpucScoringResult =
    ended && isQpucQuestion ? ended.playerResults.find((result) => result.status === "perfect") : undefined;
  const qpucScoringPlayer = room?.players.find((player) => player.id === qpucScoringResult?.playerId);
  const qpucScoringPoints = qpucScoringResult ? qpucAwardByPlayerId[qpucScoringResult.playerId] ?? 0 : 0;
  const qpucScoringStreakCount =
    qpucScoringResult && qpucCorrectStreak?.playerId === qpucScoringResult.playerId ? qpucCorrectStreak.count : 1;
  const classicQuestionMax = quizPreview?.questions.length ?? 0;

  function joinRoom() {
    if (isJoined || isJoining) return;

    setError(null);
    setIsJoining(true);
    socketRef.current?.emit("room:join", {
      code,
      displayName: displayName || "Player",
      playerId: currentPlayerId ?? undefined
    });
  }

  function startGame() {
    if (!room?.quizId) {
      setError("Aucun quiz n'est associé à cette room.");
      return;
    }

    socketRef.current?.emit("game:start", {
      roomCode: code,
      quizId: room.quizId,
      modeId: selectedGameMode,
      timingMode,
      questionLimit:
        selectedGameMode === "classic" && selectedQuestionCount && quizPreview
          ? Math.min(selectedQuestionCount, quizPreview.questions.length)
          : undefined
    });
  }

  function returnToLobby() {
    socketRef.current?.emit("room:return_to_lobby", {
      code
    });
  }

  function selectQuiz(quizId: string) {
    setShowQuizPicker(false);
    setError(null);
    socketRef.current?.emit("room:quiz_select", {
      code,
      quizId
    });
  }

  function answer(optionId: string) {
    if (!question || ended || !isJoined) return;

    setAnswerValidated(false);
    setSelectedOptionIds((previous) => {
      const next = previous.includes(optionId)
        ? previous.filter((selectedOptionId) => selectedOptionId !== optionId)
        : [...previous, optionId];

      sendAnswer(next, textAnswer, false, null);

      return next;
    });
  }

  function updateTextAnswer(value: string) {
    setTextAnswer(value);
    setAnswerValidated(false);
    sendAnswer([], value, false, null);
  }

  function buzz() {
    if (!question || !isJoined || ended || activeBuzz || !isQpucQuestion) return;

    socketRef.current?.emit("game:buzz", {
      sessionId: question.sessionId,
      roomCode: code,
      questionId: question.question.id
    });
  }

  function submitQpucAnswer() {
    if (!question || !isQpucQuestion || !activeBuzzIsMine || !qpucAnswerText.trim()) return;

    socketRef.current?.emit("game:answer", {
      sessionId: question.sessionId,
      roomCode: code,
      questionId: question.question.id,
      optionIds: [],
      textAnswer: qpucAnswerText,
      validated: true
    });
  }

  function updateAnswerValidated(value: boolean) {
    setAnswerValidated(value);
    sendAnswer(selectedOptionIds, textAnswer, value, selectedPoint);
  }

  function selectImagePoint(point: ImagePointDto) {
    if (!question || ended || !isJoined || !isImageRegionQuestion) return;

    setAnswerValidated(false);
    setSelectedPoint(point);
    sendAnswer([], textAnswer, false, point);
  }

  function sendAnswer(
    optionIds: string[],
    answerText: string,
    validated = answerValidated,
    point: ImagePointDto | null = selectedPoint
  ) {
    if (!question || ended || !isJoined) return;

    socketRef.current?.emit("game:answer", {
      sessionId: question.sessionId,
      roomCode: code,
      questionId: question.question.id,
      optionIds,
      textAnswer: answerText,
      selectedPoint: point ?? undefined,
      validated
    });
  }

  async function likeQuiz() {
    if (!room?.quizId || likedQuizIds.includes(room.quizId)) return;

    setIsLiking(true);
    try {
      await fetch(`${apiUrl}/quizzes/${room.quizId}/like`, {
        method: "POST"
      });
      const nextLikedQuizIds = [...likedQuizIds, room.quizId];
      setLikedQuizIds(nextLikedQuizIds);
      window.localStorage.setItem("liked-quiz-ids", JSON.stringify(nextLikedQuizIds));
    } finally {
      setIsLiking(false);
    }
  }

  async function reportQuiz() {
    if (!room?.quizId || !reportReason) return;

    await fetch(`${apiUrl}/quizzes/${room.quizId}/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: reportReason, reporterKey: getReporterKey() })
    });
    const nextReportedQuizIds = reportedQuizIds.includes(room.quizId)
      ? reportedQuizIds
      : [...reportedQuizIds, room.quizId];
    setReportedQuizIds(nextReportedQuizIds);
    window.localStorage.setItem("reported-quiz-ids", JSON.stringify(nextReportedQuizIds));
    setShowReportModal(false);
    setReportReason("");
  }

  async function copyRoomUrl() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  function skipExplanations() {
    if (!question || !ended || explanationsSkipped) return;

    setExplanationsSkipped(true);
    socketRef.current?.emit("game:skip_explanations", {
      sessionId: question.sessionId,
      roomCode: code,
      questionId: question.question.id
    });
  }

  function answerChoiceClass(optionId: string) {
    const classes = ["answer-choice"];

    if (selectedOptionIds.includes(optionId)) {
      classes.push("answer-choice-selected");
    }

    if (ended) {
      classes.push(ended.correctOptionIds.includes(optionId) ? "answer-choice-correct" : "answer-choice-wrong");
    }

    return classes.join(" ");
  }

  return (
    <main className={question && !finished ? "stack game-screen" : "stack"}>
      {question && !finished && rankedPlayers.length > 0 ? (
        <aside className="player-rail" aria-label="Classement live">
          {rankedPlayers.map((player, index) => {
            const resultStatus = playerResultById.get(player.id);
            const answerStatus = answerStatusByPlayerId[player.id];
            const bubbleClass = resultStatus
              ? `player-bubble player-bubble-${resultStatus}`
              : answerStatus?.validated
                ? "player-bubble player-bubble-ready"
                : answerStatus?.hasAnswer
                  ? "player-bubble player-bubble-answered"
                  : "player-bubble";

            return (
              <div
                className={bubbleClass}
                key={`${player.id}-${ended?.questionId ?? "playing"}`}
                title={`${index + 1}. ${player.displayName}${
                  answerStatus?.validated
                    ? " · réponse validée"
                    : answerStatus?.hasAnswer
                      ? " · réponse en cours"
                      : " · pas encore répondu"
                }`}
              >
                <span>{player.displayName.trim().charAt(0).toUpperCase() || "?"}</span>
                <small>{liveScores[player.id] ?? player.score}</small>
              </div>
            );
          })}
        </aside>
      ) : null}
      <section className="panel stack">
        <div>
          <h1>{hostPlayer ? `Room de ${hostPlayer.displayName}` : "Room"}</h1>
          <p className="room-code">Code {code}</p>
          <p className="muted">Partage ce code pour inviter un autre joueur.</p>
        </div>

        <div className="row">
          <button type="button" onClick={copyRoomUrl}>
            {copied ? "URL copiée" : "Copier l'URL"}
          </button>
          {!isJoined ? (
            <>
              <input
                aria-label="Nom joueur"
                placeholder="Ton nom"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
              <button type="button" disabled={isJoining} onClick={joinRoom}>
                {isJoining ? "Connexion..." : "Rejoindre"}
              </button>
            </>
          ) : (
            <span className="muted">Connecté : {currentPlayer?.displayName}</span>
          )}
          {isHost && room?.status === "lobby" && !question && !finished ? (
            <button type="button" disabled={!room?.quizId} onClick={startGame}>
              Lancer
            </button>
          ) : null}
        </div>

        {isHost && room?.status === "lobby" && quizPreview ? (
          <div className="room-setup-panel stack" aria-label="Réglages de partie">
            <div className="timing-options room-setup-options">
              <button
                aria-pressed={timingMode === "no_timer"}
                className={timingMode === "no_timer" ? "timing-option timing-option-active" : "timing-option"}
                disabled={selectedGameMode === "qpuc_face_to_face"}
                type="button"
                onClick={() => {
                  if (selectedGameMode !== "qpuc_face_to_face") {
                    setTimingMode((current) => (current === "no_timer" ? "dynamic_timer" : "no_timer"));
                  }
                }}
              >
                {selectedGameMode === "qpuc_face_to_face"
                  ? "Sans chrono indisponible"
                  : timingMode === "no_timer"
                    ? "Sans chrono activé"
                    : "Sans chrono"}
              </button>
              {roomCompatibleGameModes.map((modeId) => (
                <button
                  aria-pressed={selectedGameMode === modeId}
                  className={selectedGameMode === modeId ? "timing-option timing-option-active" : "timing-option"}
                  disabled={roomCompatibleGameModes.length === 1}
                  key={modeId}
                  type="button"
                  onClick={() => setSelectedGameMode(modeId)}
                  title={GAME_MODE_DEFINITIONS[modeId].description}
                >
                  {GAME_MODE_DEFINITIONS[modeId].shortLabel}
                </button>
              ))}
            </div>
            {selectedGameMode === "classic" && classicQuestionMax > 0 ? (
              <label className="question-count-control">
                <span>Questions jouées</span>
                <input
                  aria-label="Nombre de questions jouées"
                  max={classicQuestionMax}
                  min={1}
                  type="number"
                  value={selectedQuestionCount ?? classicQuestionMax}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);
                    setSelectedQuestionCount(
                      Number.isFinite(nextValue) ? Math.max(1, Math.min(classicQuestionMax, nextValue)) : classicQuestionMax
                    );
                  }}
                />
                <small>/ {classicQuestionMax}</small>
              </label>
            ) : null}
          </div>
        ) : null}

        {error ? <p role="alert">{error}</p> : null}
      </section>

      {room && !question && !finished ? (
        <section className="panel stack quiz-preview">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <h2>Quiz sélectionné</h2>
              <p className="muted">Ce quiz sera lancé dans cette room.</p>
            </div>
            {isHost ? (
              <button className="secondary-button" type="button" onClick={() => setShowQuizPicker(true)}>
                Changer de quiz
              </button>
            ) : null}
          </div>

          {quizPreview ? (
            <article className="quiz-preview-card stack">
              <div>
                <h3>{quizPreview.title}</h3>
                <p className="muted">{quizPreview.questions.length} questions</p>
              </div>
              <div className="compact-meta-list">
                {quizPreview.tags.slice(0, 5).map((tag) => (
                  <span className="compact-pill" key={tag}>
                    {tag}
                  </span>
                ))}
                {quizPreview.correctionPercent && quizPreview.correctionPercent > 5 ? (
                  <span className="compact-pill compact-pill-accent">Corrigé {quizPreview.correctionPercent}%</span>
                ) : null}
                {quizPreview.compatibleGameModes.map((modeId) => (
                  <span className="compact-pill compact-pill-mode" key={modeId}>
                    {GAME_MODE_DEFINITIONS[modeId].shortLabel}
                  </span>
                ))}
                {quizPreview.sourceType === "uness" ? <span className="compact-pill">UNESS</span> : null}
                {quizPreview.sourceCity ? <span className="compact-pill">{quizPreview.sourceCity}</span> : null}
                {quizPreview.sourceYear ? <span className="compact-pill">{quizPreview.sourceYear}</span> : null}
                {quizPreview.trainingYear ? <span className="compact-pill">{quizPreview.trainingYear}</span> : null}
              </div>
              <div className="stack">
                {quizPreview.questions.slice(0, 3).map((previewQuestion, index) => (
                  <p className="quiz-preview-question" key={previewQuestion.id}>
                    <strong>{index + 1}.</strong> {previewQuestion.prompt}
                  </p>
                ))}
                {quizPreview.questions.length > 3 ? (
                  <p className="muted">+{quizPreview.questions.length - 3} autres questions</p>
                ) : null}
              </div>
            </article>
          ) : room.quizId ? (
            <p className="muted">Chargement de l'aperçu du quiz...</p>
          ) : (
            <p className="muted">Aucun quiz n'est encore associé à cette room.</p>
          )}
        </section>
      ) : null}

      {room ? (
        <section className="grid">
          {room.players.map((player) => (
            <article className="card" key={player.id}>
              <strong>{player.displayName}</strong>
              <p className="muted">
                <span className="score-pop" key={liveScores[player.id] ?? player.score}>
                  {liveScores[player.id] ?? player.score}
                </span>{" "}
                points
              </p>
            </article>
          ))}
        </section>
      ) : null}

      {question && !finished ? (
        <section className="panel stack" ref={questionPanelRef}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <p className="muted">
              Question {question.questionIndex + 1} / {question.totalQuestions}
            </p>
            <p className="muted">{isNoTimerQuestion ? "Sans chrono" : `${Math.ceil((remainingMs ?? 0) / 1000)}s`}</p>
          </div>
          {isQpucQuestion ? (
            <QpucFaceToFaceStage
              activeBuzzPlayerName={
                activeBuzz ? room?.players.find((player) => player.id === activeBuzz.playerId)?.displayName : undefined
              }
              baseHandPlayerId={qpucBaseHandPlayerId}
              buzzAnswerRemainingSeconds={buzzAnswerRemainingSeconds}
              buzzDisabled={!isJoined || Boolean(ended) || Boolean(activeBuzz) || currentPlayerId !== qpucCurrentHandPlayerId}
              correctAnswer={ended?.questionExplanation}
              currentHandPlayerId={qpucCurrentHandPlayerId}
              currentSegmentIndex={qpucSegmentIndex}
              isAnswering={Boolean(activeBuzzIsMine)}
              leftPlayer={leftQpucPlayer}
              attemptsByPlayerId={qpucAttemptsByPlayerId}
              pointsAvailable={qpucPointsAvailable}
              questionPrompt={question.question.prompt}
              answerText={qpucAnswerText}
              clues={visibleQpucClues}
              progressRatio={qpucElapsedRatio}
              rightPlayer={rightQpucPlayer}
              scoringPlayerName={qpucScoringPlayer?.displayName}
              scoringPoints={qpucScoringPoints}
              scoringStreakCount={qpucScoringStreakCount}
              onBuzz={buzz}
              onSubmitAnswer={submitQpucAnswer}
              onAnswerTextChange={setQpucAnswerText}
            />
          ) : isNoTimerQuestion ? (
            <div className="no-timer-track">La question passera quand tous les joueurs auront validé.</div>
          ) : (
            <div className="timer-track" aria-hidden="true">
              <div className="timer-fill" style={{ width: `${remainingRatio * 100}%` }} />
            </div>
          )}
          {!isQpucQuestion ? <h2>{question.question.prompt}</h2> : null}
          {question.question.imageUrl && !isImageRegionQuestion ? (
            <img className="question-image" src={question.question.imageUrl} alt="" />
          ) : null}
          {isImageRegionQuestion ? (
            <ImageRegionPlayer
              correctRegions={ended?.correctRegions ?? []}
              disabled={Boolean(ended) || !isJoined}
              imageUrl={question.question.imageUrl}
              selectedPoint={selectedPoint}
              showCorrectRegions={Boolean(ended)}
              onSelect={selectImagePoint}
            />
          ) : isQpucQuestion ? null : isOpenTextQuestion ? (
            <input
              disabled={Boolean(ended) || !isJoined}
              placeholder="Ta réponse"
              value={textAnswer}
              onChange={(event) => updateTextAnswer(event.target.value)}
            />
          ) : (
            <div className="grid">
              {question.question.options.map((option) => (
                <button
                  className={answerChoiceClass(option.id)}
                  disabled={Boolean(ended) || !isJoined}
                  key={option.id}
                  type="button"
                  onClick={() => answer(option.id)}
                >
                  <span>{option.label}</span>
                  {explanationsByOptionId.has(option.id) ? (
                    <small className="answer-explanation">{explanationsByOptionId.get(option.id)}</small>
                  ) : null}
                </button>
              ))}
            </div>
          )}
          {!ended && !isQpucQuestion ? (
            <button
              aria-pressed={answerValidated}
              className={answerValidated ? "commit-answer-button commit-answer-button-active" : "commit-answer-button"}
              disabled={!isJoined}
              type="button"
              onClick={() => updateAnswerValidated(!answerValidated)}
            >
              {answerValidated ? "Réponse validée" : isNoTimerQuestion ? "Valider et attendre les autres" : "Valider ma réponse"}
            </button>
          ) : null}
          {ended ? (
            <div className="explanation-panel stack" ref={explanationPanelRef}>
              {isImageRegionQuestion ? (
                ended.questionExplanation ? <p className="muted">{ended.questionExplanation}</p> : null
              ) : isQpucQuestion ? (
                <p className="muted">Question terminée.</p>
              ) : (
                <p className="muted">
                  Bonne réponse :{" "}
                  {ended.correctOptionIds.map((optionId) => questionOptionLabels.get(optionId) ?? optionId).join(", ")}
                </p>
              )}
              {isHost ? (
                <button
                  className="commit-answer-button"
                  disabled={explanationsSkipped}
                  type="button"
                  onClick={skipExplanations}
                >
                  {explanationsSkipped
                    ? "Passage en cours..."
                    : isQpucQuestion
                      ? "Passer à la question suivante"
                      : "Passer les explications"}
                </button>
              ) : (
                <p className="muted">En attente du créateur de la room pour passer à la suite.</p>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      {finished ? (
        <section className="panel stack">
          <h2>Scores finaux</h2>
          {finished.ranking.map((entry, index) => (
            <div className={entry.playerId === currentPlayerId ? "row final-score-row final-score-current" : "row final-score-row"} key={entry.playerId}>
              <strong>{index + 1}.</strong>
              <span>{room?.players.find((player) => player.id === entry.playerId)?.displayName ?? entry.playerId}</span>
              <span>{entry.score} points</span>
            </div>
          ))}
          {room?.quizId ? (
            <div className="row">
              <button type="button" disabled={likedQuizIds.includes(room.quizId) || isLiking} onClick={likeQuiz}>
                {likedQuizIds.includes(room.quizId) ? "Quiz liké" : "Liker ce quiz"}
              </button>
              <button
                className="secondary-button"
                disabled={reportedQuizIds.includes(room.quizId)}
                type="button"
                onClick={() => setShowReportModal(true)}
              >
                {reportedQuizIds.includes(room.quizId) ? "Quiz signalé" : "Signaler ce quiz"}
              </button>
            </div>
          ) : null}
          {isHost ? (
            <button className="commit-answer-button" type="button" onClick={returnToLobby}>
              Retour à la room
            </button>
          ) : (
            <p className="muted">En attente du créateur pour revenir à la room.</p>
          )}
        </section>
      ) : null}
      {showReportModal ? (
        <div className="modal-backdrop" role="presentation">
          <form
            className="modal stack"
            onSubmit={(event) => {
              event.preventDefault();
              void reportQuiz();
            }}
          >
            <h2>Signaler le quiz</h2>
            <label className="checkbox-label">
              <input
                checked={reportReason === "wrong_content"}
                onChange={() => setReportReason("wrong_content")}
                type="radio"
              />
              Énoncés / réponses fausses
            </label>
            <label className="checkbox-label">
              <input
                checked={reportReason === "offensive_content"}
                onChange={() => setReportReason("offensive_content")}
                type="radio"
              />
              Contenu offensant
            </label>
            <label className="checkbox-label">
              <input checked={reportReason === "other"} onChange={() => setReportReason("other")} type="radio" />
              Autres
            </label>
            <label className="checkbox-label">
              <input
                checked={reportReason === "incorrect_uness_metadata"}
                onChange={() => setReportReason("incorrect_uness_metadata")}
                type="radio"
              />
              Métadonnées UNESS incorrectes
            </label>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="secondary-button" type="button" onClick={() => setShowReportModal(false)}>
                Annuler
              </button>
              <button type="submit" disabled={!reportReason}>
                Signaler
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {showQuizPicker ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal quiz-picker-modal stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2>Choisir un quiz</h2>
              <button className="secondary-button" type="button" onClick={() => setShowQuizPicker(false)}>
                Fermer
              </button>
            </div>
            {isLoadingQuizOptions ? <p className="muted">Chargement des quiz...</p> : null}
            <input
              aria-label="Rechercher un quiz"
              placeholder="Rechercher par titre, tag, ville, année..."
              value={quizPickerSearch}
              onChange={(event) => setQuizPickerSearch(event.target.value)}
            />
            <div className="stack quiz-picker-list">
              {filteredQuizOptions.map((quiz) => (
                <button
                  className={quiz.id === room?.quizId ? "quiz-picker-item quiz-picker-item-selected" : "quiz-picker-item"}
                  key={quiz.id}
                  type="button"
                  onClick={() => selectQuiz(quiz.id)}
                >
                  <span>
                    <strong>{quiz.title}</strong>
                    <small>
                      {quiz._count?.questions ?? 0} questions
                      {quiz.sourceType === "uness" ? " · UNESS" : ""}
                      {quiz.sourceCity ? ` · ${quiz.sourceCity}` : ""}
                      {quiz.sourceYear ? ` · ${quiz.sourceYear}` : ""}
                    </small>
                  </span>
                  {quiz.correctionPercent && quiz.correctionPercent > 5 ? (
                    <small>Corrigé {quiz.correctionPercent}%</small>
                  ) : null}
                </button>
              ))}
              {!isLoadingQuizOptions && filteredQuizOptions.length === 0 ? (
                <p className="muted">Aucun quiz ne correspond à cette recherche.</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function ImageRegionPlayer({
  correctRegions,
  disabled,
  imageUrl,
  selectedPoint,
  showCorrectRegions,
  onSelect
}: {
  correctRegions: ImageRegionDto[];
  disabled: boolean;
  imageUrl?: string;
  selectedPoint: ImagePointDto | null;
  showCorrectRegions: boolean;
  onSelect: (point: ImagePointDto) => void;
}) {
  if (!imageUrl) {
    return <p className="inline-error">Image indisponible pour cette question.</p>;
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (disabled) return;

    const rect = event.currentTarget.getBoundingClientRect();
    onSelect({
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height)
    });
  }

  return (
    <button
      aria-label="Sélectionner une zone sur l'image"
      className="image-region-player"
      disabled={disabled}
      type="button"
      onPointerDown={handlePointerDown}
    >
      <img className="question-image" src={imageUrl} alt="" draggable={false} />
      <svg className="image-region-answer-overlay" aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 100 100">
        {showCorrectRegions
          ? correctRegions.map((region) => (
              <polygon className="image-region-polygon" key={region.id} points={toSvgPoints(region.points)} />
            ))
          : null}
      </svg>
      {selectedPoint ? (
        <span
          className={showCorrectRegions ? "image-click-marker image-click-marker-final" : "image-click-marker"}
          style={{
            left: `${selectedPoint.x * 100}%`,
            top: `${selectedPoint.y * 100}%`
          }}
        />
      ) : (
        <span className="image-region-placeholder">Clique sur l'image pour placer ton pointeur.</span>
      )}
    </button>
  );
}

function QpucFaceToFaceStage({
  activeBuzzPlayerName,
  answerText,
  attemptsByPlayerId,
  baseHandPlayerId,
  buzzAnswerRemainingSeconds,
  buzzDisabled,
  clues,
  correctAnswer,
  currentHandPlayerId,
  currentSegmentIndex,
  isAnswering,
  leftPlayer,
  pointsAvailable,
  progressRatio,
  questionPrompt,
  rightPlayer,
  scoringPlayerName,
  scoringPoints,
  scoringStreakCount,
  onAnswerTextChange,
  onBuzz,
  onSubmitAnswer
}: {
  activeBuzzPlayerName?: string;
  answerText: string;
  attemptsByPlayerId: Record<string, { text: string; isCorrect?: boolean }>;
  baseHandPlayerId?: string;
  buzzAnswerRemainingSeconds: number;
  buzzDisabled: boolean;
  clues: string[];
  correctAnswer?: string;
  currentHandPlayerId?: string;
  currentSegmentIndex: number;
  isAnswering: boolean;
  leftPlayer?: PlayerDto;
  pointsAvailable: 1 | 2 | 3 | 4;
  progressRatio: number;
  questionPrompt: string;
  rightPlayer?: PlayerDto;
  scoringPlayerName?: string;
  scoringPoints: number;
  scoringStreakCount: number;
  onAnswerTextChange: (value: string) => void;
  onBuzz: () => void;
  onSubmitAnswer: () => void;
}) {
  const activeHandPlayerName =
    [leftPlayer, rightPlayer].find((player) => player?.id === currentHandPlayerId)?.displayName ?? "l'autre joueur";
  const segmentPoints = [4, 3, 2, 1] as const;
  const currentClue = clues[clues.length - 1];
  const hasStreakReaction = Boolean(correctAnswer && scoringPlayerName && scoringStreakCount >= 2);
  const presenterSpeech =
    hasStreakReaction
      ? `Mais, mais, c'est encore la bonne réponse ! Décidément ${scoringPlayerName} est en forme et remporte ${scoringPoints} point${
          scoringPoints > 1 ? "s" : ""
        }.`
      : correctAnswer && scoringPlayerName
      ? `${correctAnswer} est la bonne réponse ! ${scoringPlayerName} remporte ${scoringPoints} point${
          scoringPoints > 1 ? "s" : ""
        }.`
      : correctAnswer
        ? `Temps écoulé. La réponse attendue était : ${correctAnswer}.`
        : currentClue ?? "Je prépare le prochain indice...";
  const presenterImage = hasStreakReaction
    ? "/samuel-etienne-stupefait.png"
    : correctAnswer && scoringPlayerName
      ? "/samuel-etienne-bravo.png"
      : "/samuel-etienne-qpuc.png";

  return (
    <section className="qpuc-stage">
      <div className="qpuc-presenter-area">
        <p className="muted">{questionPrompt}</p>
        <div className="qpuc-presenter">
          <img src={presenterImage} alt="" />
          <p className={correctAnswer ? "qpuc-clue-bubble qpuc-clue-bubble-answer" : "qpuc-clue-bubble"}>
            {presenterSpeech}
          </p>
        </div>
      </div>

      <div className="qpuc-play-row">
        <div className="qpuc-gauge-board" aria-label={`Points disponibles : ${pointsAvailable}`}>
          <PlayerHandToken
            player={leftPlayer}
            active={currentHandPlayerId === leftPlayer?.id}
            attempt={leftPlayer ? attemptsByPlayerId[leftPlayer.id] : undefined}
            side="left"
          />
          <div className="qpuc-gauge">
            {segmentPoints.map((points, index) => {
              const segmentHandPlayerId = segmentHandForIndex(
                index,
                baseHandPlayerId,
                leftPlayer,
                rightPlayer,
                currentSegmentIndex,
                currentHandPlayerId
              );
              const side = segmentHandPlayerId === leftPlayer?.id ? "left" : "right";
              const fillRatio = fillRatioForQpucSegment(index, progressRatio);
              const className = [
                "qpuc-gauge-cell",
                `qpuc-gauge-cell-${side}`,
                index === currentSegmentIndex ? "qpuc-gauge-cell-active" : ""
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <span className={className} key={points}>
                  <span className="qpuc-gauge-fill" style={{ height: `${fillRatio * 100}%` }} />
                  <span className="qpuc-gauge-number">{points}</span>
                </span>
              );
            })}
          </div>
          <PlayerHandToken
            player={rightPlayer}
            active={currentHandPlayerId === rightPlayer?.id}
            attempt={rightPlayer ? attemptsByPlayerId[rightPlayer.id] : undefined}
            side="right"
          />
        </div>

        <div className="qpuc-buzzer-zone">
          <button className="qpuc-buzzer" disabled={buzzDisabled} type="button" onClick={onBuzz}>
            BUZZ
          </button>
          {activeBuzzPlayerName ? (
            <p className="muted">
              {isAnswering
                ? `Tu as ${buzzAnswerRemainingSeconds}s pour répondre.`
                : `${activeBuzzPlayerName} répond...`}
            </p>
          ) : (
            <p className="muted">
              {correctAnswer
                ? "Question terminée."
                : buzzDisabled
                  ? `La main est à ${activeHandPlayerName}.`
                  : "Tu as la main : buzz quand tu penses avoir la réponse."}
            </p>
          )}
          {isAnswering ? (
            <form
              className="qpuc-answer-popover"
              onSubmit={(event) => {
                event.preventDefault();
                onSubmitAnswer();
              }}
            >
              <input
                autoFocus
                placeholder="Ta réponse"
                value={answerText}
                onChange={(event) => onAnswerTextChange(event.target.value)}
              />
              <button type="submit" disabled={!answerText.trim()}>
                Répondre
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function PlayerHandToken({
  active,
  attempt,
  player,
  side
}: {
  active: boolean;
  attempt?: { text: string; isCorrect?: boolean };
  player?: PlayerDto;
  side: "left" | "right";
}) {
  return (
    <div className={active ? "qpuc-player-token qpuc-player-token-active" : "qpuc-player-token"} data-side={side}>
      <span>{player?.displayName.trim().charAt(0).toUpperCase() || "?"}</span>
      <small>{player?.displayName ?? "Joueur"}</small>
      {attempt?.text ? (
        <em className={attempt.isCorrect ? "qpuc-attempt-bubble qpuc-attempt-bubble-correct" : "qpuc-attempt-bubble"}>
          {attempt.text} ?
        </em>
      ) : null}
    </div>
  );
}

function segmentHandForIndex(
  index: number,
  baseHandPlayerId: string | undefined,
  leftPlayer: PlayerDto | undefined,
  rightPlayer: PlayerDto | undefined,
  currentSegmentIndex: number,
  currentHandPlayerId: string | undefined
): string | undefined {
  if (index === currentSegmentIndex && currentHandPlayerId) {
    return currentHandPlayerId;
  }

  const basePlayerId = baseHandPlayerId ?? leftPlayer?.id;
  const oppositePlayerId = basePlayerId === leftPlayer?.id ? rightPlayer?.id : leftPlayer?.id;

  return index % 2 === 0 ? basePlayerId : oppositePlayerId;
}

function fillRatioForQpucSegment(index: number, progressRatio: number): number {
  const segmentStart = index / 4;
  const segmentEnd = (index + 1) / 4;

  if (progressRatio <= segmentStart) {
    return 1;
  }

  if (progressRatio >= segmentEnd) {
    return 0;
  }

  return 1 - (progressRatio - segmentStart) * 4;
}

function getOpposingPlayerId(players: PlayerDto[], playerId: string | undefined): string | undefined {
  return players.find((player) => player.id !== playerId)?.id ?? playerId;
}

function toSvgPoints(points: ImagePointDto[]): string {
  return points.map((point) => `${point.x * 100},${point.y * 100}`).join(" ");
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function visibleClueCount(clues: string[], elapsedRatio: number): number {
  if (clues.length === 0) {
    return 0;
  }

  const wordCounts = clues.map((clue) => Math.max(1, clue.trim().split(/\s+/).filter(Boolean).length));
  const totalWords = wordCounts.reduce((total, count) => total + count, 0);
  let previousWords = 0;
  let visible = 0;

  for (let index = 0; index < clues.length; index += 1) {
    const revealRatio = (previousWords / totalWords) * 0.9;

    if (elapsedRatio >= revealRatio) {
      visible = index + 1;
    }

    previousWords += wordCounts[index];
  }

  return visible;
}

function pointsForQpucElapsedRatio(elapsedRatio: number): 1 | 2 | 3 | 4 {
  if (elapsedRatio <= 0.25) return 4;
  if (elapsedRatio <= 0.5) return 3;
  if (elapsedRatio <= 0.75) return 2;
  return 1;
}

function playerStorageKey(code: string) {
  return `quiz-room:${code}:player-id`;
}

function getReporterKey() {
  const existingKey = window.localStorage.getItem("quiz-reporter-key");

  if (existingKey) {
    return existingKey;
  }

  const key = crypto.randomUUID();
  window.localStorage.setItem("quiz-reporter-key", key);
  return key;
}
