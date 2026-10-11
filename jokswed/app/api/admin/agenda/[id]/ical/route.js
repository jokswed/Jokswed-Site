import { accesPage, contexteAdmin } from "@/lib/admin/garde";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function echapperIcs(v) {
  return String(v ?? "").replace(/\\/g,"\\\\").replace(/\r\n|\n|\r/g,"\\n")
    .replace(/,/g,"\\,").replace(/;/g,"\\;");
}
function stamp(v) {
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) throw new Error("date invalide");
  return d.toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/, "Z");
}
export async function GET(_request, { params }) {
  if (process.env.JOKSWED_AGENDA_ENABLED !== "1") return new Response(null,{status:404});
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)) return new Response(null,{status:404});
  const { entreprise } = await contexteAdmin();
  const acces = await accesPage(entreprise.id,["dossier.lire"]);
  const evenement = await acces.executer(async q=>{
    const { rows } = await q("SELECT * FROM app.mon_agenda($1) WHERE id=$2::uuid", [entreprise.id,id]);
    return rows[0];
  });
  if (!evenement) return new Response(null,{status:404});
  const ics = [
    "BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//JoksWed//Agenda Privé//FR",
    "CALSCALE:GREGORIAN","METHOD:PUBLISH","BEGIN:VEVENT",
    `UID:${id}@jokswed.com`, `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(evenement.debut)}`,`DTEND:${stamp(evenement.fin)}`,
    `SUMMARY:${echapperIcs(evenement.titre)}`,
    `LOCATION:${echapperIcs(evenement.lieu)}`,
    "END:VEVENT","END:VCALENDAR",""
  ].join("\r\n");
  return new Response(ics,{
    headers:{"Content-Type":"text/calendar; charset=utf-8",
      "Content-Disposition":`attachment; filename="jokswed-${id.slice(0,8)}.ics"`,
      "Cache-Control":"private, no-store"}
  });
}
