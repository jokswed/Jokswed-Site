import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  AccesRefuse, exigerAcces, exigerSession, mesEntreprises,
} from "@/lib/auth/acces";
import { envoyerPushTestPersonnel } from "@/lib/push/envoyer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Déclenche un Web Push authentique vers un SEUL abonnement appartenant
 * à l'utilisateur connecté, afin de vérifier les réglages iOS. Aucun
 * destinataire arbitraire, aucun e-mail, aucune donnée client dans le test. */
export async function POST(request) {
  const origine = request.headers.get("origin");
  if (origine) {
    try {
      if (new URL(origine).origin !== new URL(request.url).origin) {
        return NextResponse.json({ ok: false }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ ok: false }, { status: 403 });
    }
  }

  try {
    const body = await request.json();
    const endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim() : "";
    if (!endpoint.startsWith("https://") || endpoint.length > 4096) {
      return NextResponse.json({ ok: false, message: "Abonnement invalide" },
        { status: 422 });
    }

    const session = await exigerSession();
    const entreprises = await mesEntreprises(session);
    const choix = (await cookies()).get("jokswed_entreprise")?.value;
    const entreprise = entreprises.find((e) => e.id === choix) ?? entreprises[0];
    if (!entreprise) throw new AccesRefuse("aucune entreprise");
    const acces = await exigerAcces(entreprise.id, ["dossier.lire"]);

    const resultat = await acces.executer((q) => envoyerPushTestPersonnel(q, endpoint));
    if (resultat.inhibe) {
      return NextResponse.json(
        { ok: false, message: "Configuration VAPID indisponible" },
        { status: 503 });
    }
    if (resultat.envoyes !== 1) {
      return NextResponse.json(
        { ok: false, message: "Envoi échoué ou appareil non enregistré" },
        { status: 422 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AccesRefuse) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    console.error(`[push/test] ${e instanceof Error ? e.name : "erreur"}`);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
