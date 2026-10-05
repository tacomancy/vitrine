import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { KeyStatus, KeyTest } from "core";
import { useEffect, useRef, useState } from "react";
import styles from "./Settings.module.css";
import { hashOf, SCOUTS } from "./router";
import { useTRPC } from "./trpc";
import { Wrong } from "./Wrong";

/**
 * *What it talks to* (#465; ADR 0025; ADR 0017 decision 4; prototype 13):
 * one block for the one Provider, over `credentials.status | set | delete |
 * test`. There is no way to read a key back, so there is nothing here that
 * could show one: the field is only ever written to, and is emptied once the
 * key has gone. A Keychain that cannot be used is stated as that, and is
 * never drawn as *no key stored*, which would send someone to enter a key
 * that is already there.
 */

const PROVIDER = { provider: "anthropic" } as const;

export function WhatItTalksTo({ scrollTo = false }: { scrollTo?: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const status = useQuery(trpc.credentials.status.queryOptions(PROVIDER));
  const model = useQuery(trpc.credentials.model.queryOptions(PROVIDER));
  const waiting = useQuery(trpc.credentials.waiting.queryOptions(PROVIDER));
  const [typed, setTyped] = useState("");
  const [modelEdit, setModelEdit] = useState<string | null>(null);

  // Storing a key, or a test that passes, starts the Scouts waiting on it, so
  // who is waiting has changed too.
  const waitersChanged = () => {
    void queryClient.invalidateQueries({
      queryKey: trpc.credentials.waiting.queryKey(),
    });
    void queryClient.invalidateQueries({
      queryKey: trpc.scouts.health.queryKey(),
    });
  };
  const test = useMutation(
    trpc.credentials.test.mutationOptions({ onSuccess: waitersChanged })
  );
  const keyChanged = () => {
    // A verdict on the old key says nothing about the new state.
    test.reset();
    void queryClient.invalidateQueries({
      queryKey: trpc.credentials.status.queryKey(),
    });
    waitersChanged();
  };
  const set = useMutation(
    trpc.credentials.set.mutationOptions({
      onSuccess: () => {
        setTyped("");
        keyChanged();
      },
    })
  );
  const remove = useMutation(
    trpc.credentials.delete.mutationOptions({ onSuccess: keyChanged })
  );
  const saveModel = useMutation(
    trpc.credentials.setModel.mutationOptions({
      onSuccess: () => {
        setModelEdit(null);
        void queryClient.invalidateQueries({
          queryKey: trpc.credentials.model.queryKey(),
        });
      },
    })
  );

  // A Scout blocked on its key sends the researcher here; the section is the
  // last on the page, so without this they would land above it and look for it.
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (scrollTo) section.current?.scrollIntoView?.({ block: "start" });
  }, [scrollTo]);

  const state = status.data;
  const present = state?.state === "present";
  const rejected = present && test.data?.result === "rejected";
  const modelText = modelEdit ?? model.data?.model ?? "";
  const refusal = set.error ?? remove.error ?? saveModel.error;

  return (
    <section
      ref={section}
      className={styles.section}
      aria-labelledby="settings-talks"
    >
      <h2 id="settings-talks" className={styles.heading}>
        What it talks to
      </h2>
      <h3 className={styles.block}>Anthropic</h3>
      <dl className={styles.rows}>
        <div className={styles.row}>
          <dt className={styles.label}>Key</dt>
          <dd className={styles.value}>
            <span className={styles.fact}>
              <KeyState
                loading={status.isPending}
                failed={status.isError}
                state={state}
                rejected={rejected}
              />
              {present && (
                <span className={styles.note}>macOS Keychain · “Vitrine”</span>
              )}
            </span>
            {present && (
              <>
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => test.mutate(PROVIDER)}
                  disabled={test.isPending}
                >
                  Test
                </button>
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => remove.mutate(PROVIDER)}
                  disabled={remove.isPending}
                >
                  Remove
                </button>
              </>
            )}
          </dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>
            {present ? "New key" : "Store a key"}
          </dt>
          <dd className={styles.value}>
            <input
              className={styles.input}
              type="password"
              aria-label="Key"
              autoComplete="off"
              spellCheck={false}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && typed.trim() !== "") {
                  set.mutate({ ...PROVIDER, key: typed });
                }
              }}
            />
            <button
              type="button"
              className={styles.action}
              onClick={() => set.mutate({ ...PROVIDER, key: typed })}
              disabled={typed.trim() === "" || set.isPending}
            >
              {present ? "Replace" : "Store"}
            </button>
          </dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>Model</dt>
          <dd className={styles.value}>
            <input
              className={styles.input}
              aria-label="Model"
              spellCheck={false}
              value={modelText}
              onChange={(event) => setModelEdit(event.target.value)}
            />
            <button
              type="button"
              className={styles.action}
              onClick={() =>
                saveModel.mutate({ ...PROVIDER, model: modelText })
              }
              disabled={
                modelEdit === null ||
                modelEdit.trim() === "" ||
                saveModel.isPending
              }
            >
              Save model
            </button>
          </dd>
        </div>
        {waiting.data !== undefined && waiting.data.length > 0 && (
          <div className={styles.row}>
            <dt className={styles.label}>Waiting</dt>
            <dd className={styles.value}>
              <ul className={styles.waiting}>
                {waiting.data.map((scout) => (
                  <li key={scout.id}>
                    <a href={hashOf(SCOUTS)}>{scout.name}</a>{" "}
                    {/* The Voice follows the message (ADR 0040 d.1): nothing
                        was tried without a key, and a refused one was. */}
                    {scout.message === "no key" ? (
                      <>not yet — no key stored</>
                    ) : (
                      <Wrong>
                        {scout.message === "key rejected"
                          ? "key rejected"
                          : "the key could not be used"}
                      </Wrong>
                    )}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        {test.data !== undefined && (
          <div className={styles.row}>
            <dt className={styles.label}>Test</dt>
            <dd className={styles.value}>
              <TestResult result={test.data} />
            </dd>
          </div>
        )}
        {test.isError && (
          <div className={styles.row}>
            <dt className={styles.label}>Test</dt>
            <dd className={styles.value}>could not be run</dd>
          </div>
        )}
        <div className={styles.row}>
          <dt className={styles.label}>Goes to</dt>
          <dd className={styles.value}>api.anthropic.com — nowhere else</dd>
        </div>
      </dl>
      {refusal && (
        <span className={styles.refusal} role="alert">
          {refusal.message}
        </span>
      )}
      <p className={styles.paragraph}>
        Held in the macOS Keychain. Never shown back, never written to the
        vault, sent only to the address above.
      </p>
    </section>
  );
}

function KeyState({
  loading,
  failed,
  state,
  rejected,
}: {
  loading: boolean;
  failed: boolean;
  state: KeyStatus | undefined;
  rejected: boolean;
}) {
  if (failed) return <>not known</>;
  if (loading || state === undefined) return <>not yet</>;
  if (state.state === "fault") return <Wrong>{state.reason}</Wrong>;
  if (rejected) return <Wrong>key rejected</Wrong>;
  if (state.state === "present") return <>a key is stored</>;
  return (
    <>
      <span className={styles.claim}>No key stored.</span>
      <span className={styles.warrant}>Keychain checked</span>
    </>
  );
}

function TestResult({ result }: { result: KeyTest }) {
  switch (result.result) {
    case "ok":
      return <>worked</>;
    case "no-key":
      return <>no key stored</>;
    case "rejected":
      return <Wrong>the provider refused the key</Wrong>;
    case "unreachable":
      return <>the provider could not be reached</>;
    case "fault":
      return <Wrong>{result.reason}</Wrong>;
  }
}
