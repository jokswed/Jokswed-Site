import { NextResponse } from "next/server";

export const runtime = "nodejs";

function nettoyer(valeur, longueurMax = 2000) {
  return String(valeur ?? "").trim().slice(0, longueurMax);
}

function echapperHtml(valeur) {
  return nettoyer(valeur)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function emailValide(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request) {
  try {
    const body = await request.json();

    // Champ invisible anti-spam : un vrai visiteur le laisse vide.
    if (nettoyer(body.website, 200)) {
      return NextResponse.json({ ok: true });
    }

    const noms = nettoyer(body.noms, 120);
    const email = nettoyer(body.email, 254).toLowerCase();
    const date = nettoyer(body.date, 120) || "À définir";
    const lieu = nettoyer(body.lieu, 200) || "À définir";
    const message = nettoyer(body.message, 5000);

    if (!noms || !emailValide(email) || !message) {
      return NextResponse.json(
        { ok: false, message: "Merci de vérifier les champs obligatoires." },
        { status: 400 }
      );
    }

    const apiKey = process.env.RESEND_API_KEY;
    const destinataire = process.env.CONTACT_TO_EMAIL || "jokswed@gmail.com";
    const expediteur =
      process.env.CONTACT_FROM_EMAIL || "JoksWed <onboarding@resend.dev>";

    if (!apiKey) {
      console.error("RESEND_API_KEY est absente des variables d’environnement.");
      return NextResponse.json(
        { ok: false, message: "Le service d’envoi n’est pas encore configuré." },
        { status: 500 }
      );
    }

    const sujet = `Nouvelle demande mariage — ${noms}`;
    const texte = [
      "Nouvelle demande reçue depuis le site JoksWed",
      "",
      `Prénoms : ${noms}`,
      `E-mail : ${email}`,
      `Date du mariage : ${date}`,
      `Lieu : ${lieu}`,
      "",
      "Message :",
      message,
    ].join("\n");

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#171717;max-width:640px">
        <h2 style="margin-bottom:20px">Nouvelle demande mariage</h2>
        <p><strong>Prénoms :</strong> ${echapperHtml(noms)}</p>
        <p><strong>E-mail :</strong> <a href="mailto:${echapperHtml(email)}">${echapperHtml(email)}</a></p>
        <p><strong>Date du mariage :</strong> ${echapperHtml(date)}</p>
        <p><strong>Lieu :</strong> ${echapperHtml(lieu)}</p>
        <hr style="border:0;border-top:1px solid #ddd;margin:24px 0" />
        <p><strong>Message :</strong></p>
        <p style="white-space:pre-wrap">${echapperHtml(message)}</p>
      </div>
    `;

    const reponseResend = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: expediteur,
        to: [destinataire],
        reply_to: email,
        subject: sujet,
        text: texte,
        html,
      }),
    });

    const resultat = await reponseResend.json().catch(() => ({}));

    if (!reponseResend.ok) {
      console.error("Erreur Resend :", resultat);
      return NextResponse.json(
        { ok: false, message: "L’envoi a échoué. Merci de réessayer." },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, id: resultat.id });
  } catch (erreur) {
    console.error("Erreur du formulaire de contact :", erreur);
    return NextResponse.json(
      { ok: false, message: "Une erreur inattendue est survenue." },
      { status: 500 }
    );
  }
}
