import { useRemoteScroll } from "./use-remote-scroll.js";
import { useEffect, useState, useRef, useCallback } from "react";
import { Button } from "./components/ui/button.js";
import { Input } from "./components/ui/input.js";
import { api } from "./api.js";
interface Frame {
  url: string;
  image: string | null;
  dialog: { type: string; message: string } | null;
}
export function RemoteBrowser({
  base,
  id,
  close,
}: {
  base: string;
  id: string;
  close(): void;
}) {
  const [frame, setFrame] = useState<Frame>();
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const queue = useRef(Promise.resolve());
  const editingAddress = useRef(false);
  const image = useRef<HTMLImageElement>(null);
  const activeUntil = useRef(0);
  const path = `${base}/instances/${id}/browser`;
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api<Frame>(path);
        if (active) {
          setFrame(next);
          if (!editingAddress.current) setAddress(next.url);
        }
      } catch (error) {
        if (active) setError(String(error));
      }
      if (active)
        timer = setTimeout(
          () => void poll(),
          Date.now() < activeUntil.current ? 40 : 200,
        );
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [path]);
  const send = useCallback(
    (action: unknown) => {
      activeUntil.current = Date.now() + 700;
      queue.current = queue.current
        .then(() => api<void>(path, "POST", action))
        .catch((error) => setError(String(error)));
      return queue.current;
    },
    [path],
  );
  useRemoteScroll(image, !!frame?.image, send);
  return (
    <div className="flex h-full min-h-0 flex-col p-4">
      <div className="mb-3 flex shrink-0 items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => send({ type: "back" })}
        >
          ← Back
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => send({ type: "reload" })}
        >
          Reload
        </Button>
        <form
          className="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            send({ type: "navigate", url: address });
          }}
        >
          <Input
            aria-label="Browser address"
            onFocus={() => {
              editingAddress.current = true;
            }}
            onBlur={() => {
              editingAddress.current = false;
            }}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
        </form>
        <Button variant="outline" size="sm" onClick={close}>
          Close view
        </Button>
      </div>
      {!frame && <p className="text-sm text-muted-foreground">Connecting…</p>}
      {error && <p role="alert">{error}</p>}
      {frame?.dialog && (
        <div
          role="dialog"
          className="mb-3 space-y-2 rounded-md border bg-muted p-3 text-sm"
        >
          <p>{frame.dialog.message}</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              send({
                type: "dialog",
                accept: true,
                text: data.get("text") ?? undefined,
              });
            }}
          >
            {frame.dialog.type === "prompt" && (
              <Input name="text" aria-label="Prompt response" />
            )}
            <Button variant="outline" size="sm" type="submit">
              OK
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => send({ type: "dialog", accept: false })}
            >
              Cancel
            </Button>
          </form>
        </div>
      )}
      {frame?.image && (
        <div className="flex min-h-0 flex-1 items-start justify-center overflow-hidden">
          <img
            ref={image}
            draggable={false}
            className="block max-h-full max-w-full object-contain outline-offset-2"
            src={`data:image/jpeg;base64,${frame.image}`}
            alt="Interactive simulation browser"
            tabIndex={0}
            onClick={(event) => {
              event.currentTarget.focus();
              const rect = event.currentTarget.getBoundingClientRect();
              send({
                type: "click",
                x: ((event.clientX - rect.left) * 1280) / rect.width,
                y: ((event.clientY - rect.top) * 800) / rect.height,
              });
            }}
            onKeyDown={(event) => {
              if (["Control", "Meta", "Alt", "Shift"].includes(event.key))
                return;
              if (
                (event.ctrlKey || event.metaKey) &&
                event.key.toLowerCase() === "v"
              )
                return;
              event.preventDefault();
              const modifiers = [
                event.ctrlKey ? "Control" : "",
                event.metaKey ? "Meta" : "",
                event.altKey ? "Alt" : "",
                event.shiftKey ? "Shift" : "",
              ].filter(Boolean);
              send(
                event.key.length === 1 &&
                  !event.ctrlKey &&
                  !event.metaKey &&
                  !event.altKey
                  ? { type: "text", text: event.key }
                  : {
                      type: "key",
                      key: [
                        ...modifiers,
                        event.key === " " ? "Space" : event.key,
                      ].join("+"),
                    },
              );
            }}
            onPaste={(event) => {
              event.preventDefault();
              send({ type: "text", text: event.clipboardData.getData("text") });
            }}
          />
        </div>
      )}
    </div>
  );
}
