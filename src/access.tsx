import { useEffect, useState } from "react";
import { accessApi } from "./api";
import { Dialog, toast } from "./ui";

/** Whether the site signs people in with access codes. */
export const tokenMode = () => accessApi.config().then((c) => c.tokenMode, () => false);
export const useTokenMode = () => {
  const [on, setOn] = useState(false);
  useEffect(() => {
    tokenMode().then(setOn);
  }, []);
  return on;
};

const SIGN_IN = "flagman:signin";
const robloxLogin = (next?: string) => location.assign(`/api/auth/roblox/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);

/** Start sign-in: the code box when access codes are on, otherwise straight to Roblox. */
export async function startSignIn(next?: string) {
  if (await tokenMode()) window.dispatchEvent(new CustomEvent(SIGN_IN, { detail: next ?? location.pathname }));
  else robloxLogin(next);
}

const ERRORS: Record<string, string> = {
  invalid_code: "That code is not valid.",
  rate_limited: "Too many wrong codes. Try again in a few minutes.",
  token_off: "Access codes are switched off.",
};

export function SignInHost() {
  const [next, setNext] = useState<string | null>(null);
  const [code, setCode] = useState("");
  useEffect(() => {
    const on = (e: Event) => setNext((e as CustomEvent<string>).detail);
    window.addEventListener(SIGN_IN, on);
    return () => window.removeEventListener(SIGN_IN, on);
  }, []);
  if (next === null) return null;
  const submit = async () => {
    const r = await accessApi.signIn(code);
    if (r.ok) location.assign(next);
    else toast(ERRORS[r.error] ?? "Sign-in failed.");
  };
  return (
    <Dialog
      title="Sign in"
      size="s"
      onClose={() => setNext(null)}
      foot={
        <>
          <button className="r-btn" onClick={() => robloxLogin(next)}>Staff: Roblox</button>
          <button className="r-btn" disabled={code.replace(/[^a-zA-Z0-9]/g, "").length !== 9} onClick={submit}>Sign in</button>
        </>
      }
    >
      <div className="r-form-field">
        <span className="r-label">Access code</span>
        <input className="r-field" aria-label="Access code" placeholder="xxx-xxx-xxx" maxLength={11} autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && code && submit()} />
      </div>
      <div style={{ color: "var(--r-text-dim)" }}>Your team or the stewards give you this code.</div>
    </Dialog>
  );
}

const CODE_ERRORS: Record<string, string> = {
  code_not_allowed: "Codes only work for people who are in no other team.",
  forbidden: "Not allowed.",
  not_found: "Not found.",
};

/** Hand out a new access code for one person. Generating replaces the old code. */
export function CodeDialog({ name, issue, revoke, onClose }: { name: string; issue: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>; revoke?: () => Promise<unknown>; onClose: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  const make = async () => {
    const r = await issue();
    if (r.ok) setCode((r.data as { code: string }).code);
    else toast(CODE_ERRORS[r.error] ?? "Request failed.");
  };
  return (
    <Dialog
      title={`Access code: ${name}`}
      size="s"
      onClose={onClose}
      foot={
        <>
          {revoke && <button className="r-btn r-cell--red" onClick={async () => { await revoke(); onClose(); }}>Revoke</button>}
          <button className="r-btn" onClick={code ? onClose : make}>{code ? "Done" : "Generate"}</button>
        </>
      }
    >
      {code ? (
        <>
          <input className="r-field" readOnly aria-label="Access code" style={{ fontSize: 22, textAlign: "center" }} value={code} onFocus={(e) => e.target.select()} />
          <div style={{ color: "var(--r-text-dim)" }}>Give this to {name} privately. It is only shown now.</div>
        </>
      ) : (
        <div>A new code replaces the old one, which stops working, and signs {name} out where they are signed in.</div>
      )}
    </Dialog>
  );
}
