"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * Barre de composition compacte, utilisée DANS le formulaire Server Action.
 * Entrée envoie sur ordinateur, Maj+Entrée ajoute une ligne. Sur les écrans
 * tactiles, la touche Entrée conserve la fonction de retour à la ligne.
 */
export default function SaisieMessagerie({
  initial = "",
  bloquee = false,
  interneSeulement = false,
}) {
  const textarea = useRef(null);
  const bouton = useRef(null);
  const avaitCommence = useRef(false);
  const { pending } = useFormStatus();
  const [valeur, setValeur] = useState(initial);

  useEffect(() => {
    if (textarea.current) {
      textarea.current.style.height = "auto";
      textarea.current.style.height = Math.min(textarea.current.scrollHeight, 160) + "px";
    }
  }, [valeur]);

  useEffect(() => {
    if (pending) avaitCommence.current = true;
    else if (avaitCommence.current) {
      // La Server Action s'est terminée. React a rendu le nouveau fil.
      avaitCommence.current = false;
      setValeur("");
    }
  }, [pending]);

  const pret = valeur.trim().length > 0 && !pending && !bloquee;

  function auClavier(e) {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    // L'Entrée reste un retour à la ligne sur clavier virtuel iOS/Android.
    if (window.matchMedia("(pointer: coarse)").matches) return;
    e.preventDefault();
    if (pret && bouton.current) e.currentTarget.form?.requestSubmit(bouton.current);
  }

  return (
    <div className="admin-chat-saisie">
      <label className="admin-chat-saisie__etiquette" htmlFor="corps">Votre message</label>
      <div className="admin-chat-saisie__ligne">
        <textarea
          ref={textarea}
          id="corps"
          name="corps"
          rows={1}
          required
          value={valeur}
          maxLength={30000}
          onChange={(e) => setValeur(e.target.value)}
          onKeyDown={auClavier}
          placeholder={interneSeulement ? "Écrire une note interne…" : "Écrire un message…"}
          aria-label={interneSeulement ? "Note interne" : "Message au client"}
          className="admin-chat-saisie__champ"
        />
        {interneSeulement ? (
          <button
            ref={bouton}
            type="submit"
            name="interne"
            value="1"
            className="admin-chat-saisie__envoi"
            aria-label="Publier la note interne"
            title="Publier la note interne"
            disabled={!pret}
          >
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 12h14m-7-7 7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : (
          <button
            ref={bouton}
            type="submit"
            className="admin-chat-saisie__envoi"
            aria-label="Envoyer le message au client"
            title="Envoyer (Entrée)"
            disabled={!pret}
          >
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 12h14m-7-7 7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
      {pending ? <p role="status" className="admin-chat-saisie__aide">Enregistrement du message…</p> : (
        <p className="admin-chat-saisie__aide">
          {bloquee ? "Complète les informations manquantes avant l’envoi." : "Entrée pour envoyer · Maj + Entrée pour revenir à la ligne"}
        </p>
      )}
    </div>
  );
}
