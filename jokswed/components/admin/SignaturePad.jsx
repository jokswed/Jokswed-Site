"use client";
import { useRef, useState } from "react";

/** Points normalisés : aucune image HTML/SVG arbitraire n'est acceptée. */
export default function SignaturePad({ action }) {
  const canvas = useRef(null);
  const dessin = useRef([]);
  const trace = useRef(null);
  const [present, setPresent] = useState(false);

  const lieu = (event) => {
    const rect = canvas.current.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))];
  };
  const rafraichir = () => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const cv = canvas.current;
    ctx.clearRect(0,0,cv.width,cv.height);
    ctx.strokeStyle = "#141312";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const points of dessin.current) {
      if (!points.length) continue;
      ctx.beginPath();
      ctx.moveTo(points[0][0]*cv.width, points[0][1]*cv.height);
      for (const p of points.slice(1)) ctx.lineTo(p[0]*cv.width,p[1]*cv.height);
      ctx.stroke();
    }
    if (trace.current) trace.current.value = JSON.stringify(dessin.current);
    setPresent(dessin.current.length>0);
  };
  function start(e) {
    e.preventDefault();
    if (dessin.current.length>=30) return;
    canvas.current.setPointerCapture(e.pointerId);
    dessin.current.push([lieu(e)]);
    rafraichir();
  }
  function move(e) {
    if (!canvas.current?.hasPointerCapture(e.pointerId)) return;
    const points=dessin.current.at(-1);
    if (points && points.length<100) points.push(lieu(e));
    rafraichir();
  }
  function end(e) {
    if (canvas.current?.hasPointerCapture(e.pointerId)) {
      canvas.current.releasePointerCapture(e.pointerId);
    }
    rafraichir();
  }
  function clear() {
    dessin.current=[];
    rafraichir();
  }

  return <form action={action} className="formulaire" style={{marginTop:"1rem"}}>
    <label className="label label--nu" htmlFor="signature-pad">Dessiner avec le trackpad,
      la souris, le doigt ou un stylet tactile</label>
    <canvas id="signature-pad" ref={canvas} width={560} height={170}
      aria-label="Zone de dessin de votre signature"
      style={{width:"100%",height:"auto",touchAction:"none",background:"white",
        border:"1px solid #e8e5df",cursor:"crosshair",display:"block"}}
      onPointerDown={start} onPointerMove={move}
      onPointerUp={end} onPointerCancel={end}/>
    <input ref={trace} type="hidden" name="trace" />
    <p className="recap__note">Votre signature est chiffrée dans la base SQL pour cette entreprise.
      Elle ne sera jamais apposée automatiquement : vous devrez la confirmer sur chaque document.</p>
    <div className="admin-ligne-actions" style={{marginTop:"0.9rem"}}>
      <button type="button" onClick={clear} className="btn btn--fantome">Effacer / recommencer</button>
      <button type="submit" className="btn" disabled={!present}>Enregistrer ma signature</button>
    </div>
  </form>;
}
