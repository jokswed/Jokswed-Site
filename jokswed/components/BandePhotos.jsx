/* =============================================================================
   <BandePhotos> — ruban photographique pleine largeur
   -----------------------------------------------------------------------------
   ⚠️ COMPOSANT SERVEUR, SANS UNE LIGNE DE JAVASCRIPT CÔTÉ CLIENT.

   L'animation est entièrement en CSS (voir `.bande` dans globals.css). Aucun
   `useEffect`, aucun écouteur de défilement, aucun recalcul par image. La
   conséquence concrète : la bande défile déjà pendant le chargement du
   JavaScript, et elle continuerait de défiler même si celui-ci échouait.

   ⚠️ LA LISTE EST DUPLIQUÉE EXACTEMENT UNE FOIS.

   C'est la condition du raccord invisible : la piste fait deux fois la largeur
   de la série, et l'animation la translate de -50 %, donc d'un nombre entier
   de photos. Le retour au début tombe pile sur une image identique.
   Trois copies, ou une translation en pixels, casseraient le raccord.

   ⚠️ LES DOUBLONS NE SONT PAS TÉLÉCHARGÉS DEUX FOIS.

   La seconde copie pointe sur les mêmes URL optimisées : le navigateur sert
   son cache. Elle est `aria-hidden`, pour qu'un lecteur d'écran n'annonce pas
   douze photographies en double.
   ============================================================================= */

import Image from "next/image";

/**
 * @param {object} props
 * @param {{src:string, alt:string, cadrage?:string}[]} props.photos
 * @param {number} [props.secondes]  Durée d'un cycle complet. Plus c'est long,
 *                                   plus le mouvement est lent et posé.
 */
export default function BandePhotos({ photos, secondes = 70 }) {
  if (!photos?.length) return null;

  /* Deux copies, et deux seulement. */
  const piste = [...photos, ...photos];

  return (
    <section
      className="bande"
      style={{ "--bande-duree": `${secondes}s` }}
      aria-label="Sélection de photographies de mariage"
    >
      <div className="bande__piste">
        {piste.map((photo, index) => {
          const estCopie = index >= photos.length;
          return (
            <div
              key={`${photo.src}-${index}`}
              className="bande__photo"
              /* Le recadrage se règle photo par photo : « 50% 30% » remonte le
                 cadre vers les visages quand le sujet n'est pas centré. */
              style={photo.cadrage ? { "--cadrage": photo.cadrage } : undefined}
              aria-hidden={estCopie ? "true" : undefined}
            >
              <Image
                src={photo.src}
                alt={estCopie ? "" : photo.alt}
                width={500}
                height={500}
                /* La taille demandée suit exactement le carré rendu par la CSS :
                   on ne télécharge pas un 2400 px pour l'afficher en 250. */
                sizes="(max-width: 500px) 150px, (max-width: 900px) 30vw, 250px"
                /* Les deux premières sont au-dessus de la ligne de flottaison :
                   elles portent le LCP et ne doivent pas attendre. Les autres
                   arrivent à mesure qu'elles entrent dans le cadre. */
                priority={index < 2}
                loading={index < 2 ? undefined : "lazy"}
                draggable={false}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
