import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  AccesRefuse, exigerAcces, exigerSession, mesEntreprises,
} from "@/lib/auth/acces";

export const runtime = "nodejs";

async function contexte() {
  const session = await exigerSession();
  const entreprises = await mesEntreprises(session);
  const choix = (await cookies()).get("jokswed_entreprise")?.value;
  const entreprise = entreprises.find((e) => e.id === choix) ?? entreprises[0];
  if (!entreprise) throw new AccesRefuse("aucune entreprise");
  const acces = await exigerAcces(entreprise.id, ["dossier.lire"]);
  return { session, acces };
}

function nettoyer(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export async function POST(request) {
  try {
    const { session, acces } = await contexte();
    const body = await request.json();
    const endpoint = nettoyer(body.endpoint, 4096);
    const p256dh = nettoyer(body.p256dh, 1024);
    const auth = nettoyer(body.auth, 1024);

    if (!endpoint.startsWith("https://") || !p256dh || !auth) {
      return NextResponse.json({ ok: false }, { status: 422 });
    }

    await acces.executer((q) => q(
      `INSERT INTO push_abonnements
         (utilisateur_id, endpoint, p256dh, auth, navigateur)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (endpoint) DO UPDATE
         SET p256dh = EXCLUDED.p256dh,
             auth = EXCLUDED.auth,
             navigateur = EXCLUDED.navigateur,
             maj_le = now()
       WHERE push_abonnements.utilisateur_id = EXCLUDED.utilisateur_id`,
      [session.utilisateurId, endpoint, p256dh, auth,
       nettoyer(request.headers.get("user-agent"), 500) || null],
    ));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AccesRefuse) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    console.error(`[push/abonnement] POST ${e instanceof Error ? e.name : "erreur"}`);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { session, acces } = await contexte();
    const body = await request.json();
    const endpoint = nettoyer(body.endpoint, 4096);
    if (!endpoint) return NextResponse.json({ ok: false }, { status: 422 });

    await acces.executer((q) => q(
      "DELETE FROM push_abonnements WHERE utilisateur_id = $1 AND endpoint = $2",
      [session.utilisateurId, endpoint],
    ));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AccesRefuse) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    console.error(`[push/abonnement] DELETE ${e instanceof Error ? e.name : "erreur"}`);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
