import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Camera, Check, Link2, Loader2, Lock, Mail, Phone, Shield, User, X } from 'lucide-react';
import { Button } from './ui/Button';
import { InstagramIcon, XIcon, LinkedinIcon, FacebookIcon } from './SocialIcons';
import { apiFetch } from '../lib/api';
import { actualizarSesion, type SesionUsuario } from '../lib/session';
import '../styles/config.css';
import {
  type ConfigUsuario,
  CONFIG_VACIO,
  EMAIL_RE,
  esConfigUsuario,
  validarTelefono,
  limpiarInstagram,
  limpiarTwitter,
  limpiarLinkedin,
  limpiarFacebook,
  reglasPassword,
  passwordValida,
  fileAAvatarBase64,
  AVATAR_MAX_BYTES,
  instagramUrl,
  twitterUrl,
  linkedinUrl,
  facebookUrl,
} from '../lib/usuario-config';

type Pestaña = 'datos' | 'redes' | 'privacidad' | 'seguridad';

interface Props {
  user: SesionUsuario | null;
  onUserActualizado: (u: SesionUsuario) => void;
}

const PESTAÑAS: { id: Pestaña; label: string; icono: ReactNode }[] = [
  { id: 'datos', label: 'Datos personales', icono: <User /> },
  { id: 'redes', label: 'Redes y enlaces', icono: <Link2 /> },
  { id: 'privacidad', label: 'Privacidad', icono: <Shield /> },
  { id: 'seguridad', label: 'Seguridad', icono: <Lock /> },
];

