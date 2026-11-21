"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

const MAX_FICHIER = 8 * 1024 * 1024;
const MAX_BLOC = 2 * 1024 * 1024;
const MAX_TOTAL = 10 * 1024 * 1024;
const MAX_NOMBRE = 4;

function tailleLisible(n) {
  return n >= 1024 * 1024
    ? `${(n / (1024 * 1024)).toFixed(1)} Mo`
    : `${Math.ceil(n / 1024)} Ko`;
}

function typeLocalAccepte(nom) {
  return /\.(pdf|jpe?g|png|gif|txt|csv|docx|xlsx|pptx)$/i.test(nom);
}

/**
 * Composer un message et ses pièces dans un seul formulaire Server Action.
 * Le fichier binaire est téléversé préalablement, par blocs de 2 MiB,
 * authentifiés et liés à la discussion en base. L'Action ne reçoit que des
 * identifiants UUID, pour ne pas dépasser les limites de Vercel.
 */
export default function SaisieMessagerie({
  conversationId,
  documents = [],
  initial = "",
  bloquee = false,
  interneSeulement = false,
}) {
  const textarea = useRef(null);
  const bouton = useRef(null);
  const selection = useRef(null);
  const apresSoumission = useRef(false);
  const urls = useRef(new Set());
  const cleEnvoi = useRef(null);
  const { pending } = useFormStatus();
  const [valeur, setValeur] = useState(initial);
  const [fichiers, setFichiers] = useState([]);
  const [documentsChoisis, setDocumentsChoisis] = useState([]);
  const [panneauOuvert, setPanneauOuvert] = useState(false);
  const [erreur, setErreur] = useState("");

  if (!cleEnvoi.current) cleEnvoi.current = crypto.randomUUID();

  useEffect(() => {
    if (textarea.current) {
      textarea.current.style.height = "auto";
      textarea.current.style.height = Math.min(textarea.current.scrollHeight, 160) + "px";
    }
  }, [valeur]);

  useEffect(() => {
    if (pending) apresSoumission.current = true;
    else if (apresSoumission.current) {
      apresSoumission.current = false;
      cleEnvoi.current = crypto.randomUUID();
      setValeur("");
      setFichiers([]);
      setDocumentsChoisis([]);
      setPanneauOuvert(false);
      setErreur("");
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
    }
  }, [pending]);

  useEffect(() => () => {
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current.clear();
  }, []);

  const transfertsEnCours = fichiers.some((p) => p.statut === "en_cours");
  const transfertsEchoues = fichiers.some((p) => p.statut === "erreur");
  const fichiersPrets = fichiers.filter((p) => p.statut === "pret");
  const totalFichiers = fichiers.reduce((n, p) => n + (p.statut === "erreur" ? 0 : p.taille), 0);
  const aDesPieces = fichiersPrets.length > 0 || documentsChoisis.length > 0;

  const pret = (valeur.trim().length > 0 || aDesPieces)
    && !pending && !bloquee && !transfertsEnCours && !transfertsEchoues;
  const noteInternePossible = valeur.trim().length > 0 && !pending
    && !bloquee && !transfertsEnCours && !aDesPieces;

  function auClavier(e) {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    e.preventDefault();
    if (pret && bouton.current) e.currentTarget.form?.requestSubmit(bouton.current);
  }

  async function abandonnerCoteServeur(pieceId) {
    if (!pieceId || !conversationId) return;
    try {
      await fetch(`/api/admin/messagerie/${conversationId}/pieces/${pieceId}`, {
        method: "DELETE",
      });
    } catch { /* Le dépôt temporaire expire de toute façon sous deux heures. */ }
  }

  async function retirer(fichier) {
    if (fichier.statut === "en_cours") return;
    setFichiers((actuel) => actuel.filter((f) => f.cle !== fichier.cle));
    if (fichier.apercu) {
      URL.revokeObjectURL(fichier.apercu);
      urls.current.delete(fichier.apercu);
    }
    await abandonnerCoteServeur(fichier.id);
    setErreur("");
  }

  async function televerser(fichier, cle, apercu) {
    let id = null;
    const racine = `/api/admin/messagerie/${conversationId}/pieces`;
    try {
      const init = await fetch(racine, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nom: fichier.name, taille: fichier.size }),
      });
      const donnees = await init.json().catch(() => ({}));
      if (!init.ok || !donnees.id) throw new Error(donnees.erreur || "Dépôt impossible");
      id = donnees.id;
      setFichiers((v) => v.map((p) => p.cle === cle ? { ...p, id } : p));

      for (let position = 0; position < fichier.size; position += MAX_BLOC) {
        const morceau = fichier.slice(position, Math.min(fichier.size, position + MAX_BLOC));
        const r = await fetch(`${racine}/${id}`, {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream",
            "x-fichier-offset": String(position),
          },
          body: morceau,
        });
        const reponse = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(reponse.erreur || "Transfert interrompu");
        setFichiers((v) => v.map((p) => p.cle === cle
          ? { ...p, pourcentage: Math.round((Number(reponse.taille) / fichier.size) * 100) }
          : p));
      }
      setFichiers((v) => v.map((p) => p.cle === cle
        ? { ...p, statut: "pret", pourcentage: 100, id, apercu } : p));
    } catch (e) {
      await abandonnerCoteServeur(id);
      setFichiers((v) => v.map((p) => p.cle === cle
        ? { ...p, statut: "erreur", erreur: e instanceof Error ? e.message : "Échec" }
        : p));
    }
  }

  async function fichiersChoisis(e) {
    const choisis = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!choisis.length) return;
    setErreur("");
    let nombre = fichiers.filter((f) => f.statut !== "erreur").length + documentsChoisis.length;
    let poids = totalFichiers;
    for (const fichier of choisis) {
      if (!typeLocalAccepte(fichier.name)) {
        setErreur(`Format non pris en charge : ${fichier.name}.`);
        continue;
      }
      if (fichier.size === 0 || fichier.size > MAX_FICHIER) {
        setErreur(`${fichier.name} : 8 Mo maximum par fichier.`);
        continue;
      }
      if (nombre >= MAX_NOMBRE || poids + fichier.size > MAX_TOTAL) {
        setErreur("Limite : 4 pièces et 10 Mo au total par message.");
        continue;
      }
      const cle = crypto.randomUUID();
      const apercu = /\.(pdf|jpe?g|png|gif)$/i.test(fichier.name)
        ? URL.createObjectURL(fichier) : null;
      if (apercu) urls.current.add(apercu);
      setFichiers((v) => [...v, {
        cle, nom: fichier.name, taille: fichier.size, statut: "en_cours",
        pourcentage: 0, id: null, apercu,
      }]);
      nombre += 1;
      poids += fichier.size;
      // Traitement séquentiel : pas de risque de dépasser le quota SQL sous
      // deux appels concurrents, et la progression reste facile à comprendre.
      await televerser(fichier, cle, apercu);
    }
  }

  function choisirDocument(id, actif) {
    setDocumentsChoisis((actuels) => {
      if (!actif) return actuels.filter((v) => v !== id);
      if (actuels.includes(id)) return actuels;
      if (actuels.length + fichiers.filter((p) => p.statut !== "erreur").length >= MAX_NOMBRE) {
        setErreur("4 pièces jointes maximum par message.");
        return actuels;
      }
      setErreur("");
      return [...actuels, id];
    });
  }

  return (
    <div className="admin-chat-saisie">
      <label className="admin-chat-saisie__etiquette" htmlFor="corps">Votre message</label>
      <input type="hidden" name="envoi_id" value={cleEnvoi.current} />
      {fichiersPrets.map((f) => (
        <input type="hidden" name="fichier" value={f.id} key={f.cle} />
      ))}
      {documentsChoisis.map((id) => (
        <input type="hidden" name="document" value={id} key={id} />
      ))}

      {!interneSeulement && (fichiers.length > 0 || documentsChoisis.length > 0) ? (
        <div className="admin-chat-fichiers" aria-live="polite">
          {fichiers.map((f) => (
            <span key={f.cle}
              className={`admin-chat-fichier${f.statut === "erreur" ? " admin-chat-fichier--erreur" : ""}`}>
              <span aria-hidden="true">{/\.pdf$/i.test(f.nom) ? "📄" : /\.(jpe?g|png|gif)$/i.test(f.nom) ? "🖼️" : "📎"}</span>
              <span className="admin-chat-fichier__nom" title={f.nom}>{f.nom}</span>
              <small>{f.statut === "en_cours" ? `${f.pourcentage}%`
                : f.statut === "erreur" ? f.erreur : tailleLisible(f.taille)}</small>
              {f.apercu && f.statut !== "erreur" ? (
                <a href={f.apercu} target="_blank" rel="noopener noreferrer"
                  title={`Prévisualiser ${f.nom}`}>Voir</a>
              ) : null}
              {f.statut !== "en_cours" ? (
                <button type="button" onClick={() => retirer(f)}
                  aria-label={`Retirer ${f.nom}`} title="Retirer le fichier">×</button>
              ) : null}
            </span>
          ))}
          {documentsChoisis.map((d) => {
            const doc = documents.find((v) => String(v.id) === d);
            return (
              <span key={d} className="admin-chat-fichier">
                <span aria-hidden="true">📄</span>
                <span className="admin-chat-fichier__nom">{doc?.numero ?? doc?.type ?? "Document"} · PDF</span>
                <button type="button" title="Retirer le devis"
                  onClick={() => choisirDocument(d, false)}>×</button>
              </span>
            );
          })}
        </div>
      ) : null}

      <div className="admin-chat-saisie__ligne">
        {!interneSeulement ? (
          <>
            <input ref={selection} type="file" multiple hidden
              aria-label="Choisir des fichiers à joindre"
              accept=".pdf,.jpg,.jpeg,.png,.gif,.txt,.csv,.docx,.xlsx,.pptx"
              onChange={fichiersChoisis} />
            <button type="button" className="admin-chat-ajouter"
              aria-label="Joindre un fichier ou un devis"
              title="Joindre un fichier ou un devis"
              aria-expanded={panneauOuvert}
              onClick={() => setPanneauOuvert((v) => !v)}
              disabled={pending}>
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </>
        ) : null}
        <textarea
          ref={textarea}
          id="corps"
          name="corps"
          rows={1}
          required={!aDesPieces}
          value={valeur}
          maxLength={30000}
          onChange={(e) => setValeur(e.target.value)}
          onKeyDown={auClavier}
          placeholder={interneSeulement ? "Écrire une note interne…" : "Écrire un message…"}
          aria-label={interneSeulement ? "Note interne" : "Message au client"}
          className="admin-chat-saisie__champ"
        />
        <button ref={bouton} type="submit"
          name={interneSeulement ? "interne" : undefined}
          value={interneSeulement ? "1" : undefined}
          className="admin-chat-saisie__envoi"
          aria-label={interneSeulement ? "Publier la note interne" : "Envoyer le message et les pièces jointes"}
          title={transfertsEnCours ? "Téléversement en cours…" : "Envoyer (Entrée)"}
          disabled={!pret}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 12h14m-7-7 7 7-7 7" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {!interneSeulement && panneauOuvert ? (
        <div className="admin-chat-ajout-menu">
          <button type="button" className="admin-chat-ajout-menu__choix"
            onClick={() => selection.current?.click()} disabled={transfertsEnCours}>
            <span aria-hidden="true">📎</span> Depuis mon appareil
          </button>
          {documents.length > 0 ? (
            <fieldset className="admin-chat-ajout-menu__documents">
              <legend>Devis et documents du dossier</legend>
              {documents.map((doc) => (
                <label key={doc.id}>
                  <input type="checkbox" disabled={doc.statut === "brouillon"}
                    checked={documentsChoisis.includes(String(doc.id))}
                    onChange={(e) => choisirDocument(String(doc.id), e.target.checked)} />
                  <span>{doc.numero ?? doc.type} · PDF
                    {doc.statut === "brouillon" ? " (à finaliser avant envoi)" : ""}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
          <small>PDF, JPG, PNG, GIF, DOCX, XLSX, PPTX, TXT, CSV · 8 Mo/fichier · 10 Mo total · 4 pièces max.</small>
          <small>Les pièces sont ajoutées au même e-mail, pas envoyées via un lien public.</small>
        </div>
      ) : null}

      {erreur ? <p className="admin-chat-saisie__erreur" role="alert">{erreur}</p> : null}
      {pending ? <p role="status" className="admin-chat-saisie__aide">Préparation du message et des pièces…</p> : (
        <p className="admin-chat-saisie__aide">
          {bloquee ? "Complète les informations manquantes avant l’envoi."
            : transfertsEnCours ? "Téléversement des pièces jointes…"
              : "Entrée pour envoyer · Maj + Entrée pour revenir à la ligne"}
        </p>
      )}
      {!interneSeulement && !pending ? (
        <div className="admin-chat-saisie__bas">
          <button type="submit" name="interne" value="1"
            className="admin-chat-note"
            disabled={!noteInternePossible}
            title={aDesPieces ? "Retirez les pièces avant de publier une note interne" : undefined}>
            + Note interne
          </button>
          <details className="admin-chat-format">
            <summary>Mise en forme du message</summary>
            <p>Pour le gras : <code>**important**</code> ; l’italique :
              <code> *merci*</code> ; un lien :
              <code> [consulter](https://jokswed.com)</code>.</p>
          </details>
        </div>
      ) : null}
    </div>
  );
}
