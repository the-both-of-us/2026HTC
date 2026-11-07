import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/** The small part of the browser's SpeechRecognition API used here. TypeScript does not ship it. */
type Recognizer = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type RecognitionResultEvent = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};

type SpeechWindow = {
  SpeechRecognition?: new () => Recognizer;
  webkitSpeechRecognition?: new () => Recognizer;
};

function recognizerClass() {
  const speechWindow = window as unknown as SpeechWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

const NEVER_CHANGES = () => () => {};

/** False during server rendering and in browsers without speech recognition. */
export function useSpeechSupported(): boolean {
  return useSyncExternalStore(
    NEVER_CHANGES,
    () => recognizerClass() !== null,
    () => false,
  );
}

const MICROPHONE_BLOCKED = "Microphone access is off, so voice input cannot start. You can type instead.";
const SPEECH_FAILED = "Voice input stopped working. You can try again, or type instead.";

type UseSpeechOptions = {
  /** Called with each finished phrase. */
  onPhrase: (phrase: string) => void;
  /** Called when listening ends, with how long it lasted. */
  onStopped: (durationMs: number) => void;
};

export function useSpeech({ onPhrase, onStopped }: UseSpeechOptions) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognizer = useRef<Recognizer | null>(null);

  // Stop the microphone if the panel closes while it is listening.
  useEffect(() => () => recognizer.current?.abort(), []);

  function start() {
    const Recognizer = recognizerClass();
    if (!Recognizer) return;

    const startedAt = Date.now();
    const instance = new Recognizer();
    instance.continuous = true;
    instance.interimResults = true;
    instance.lang = "en-CA";

    instance.onresult = (event) => {
      let unfinished = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) onPhrase(result[0].transcript.trim());
        else unfinished += result[0].transcript;
      }
      setInterim(unfinished);
    };

    instance.onerror = (event) => {
      // "no-speech" and "aborted" are normal endings, not failures.
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError(MICROPHONE_BLOCKED);
      } else if (event.error !== "no-speech" && event.error !== "aborted") {
        setError(SPEECH_FAILED);
      }
    };

    instance.onend = () => {
      recognizer.current = null;
      setListening(false);
      setInterim("");
      onStopped(Date.now() - startedAt);
    };

    recognizer.current = instance;
    setError(null);
    setListening(true);
    instance.start();
  }

  function stop() {
    recognizer.current?.stop();
  }

  return { listening, interim, error, start, stop };
}
