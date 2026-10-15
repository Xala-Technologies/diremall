"use client";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, Mark } from "@/components/icons";
import { Field, Message } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

export default function Login() {
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const router = useRouter();
  const { t, lang, setLang } = useI18n();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [show, setShow] = useState(false);
  useEffect(() => { if (isAuthenticated) router.replace("/"); }, [isAuthenticated, router]);

  return (
    <div className="auth-page">
      <section className="auth-art" aria-hidden="true">
        <div className="brand"><Mark size={38} /><span className="brand-mark-name">Dire Mall<small>Dire Dawa</small></span></div>
        <div>
          <h2>{lang === "am" ? "ኪራይ፣ ደረሰኝና ክፍያ በአንድ ቦታ።" : "Rent, bills and payments, in one place."}</h2>
          <p>{lang === "am" ? "እያንዳንዱ ቁጥር ወደ ውሉና ወደ ክፍያው ይመራል።" : "Every figure opens the agreement and the payments behind it."}</p>
        </div>
      </section>
      <main className="auth-form" id="main">
        <form className="auth" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setError(null);
          try { await signIn("password", new FormData(e.currentTarget)); } catch (err) {
            // Convex Auth hides most details from the browser; the server log has the real cause.
            const msg = err instanceof Error ? err.message : "";
            const known = /InvalidSecret|InvalidAccountId|Invalid password/i.test(msg);
            setError(flow === "signIn"
              ? (known ? "Email or password is incorrect." : "Could not sign in. Please try again.")
              : /invalid_email/.test(msg) ? "Enter a valid email address."
              : /Invalid password/i.test(msg) ? "Use a password of at least 8 characters."
              : t("invite.signupFailed"));
            console.error("auth error:", msg);
          } finally { setBusy(false); }
        }}>
          <div><h1>{flow === "signIn" ? t("signIn") : t("signUp")}</h1><p className="muted">{t("appName")}</p></div>
          {flow === "signUp" && <Field label={t("name")}><input name="name" required autoComplete="name" /></Field>}
          <Field label={t("email")}><input name="email" type="email" required autoComplete="email" autoFocus /></Field>
          {flow === "signUp" && <Field label={t("invite.code")} hint={t("invite.codeHint")}><input name="inviteCode" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXXX-XXXXX" /></Field>}
          <Field label={t("password")} hint={flow === "signUp" ? t("pw.hint") : undefined}>
            <div className="pw-wrap"><input name="password" type={show ? "text" : "password"} required minLength={8} autoComplete={flow === "signIn" ? "current-password" : "new-password"} />
              <button type="button" className="btn ghost sm icon-only pw-toggle" onClick={() => setShow(!show)} aria-label={show ? t("pw.hide") : t("pw.show")} aria-pressed={show}><Icon name={show ? "eyeOff" : "eye"} size={18} /></button></div></Field>
          <input name="flow" type="hidden" value={flow} />
          <Message error={error} />
          <button className="btn primary" disabled={busy}>{flow === "signIn" ? t("signIn") : t("signUp")}</button>
          <div className="row">
            <button type="button" className="btn ghost sm" onClick={() => { setFlow(flow === "signIn" ? "signUp" : "signIn"); setError(null); }}>{flow === "signIn" ? t("signUp") : t("signIn")}</button>
            <span className="grow" />
            <select aria-label={t("language")} value={lang} onChange={(e) => setLang(e.target.value as "en" | "am")}><option value="en">English</option><option value="am">አማርኛ</option></select>
          </div>
        </form>
      </main>
    </div>
  );
}
