import { useEffect, useRef, useState } from 'react';
import { Heart, Loader2, Search, ShieldOff } from 'lucide-react';
import { InstagramIcon, XIcon, LinkedinIcon, FacebookIcon } from './SocialIcons';
import { apiFetch } from '../lib/api';
import '../styles/comunidad.css';

interface ResultadoUsuario {
  id: string;
  nombre: string;
  avatar: string;
  instagram: string;
  twitter: string;
  linkedin: string;
  facebook: string;
  perfil_publico: boolean;
  mostrar_contacto: boolean;
  liked_por_mi: boolean;
}

const getIniciales = (nombre: string) =>
  nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

const normalizarInstagram = (v: string) => v.trim().replace(/^@/, '');
const normalizarTwitter = (v: string) => v.trim().replace(/^@/, '');
const normalizarLinkedin = (v: string) => v.trim().replace(/^@/, '');
const normalizarFacebook = (v: string) => v.trim().replace(/^@/, '');

export const BuscarUsuarios = () => {
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState<ResultadoUsuario[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState('');
  const [buscoAlgo, setBuscoAlgo] = useState(false);
  const [likesDados, setLikesDados] = useState<Set<string>>(new Set());
  const [likeEnCurso, setLikeEnCurso] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  const alternarLike = async (id: string) => {
    setLikeEnCurso(id);
    try {
      const { ok, data } = await apiFetch('/Apis/DarLikeUsuario', {
        method: 'POST',
        body: JSON.stringify({ id_receptor: id }),
      }, 8000);
      if (ok && (data as any)?.success) {
        setLikesDados((prev) => {
          const nuevo = new Set(prev);
          if ((data as any).liked) nuevo.add(id);
          else nuevo.delete(id);
          return nuevo;
        });
      }
    } catch {
      setError('No se pudo procesar el like.');
    } finally {
      setLikeEnCurso(null);
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResultados([]);
      setBuscando(false);
      setError('');
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    setBuscando(true);
    setError('');

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      const seq = ++seqRef.current;
      try {
        const { ok, data } = await apiFetch(
          `/Apis/BuscarUsuarios?q=${encodeURIComponent(q)}`,
          {},
          8000
        );
        if (seq !== seqRef.current) return;
        if (ok && (data as any)?.success) {
          setResultados((data as any).resultados || []);
          setLikesDados(
            new Set(
              ((data as any).resultados || [])
                .filter((r: ResultadoUsuario) => r.liked_por_mi)
                .map((r: ResultadoUsuario) => r.id)
            )
          );
        } else {
          setError((data as any)?.error || 'No se pudo completar la búsqueda.');
        }
      } catch {
        if (seq === seqRef.current) setError('No se pudo completar la búsqueda.');
      } finally {
        if (seq === seqRef.current) setBuscando(false);
      }
    }, 350);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query]);

  return (
    <div className="comunidad">
      <h1 className="comunidad__titulo">Comunidad</h1>
      <p className="comunidad__descripcion">
        Buscá otros usuarios por su nombre y visitá sus perfiles.
      </p>

      <div className="comunidad__buscador">
        <Search className="comunidad__buscador-icono" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar usuarios por nombre..."
          className="comunidad__buscador-entrada"
          aria-label="Buscar usuarios"
        />
        {buscando && <Loader2 className="comunidad__buscador-spinner" />}
      </div>

      {error && (
        <p className="comunidad__estado comunidad__estado--error" role="alert">
          {error}
        </p>
      )}

      {!error && query.trim().length < 2 && (
        <p className="comunidad__estado">Escribí al menos 2 letras para buscar.</p>
      )}

      {!error && query.trim().length >= 2 && !buscando && resultados.length === 0 && (
        <p className="comunidad__estado">No encontramos usuarios con ese nombre.</p>
      )}

      {resultados.length > 0 && (
        <div className="comunidad__resultados">
          {resultados.map((u) => (
            <div key={u.id} className="comunidad__tarjeta">
              {u.avatar ? (
                <img src={u.avatar} alt="" className="comunidad__avatar" />
              ) : (
                <div className="comunidad__avatar-iniciales">{getIniciales(u.nombre)}</div>
              )}
              <div className="comunidad__info">
                <p className="comunidad__nombre">{u.nombre}</p>
                <div className="comunidad__meta">
                  {u.perfil_publico ? (
                    (u.instagram || u.twitter || u.linkedin || u.facebook) && (
                      <div className="comunidad__acciones">
                        {u.instagram && (
                          <a
                            href={`https://instagram.com/${normalizarInstagram(u.instagram)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="comunidad__boton-red comunidad__boton-red--instagram"
                            aria-label={`Instagram de ${u.nombre}`}
                            title="Instagram"
                          >
                            <InstagramIcon className="comunidad__boton-red-icono" />
                          </a>
                        )}
                        {u.twitter && (
                          <a
                            href={`https://x.com/${normalizarTwitter(u.twitter)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="comunidad__boton-red comunidad__boton-red--x"
                            aria-label={`X de ${u.nombre}`}
                            title="X (Twitter)"
                          >
                            <XIcon className="comunidad__boton-red-icono" />
                          </a>
                        )}
                        {u.linkedin && (
                          <a
                            href={`https://linkedin.com/in/${normalizarLinkedin(u.linkedin)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="comunidad__boton-red comunidad__boton-red--linkedin"
                            aria-label={`LinkedIn de ${u.nombre}`}
                            title="LinkedIn"
                          >
                            <LinkedinIcon className="comunidad__boton-red-icono" />
                          </a>
                        )}
                        {u.facebook && (
                          <a
                            href={`https://facebook.com/${normalizarFacebook(u.facebook)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="comunidad__boton-red comunidad__boton-red--facebook"
                            aria-label={`Facebook de ${u.nombre}`}
                            title="Facebook"
                          >
                            <FacebookIcon className="comunidad__boton-red-icono" />
                          </a>
                        )}
                      </div>
                    )
                  ) : (
                    <>
                      <ShieldOff className="comunidad__meta-icono" />
                      <span className="comunidad__meta-texto comunidad__meta-texto--privado">
                        Perfil privado
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="comunidad__acciones">
                <button
                  type="button"
                  onClick={() => alternarLike(u.id)}
                  disabled={likeEnCurso === u.id}
                  className={`comunidad__boton-like${likesDados.has(u.id) ? ' comunidad__boton-like--activo' : ''}`}
                  aria-label={likesDados.has(u.id) ? `Quitar like a ${u.nombre}` : `Agregar a ${u.nombre} como amigo`}
                  aria-pressed={likesDados.has(u.id)}
                  title={likesDados.has(u.id) ? 'Quitar like' : 'Agregar amigo'}
                >
                  {likeEnCurso === u.id ? (
                    <Loader2 className="comunidad__boton-like-icono" />
                  ) : (
                    <Heart className="comunidad__boton-like-icono" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
