import { NextResponse } from "next/server";
import { deconnecter, NOM_COOKIE, optionsCookie } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  await deconnecter();
  /* Location relatif : voir le commentaire de la route de connexion. */
  const reponse = new NextResponse(null, {
    status: 303, headers: { Location: "/admin/connexion" },
  });
  reponse.cookies.set(NOM_COOKIE, "", optionsCookie(0));
  return reponse;
}
