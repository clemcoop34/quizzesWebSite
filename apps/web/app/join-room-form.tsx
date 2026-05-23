"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function JoinRoomForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [exists, setExists] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);

  const normalizedCode = useMemo(() => code.trim().toUpperCase(), [code]);
  const canSubmit = normalizedCode.length === 6 && exists;

  useEffect(() => {
    setExists(false);
    setHasChecked(false);

    if (normalizedCode.length !== 6) {
      setIsChecking(false);
      return;
    }

    const controller = new AbortController();
    setIsChecking(true);

    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(`${apiUrl}/rooms/${normalizedCode}`, {
          cache: "no-store",
          signal: controller.signal
        });
        setExists(response.ok);
      } catch {
        setExists(false);
      } finally {
        setHasChecked(true);
        setIsChecking(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [normalizedCode]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    router.push(`/room/${normalizedCode}`);
  }

  return (
    <form onSubmit={submit} className="stack">
      <div className="row">
        <input
          aria-label="Code de room"
          maxLength={6}
          placeholder="Code de room"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
        />
        <button type="submit" disabled={!canSubmit}>
          Rejoindre
        </button>
      </div>
      {normalizedCode.length === 6 && isChecking ? <p className="muted">Vérification...</p> : null}
      {normalizedCode.length === 6 && hasChecked && !exists ? (
        <p role="alert">Aucune room ne correspond à ce code.</p>
      ) : null}
    </form>
  );
}