export const ConfigPanel = ({ user, onUserActualizado }: Props) => {
  const [pestaña, setPestaña] = useState<Pestaña>('datos');
  const [config, setConfig] = useState<ConfigUsuario>(CONFIG_VACIO);
  const [email, setEmail] = useState('');
  const [emailGuardado, setEmailGuardado] = useState('');
  const [nombre, setNombre] = useState(user?.nombre ?? '');
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [exito, setExito] = useState('');

  const [pwdActual, setPwdActual] = useState('');
  const [pwdNueva, setPwdNueva] = useState('');
  const [pwdConfirm, setPwdConfirm] = useState('');
  const [guardandoPwd, setGuardandoPwd] = useState(false);
  const [errorPwd, setErrorPwd] = useState('');
  const [exitoPwd, setExitoPwd] = useState('');

  const inputArchivoRef = useRef<HTMLInputElement | null>(null);
  const exitoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cargarConfig = async () => {
    setCargando(true);
    setError('');
    try {
      const { ok, data } = await apiFetch('/Apis/ObtenerConfigUsuario', {}, 8000);
      if (ok && esConfigUsuario((data as any)?.config)) {
        setConfig((data as any).config);
        setEmail(String((data as any)?.perfil?.email ?? ''));
        setEmailGuardado(String((data as any)?.perfil?.email ?? ''));
        setNombre(String((data as any)?.perfil?.nombre ?? user?.nombre ?? ''));
      } else {
        setError('No se pudo cargar tu configuración.');
      }
    } catch {
      setError('No se pudo cargar tu configuración.');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarConfig();
    return () => {
      if (exitoTimeoutRef.current) clearTimeout(exitoTimeoutRef.current);
    };
  }, []);

  const mostrarExito = (msg: string) => {
    setExito(msg);
    if (exitoTimeoutRef.current) clearTimeout(exitoTimeoutRef.current);
    exitoTimeoutRef.current = setTimeout(() => setExito(''), 3500);
  };

  const marcar = (m: Partial<ConfigUsuario>) => setConfig((c) => ({ ...c, ...m }));

  const emailValido = EMAIL_RE.test(email.trim());
  const telefonoValido = validarTelefono(config.telefono);
  const puedeGuardar = emailValido && telefonoValido && !guardando;

  const guardarGeneral = async () => {
    setGuardando(true);
    setError('');
    try {
      const body: Record<string, unknown> = { config };
      const emailTrim = email.trim().toLowerCase();
      if (emailTrim && emailTrim !== emailGuardado.toLowerCase()) body.email = emailTrim;
      const { ok, data } = await apiFetch('/Apis/ActualizarConfigUsuario', {
        method: 'POST',
        body: JSON.stringify(body),
      }, 10000);
      if (!ok) {
        setError((data as any)?.error || 'No se pudo guardar la configuración.');
        return;
      }
      if (esConfigUsuario((data as any)?.config)) {
        setConfig((data as any).config);
        if ((data as any)?.perfil?.email) {
          setEmail((data as any).perfil.email);
          setEmailGuardado((data as any).perfil.email);
        }
        const u = actualizarSesion({ avatar: (data as any).config.avatar, moneda: (data as any).config.moneda });
        if (u) onUserActualizado(u);
      }
      mostrarExito('Cambios guardados.');
    } catch {
      setError('No se pudo guardar. Intentá de nuevo.');
    } finally {
      setGuardando(false);
    }
  };

  const seleccionarArchivo = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      const base64 = await fileAAvatarBase64(file);
      if (base64.length > AVATAR_MAX_BYTES) {
        setError('La imagen es demasiado grande. Probá con otra más liviana.');
        return;
      }
      marcar({ avatar: base64 });
    } catch (e) {
      setError((e as Error).message || 'No se pudo procesar la imagen.');
    }
  };

  const reglas = reglasPassword(pwdNueva);
  const confirmaBien = pwdConfirm.length > 0 && pwdNueva === pwdConfirm;
  const confirmaMal = pwdConfirm.length > 0 && pwdNueva !== pwdConfirm;
  const puedeCambiarPwd = passwordValida(pwdNueva) && confirmaBien && pwdActual.length > 0;

  const cambiarPassword = async () => {
    setGuardandoPwd(true);
    setErrorPwd('');
    setExitoPwd('');
    try {
      const { ok, data } = await apiFetch('/Apis/ActualizarConfigUsuario', {
        method: 'POST',
        body: JSON.stringify({
          passwordActual: pwdActual,
          passwordNueva: pwdNueva,
          passwordConfirm: pwdConfirm,
        }),
      }, 10000);
      if (!ok) {
        setErrorPwd((data as any)?.error || 'No se pudo cambiar la contraseña.');
        return;
      }
      setPwdActual('');
      setPwdNueva('');
      setPwdConfirm('');
      setExitoPwd('Contraseña actualizada.');
    } catch {
      setErrorPwd('No se pudo cambiar la contraseña. Intentá de nuevo.');
    } finally {
      setGuardandoPwd(false);
    }
  };

  if (cargando) {
    return (
      <div className="configuracion__spinner" role="status" aria-label="Cargando configuración">
        <Loader2 />
      </div>
    );
  }

  return (
    <div className="configuracion">
      <div className="configuracion__cabecera">
        <h1 className="configuracion__titulo">Configuración</h1>
        {exito && (
          <span className="configuracion__exito">
            <Check /> {exito}
          </span>
        )}
      </div>

      {error && (
        <div className="configuracion__error" role="alert">
          {error}
        </div>
      )}

      <nav className="configuracion__pestañas" aria-label="Secciones de configuración">
        {PESTAÑAS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPestaña(p.id)}
            className={`configuracion__pestaña${pestaña === p.id ? ' configuracion__pestaña--activa' : ''}`}
          >
            {p.icono}
            {p.label}
          </button>
        ))}
      </nav>

      {pestaña === 'datos' && (
        <section className="configuracion__tarjeta">
          <div className="configuracion__perfil-fila">
            <div className="configuracion__avatar-zona">
              <div className="configuracion__avatar-contenedor">
                {config.avatar ? (
                  <img
                    src={config.avatar}
                    alt="Foto de perfil"
                    className="configuracion__avatar"
                  />
                ) : (
                  <div className="configuracion__avatar-iniciales">
                    {(nombre || user?.nombre || 'U').trim().charAt(0).toUpperCase()}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => inputArchivoRef.current?.click()}
                  className="configuracion__avatar-boton"
                  aria-label="Subir foto de perfil"
                  title="Subir foto"
                >
                  <Camera />
                </button>
              </div>
              <input
                ref={inputArchivoRef}
                type="file"
                accept="image/*"
                className="configuracion__entrada-archivo"
                onChange={(e) => {
                  seleccionarArchivo(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </div>

            <div className="configuracion__campos">
              <div className="configuracion__campo">
                <label className="configuracion__etiqueta" htmlFor="config-nombre">Nombre</label>
                <input
                  id="config-nombre"
                  type="text"
                  value={nombre}
                  disabled
                  className="configuracion__entrada"
                />
              </div>

              <div className="configuracion__campo">
                <label className="configuracion__etiqueta" htmlFor="config-email">Correo electrónico</label>
                <div className="configuracion__campo-icono">
                  <Mail className="configuracion__icono" />
                  <input
                    id="config-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="usuario@gmail.com"
                    className={`configuracion__entrada configuracion__entrada--icono${
                      email && !emailValido ? ' configuracion__entrada--invalida' : ''
                    }`}
                  />
                </div>
                {email && !emailValido && (
                  <p className="configuracion__ayuda-error">Ingresá un email válido.</p>
                )}
              </div>

              <div className="configuracion__campo">
                <label className="configuracion__etiqueta" htmlFor="config-telefono">Teléfono</label>
                <div className="configuracion__campo-icono">
                  <Phone className="configuracion__icono" />
                  <input
                    id="config-telefono"
                    type="tel"
                    value={config.telefono}
                    onChange={(e) => marcar({ telefono: e.target.value })}
                    placeholder="+54 9 11 2345-6789"
                    className={`configuracion__entrada configuracion__entrada--icono${
                      config.telefono && !telefonoValido ? ' configuracion__entrada--invalida' : ''
                    }`}
                  />
                </div>
                {config.telefono && !telefonoValido && (
                  <p className="configuracion__ayuda-error">
                    Usá solo números, espacios y + ( ) -
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="configuracion__tarjeta-pie">
            <Button type="button" onClick={guardarGeneral} disabled={!puedeGuardar} isLoading={guardando}>
              Guardar cambios
            </Button>
          </div>
        </section>
      )}

      {pestaña === 'redes' && (
        <section className="configuracion__tarjeta">
          <div className="configuracion__lista-campos">
            <div className="configuracion__campo">
              <label className="configuracion__etiqueta" htmlFor="config-instagram">Instagram</label>
              <div className="configuracion__fila-red">
                <div className="configuracion__campo-icono">
                  <InstagramIcon className="configuracion__icono" />
                  <input
                    id="config-instagram"
                    type="text"
                    value={config.instagram}
                    onChange={(e) => marcar({ instagram: e.target.value })}
                    placeholder="@usuario o instagram.com/usuario"
                    className="configuracion__entrada configuracion__entrada--icono"
                  />
                </div>
                {limpiarInstagram(config.instagram) && (
                  <a
                    href={instagramUrl(limpiarInstagram(config.instagram))}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="configuracion__enlace-red"
                  >
                    Ver perfil
                  </a>
                )}
              </div>
            </div>

            <div className="configuracion__campo">
              <label className="configuracion__etiqueta" htmlFor="config-twitter">X (Twitter)</label>
              <div className="configuracion__fila-red">
                <div className="configuracion__campo-icono">
                  <XIcon className="configuracion__icono" />
                  <input
                    id="config-twitter"
                    type="text"
                    value={config.twitter}
                    onChange={(e) => marcar({ twitter: e.target.value })}
                    placeholder="@usuario o x.com/usuario"
                    className="configuracion__entrada configuracion__entrada--icono"
                  />
                </div>
                {limpiarTwitter(config.twitter) && (
                  <a
                    href={twitterUrl(limpiarTwitter(config.twitter))}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="configuracion__enlace-red"
                  >
                    Ver perfil
                  </a>
                )}
              </div>
            </div>

            <div className="configuracion__campo">
              <label className="configuracion__etiqueta" htmlFor="config-linkedin">LinkedIn</label>
              <div className="configuracion__fila-red">
                <div className="configuracion__campo-icono">
                  <LinkedinIcon className="configuracion__icono" />
                  <input
                    id="config-linkedin"
                    type="text"
                    value={config.linkedin}
                    onChange={(e) => marcar({ linkedin: e.target.value })}
                    placeholder="usuario o linkedin.com/in/usuario"
                    className="configuracion__entrada configuracion__entrada--icono"
                  />
                </div>
                {limpiarLinkedin(config.linkedin) && (
                  <a
                    href={linkedinUrl(limpiarLinkedin(config.linkedin))}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="configuracion__enlace-red"
                  >
                    Ver perfil
                  </a>
                )}
              </div>
            </div>

            <div className="configuracion__campo">
              <label className="configuracion__etiqueta" htmlFor="config-facebook">Facebook</label>
              <div className="configuracion__fila-red">
                <div className="configuracion__campo-icono">
                  <FacebookIcon className="configuracion__icono" />
                  <input
                    id="config-facebook"
                    type="text"
                    value={config.facebook}
                    onChange={(e) => marcar({ facebook: e.target.value })}
                    placeholder="usuario o facebook.com/usuario"
                    className="configuracion__entrada configuracion__entrada--icono"
                  />
                </div>
                {limpiarFacebook(config.facebook) && (
                  <a
                    href={facebookUrl(limpiarFacebook(config.facebook))}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="configuracion__enlace-red"
                  >
                    Ver perfil
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="configuracion__tarjeta-pie">
            <Button type="button" onClick={guardarGeneral} disabled={!puedeGuardar} isLoading={guardando}>
              Guardar cambios
            </Button>
          </div>
        </section>
      )}

      {pestaña === 'privacidad' && (
        <section className="configuracion__tarjeta">
          <div className="configuracion__lista-campos">
            {([
              { key: 'perfil_publico', label: 'Visibilidad del perfil', descripcion: 'Otros usuarios pueden ver tu perfil.' },
              { key: 'mostrar_contacto', label: 'Datos de contacto', descripcion: 'Mostrar tu email y teléfono en el perfil público.' },
            ] as const).map(({ key, label, descripcion }) => (
              <div key={key} className="configuracion__interruptor-fila">
                <div>
                  <p className="configuracion__interruptor-titulo">{label}</p>
                  <p className="configuracion__interruptor-descripcion">{descripcion}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={config[key]}
                  aria-label={label}
                  onClick={() => marcar({ [key]: !config[key] } as Partial<ConfigUsuario>)}
                  className={`configuracion__interruptor${config[key] ? ' configuracion__interruptor--activo' : ''}`}
                >
                  <span className="configuracion__interruptor-amanecer" />
                </button>
              </div>
            ))}
          </div>

          <div className="configuracion__tarjeta-pie">
            <Button type="button" onClick={guardarGeneral} disabled={!puedeGuardar} isLoading={guardando}>
              Guardar cambios
            </Button>
          </div>
        </section>
      )}

      {pestaña === 'seguridad' && (
        <section className="configuracion__tarjeta">
          <div className="configuracion__lista-campos">
            <div className="configuracion__campo">
              <label className="configuracion__etiqueta" htmlFor="config-pwd-actual">Contraseña actual</label>
              <input
                id="config-pwd-actual"
                type="password"
                value={pwdActual}
                onChange={(e) => setPwdActual(e.target.value)}
                autoComplete="current-password"
                className="configuracion__entrada"
              />
            </div>

            <div className="configuracion__campo">
              <label className="configuracion__etiqueta" htmlFor="config-pwd-nueva">Nueva contraseña</label>
              <input
                id="config-pwd-nueva"
                type="password"
                value={pwdNueva}
                onChange={(e) => setPwdNueva(e.target.value)}
                autoComplete="new-password"
                className="configuracion__entrada"
              />
              {pwdNueva.length > 0 && (
                <ul className="configuracion__reglas">
                  {([
                    ['Mínimo 8 caracteres', reglas.minLargo],
                    ['Una mayúscula', reglas.mayuscula],
                    ['Un número', reglas.numero],
                    ['Un carácter especial', reglas.especial],
                  ] as const).map(([label, cumplida]) => (
                    <li
                      key={label}
                      className={`configuracion__regla${cumplida ? ' configuracion__regla--cumplida' : ''}`}
                    >
                      {cumplida ? <Check /> : <X />}
                      {label}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="configuracion__campo">
              <label className="configuracion__etiqueta" htmlFor="config-pwd-confirm">Confirmar contraseña</label>
              <input
                id="config-pwd-confirm"
                type="password"
                value={pwdConfirm}
                onChange={(e) => setPwdConfirm(e.target.value)}
                autoComplete="new-password"
                className={`configuracion__entrada${
                  confirmaMal
                    ? ' configuracion__entrada--invalida'
                    : confirmaBien
                      ? ' configuracion__entrada--valida'
                      : ''
                }`}
              />
              {confirmaMal && (
                <p className="configuracion__ayuda-error">Las contraseñas no coinciden.</p>
              )}
            </div>

            {errorPwd && <p className="configuracion__mensaje-error">{errorPwd}</p>}
            {exitoPwd && (
              <p className="configuracion__exito">
                <Check /> {exitoPwd}
              </p>
            )}
          </div>

          <div className="configuracion__tarjeta-pie">
            <Button type="button" onClick={cambiarPassword} disabled={!puedeCambiarPwd} isLoading={guardandoPwd}>
              Cambiar contraseña
            </Button>
          </div>
        </section>
      )}

      <section className="configuracion__tarjeta">
        <div className="configuracion__moneda-fila">
          <div>
            <p className="configuracion__moneda-titulo">Moneda predeterminada</p>
            <p className="configuracion__moneda-descripcion">
              Convierte los valores del dashboard entre USD y ARS.
            </p>
          </div>
          <div className="configuracion__selector-moneda" role="radiogroup" aria-label="Moneda predeterminada">
            {(['USD', 'ARS'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={config.moneda === m}
                onClick={() => {
                  marcar({ moneda: m });
                  const u = actualizarSesion({ moneda: m });
                  if (u) onUserActualizado(u);
                }}
                className={`configuracion__opcion-moneda${config.moneda === m ? ' configuracion__opcion-moneda--activa' : ''}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="configuracion__tarjeta">
        <p className="configuracion__vista-previa-titulo">Así te ve un visitante</p>
        <div className="configuracion__vista-previa">
          {config.avatar ? (
            <img src={config.avatar} alt="Foto de perfil" className="configuracion__vista-previa-avatar" />
          ) : (
            <div className="configuracion__avatar-iniciales">
              {(nombre || 'U').trim().charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <p className="configuracion__vista-previa-nombre">{nombre || user?.nombre}</p>
            {config.mostrar_contacto && (
              <div>
                {email && <p className="configuracion__vista-previa-contacto">{email}</p>}
                {config.telefono && <p className="configuracion__vista-previa-contacto">{config.telefono}</p>}
              </div>
            )}
            <div className="configuracion__vista-previa-redes">
              {limpiarInstagram(config.instagram) && (
                <a
                  href={instagramUrl(limpiarInstagram(config.instagram))}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="configuracion__boton-red configuracion__boton-red--instagram"
                  aria-label="Instagram"
                  title="Instagram"
                >
                  <InstagramIcon className="configuracion__boton-red-icono" />
                </a>
              )}
              {limpiarTwitter(config.twitter) && (
                <a
                  href={twitterUrl(limpiarTwitter(config.twitter))}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="configuracion__boton-red configuracion__boton-red--x"
                  aria-label="X (Twitter)"
                  title="X (Twitter)"
                >
                  <XIcon className="configuracion__boton-red-icono" />
                </a>
              )}
              {limpiarLinkedin(config.linkedin) && (
                <a
                  href={linkedinUrl(limpiarLinkedin(config.linkedin))}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="configuracion__boton-red configuracion__boton-red--linkedin"
                  aria-label="LinkedIn"
                  title="LinkedIn"
                >
                  <LinkedinIcon className="configuracion__boton-red-icono" />
                </a>
              )}
              {limpiarFacebook(config.facebook) && (
                <a
                  href={facebookUrl(limpiarFacebook(config.facebook))}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="configuracion__boton-red configuracion__boton-red--facebook"
                  aria-label="Facebook"
                  title="Facebook"
                >
                  <FacebookIcon className="configuracion__boton-red-icono" />
                </a>
              )}
              {!config.perfil_publico && (
                <span className="configuracion__perfil-privado">Perfil privado</span>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
