import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Globe, Loader2, Mail, Phone, Settings, Trash2, X } from 'lucide-react';
import { Button } from './ui/Button';
import { InstagramIcon, XIcon, LinkedinIcon, FacebookIcon } from './SocialIcons';
import { apiFetch } from '../lib/api';
import { actualizarSesion, cerrarSesion, type SesionUsuario } from '../lib/session';
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
  normalizarSitioWeb,
  esSitioWebValido,
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
type CanalVerificacion = 'email' | 'telefono';

interface Props {
  user: SesionUsuario | null;
  onUserActualizado: (u: SesionUsuario) => void;
}

const PESTAÑAS: { id: Pestaña; label: string }[] = [
  { id: 'datos', label: 'Datos personales' },
  { id: 'redes', label: 'Redes y Enlaces' },
  { id: 'privacidad', label: 'Privacidad' },
  { id: 'seguridad', label: 'Seguridad' },
];

const SegmentadoVisibilidad = ({
  etiqueta,
  publico,
  onCambiar,
  deshabilitado,
}: {
  etiqueta: string;
  publico: boolean;
  onCambiar: (publico: boolean) => void;
  deshabilitado?: boolean;
}) => (
  <div className={`segmentado${deshabilitado ? ' segmentado--deshabilitado' : ''}`} role="group" aria-label={etiqueta}>
    <button
      type="button"
      disabled={deshabilitado}
      aria-pressed={publico}
      className={`segmentado__opcion${publico ? ' segmentado__opcion--activo' : ''}`}
      onClick={() => onCambiar(true)}
    >
      Público
    </button>
    <button
      type="button"
      disabled={deshabilitado}
      aria-pressed={!publico}
      className={`segmentado__opcion${!publico ? ' segmentado__opcion--activo' : ''}`}
      onClick={() => onCambiar(false)}
    >
      Privado
    </button>
  </div>
);

const formatoReloj = (segundos: number) => `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`;

export const ConfigPanel = ({ user, onUserActualizado }: Props) => {
  const [pestaña, setPestaña] = useState<Pestaña>('datos');
  const [config, setConfig] = useState<ConfigUsuario>(CONFIG_VACIO);
  const [email, setEmail] = useState('');
  const [emailGuardado, setEmailGuardado] = useState('');
  const [telefonoGuardado, setTelefonoGuardado] = useState('');
  const [nombre, setNombre] = useState(user?.nombre ?? '');
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [exito, setExito] = useState('');

  const [emailVerificado, setEmailVerificado] = useState(false);
  const [telefonoVerificado, setTelefonoVerificado] = useState(false);

  const [verifCanal, setVerifCanal] = useState<CanalVerificacion | null>(null);
  const [verifFase, setVerifFase] = useState<'inicio' | 'codigo'>('inicio');
  const [verifCodigo, setVerifCodigo] = useState('');
  const [verifMensaje, setVerifMensaje] = useState('');
  const [verifError, setVerifError] = useState('');
  const [verifProcesando, setVerifProcesando] = useState(false);
  const [reenvioSegundos, setReenvioSegundos] = useState(0);

  const [pwdActual, setPwdActual] = useState('');
  const [pwdNueva, setPwdNueva] = useState('');
  const [pwdConfirm, setPwdConfirm] = useState('');
  const [guardandoPwd, setGuardandoPwd] = useState(false);
  const [errorPwd, setErrorPwd] = useState('');
  const [exitoPwd, setExitoPwd] = useState('');
  const [confirmarDesactivar, setConfirmarDesactivar] = useState(false);
  const [confirmarEliminar, setConfirmarEliminar] = useState(false);
  const [pwdPeligro, setPwdPeligro] = useState('');
  const [textoConfirmacion, setTextoConfirmacion] = useState('');
  const [procesandoCuenta, setProcesandoCuenta] = useState(false);

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
        setTelefonoGuardado(String((data as any)?.config?.telefono ?? ''));
        setNombre(String((data as any)?.perfil?.nombre ?? user?.nombre ?? ''));
        setEmailVerificado(Boolean((data as any)?.config?.email_verificado));
        setTelefonoVerificado(Boolean((data as any)?.config?.telefono_verificado));
      } else if ((data as any)?.sesion_expirada) {
        cerrarSesion('/');
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

  useEffect(() => {
    if (reenvioSegundos <= 0) return;
    const t = setTimeout(() => setReenvioSegundos((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [reenvioSegundos]);

  const mostrarExito = (msg: string) => {
    setExito(msg);
    if (exitoTimeoutRef.current) clearTimeout(exitoTimeoutRef.current);
    exitoTimeoutRef.current = setTimeout(() => setExito(''), 3500);
  };

  const marcar = (m: Partial<ConfigUsuario>) => setConfig((c) => ({ ...c, ...m }));

  const emailValido = EMAIL_RE.test(email.trim());
  const telefonoValido = validarTelefono(config.telefono);
  const sitioValido = esSitioWebValido(config.sitio_web);
  const puedeGuardar = emailValido && telefonoValido && sitioValido && !guardando;

  const emailChipVerificado = emailVerificado && email.trim().toLowerCase() === emailGuardado.toLowerCase();
  const telefonoChipVerificado = telefonoVerificado && config.telefono.trim() === telefonoGuardado.trim();

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
        setTelefonoGuardado(String((data as any).config.telefono ?? ''));
        setEmailVerificado(Boolean((data as any)?.config?.email_verificado));
        setTelefonoVerificado(Boolean((data as any)?.config?.telefono_verificado));
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

  const destinoVerificacion = (canal: CanalVerificacion): string =>
    canal === 'email' ? email.trim() : config.telefono.trim();

  const abrirVerificacion = (canal: CanalVerificacion) => {
    setVerifCanal(canal);
    setVerifFase('inicio');
    setVerifCodigo('');
    setVerifMensaje('');
    setVerifError('');
    setReenvioSegundos(0);
  };

  const cerrarVerificacion = () => {
    setVerifCanal(null);
    setVerifFase('inicio');
    setVerifCodigo('');
    setVerifMensaje('');
    setVerifError('');
    setReenvioSegundos(0);
  };

  const solicitarVerificacion = async (canal: CanalVerificacion) => {
    const destino = destinoVerificacion(canal);
    setVerifProcesando(true);
    setVerifError('');
    try {
      const { ok, data } = await apiFetch('/Apis/ActualizarConfigUsuario', {
        method: 'POST',
        body: JSON.stringify({ accion: 'solicitar_verificacion', canal, destino }),
      }, 10000);
      if (!ok) {
        setVerifError((data as any)?.error || 'No se pudo enviar el código.');
        return;
      }
      if ((data as any)?.ya_verificado) {
        if (canal === 'email') setEmailVerificado(true);
        else setTelefonoVerificado(true);
        setVerifMensaje('Este contacto ya está verificado.');
        setVerifFase('inicio');
        setReenvioSegundos(0);
        return;
      }
      setVerifFase('codigo');
      setReenvioSegundos(120);
      let mensaje = String((data as any)?.mensaje ?? 'Te enviamos un código.');
      if ((data as any)?.dev_code) {
        const dev = String((data as any).dev_code);
        mensaje += ` Código de desarrollo: ${dev}`;
        setVerifCodigo(dev);
      }
      setVerifMensaje(mensaje);
    } catch {
      setVerifError('No se pudo enviar el código. Intentá de nuevo.');
    } finally {
      setVerifProcesando(false);
    }
  };

  const confirmarVerificacion = async (canal: CanalVerificacion) => {
    const destino = destinoVerificacion(canal);
    setVerifProcesando(true);
    setVerifError('');
    try {
      const { ok, data } = await apiFetch('/Apis/ActualizarConfigUsuario', {
        method: 'POST',
        body: JSON.stringify({ accion: 'verificar_contacto', canal, destino, codigo: verifCodigo.trim() }),
      }, 10000);
      if (!ok) {
        setVerifError((data as any)?.error || 'No se pudo verificar el código.');
        return;
      }
      if (canal === 'email') setEmailVerificado(true);
      else setTelefonoVerificado(true);
      cerrarVerificacion();
      mostrarExito(canal === 'email' ? 'Email verificado.' : 'Teléfono verificado.');
    } catch {
      setVerifError('No se pudo verificar. Intentá de nuevo.');
    } finally {
      setVerifProcesando(false);
    }
  };

  const desactivarCuenta = async () => {
    setProcesandoCuenta(true);
    setErrorPwd('');
    try {
      const { ok, data } = await apiFetch('/Apis/ActualizarConfigUsuario', {
        method: 'POST',
        body: JSON.stringify({ accion: 'desactivar_cuenta' }),
      }, 10000);
      if (!ok) {
        setErrorPwd((data as any)?.error || 'No se pudo desactivar la cuenta.');
        return;
      }
      cerrarSesion('/');
    } catch {
      setErrorPwd('No se pudo desactivar la cuenta.');
    } finally {
      setProcesandoCuenta(false);
    }
  };

  const eliminarCuenta = async () => {
    setProcesandoCuenta(true);
    setErrorPwd('');
    try {
      const { ok, data } = await apiFetch('/Apis/ActualizarConfigUsuario', {
        method: 'POST',
        body: JSON.stringify({ accion: 'eliminar_cuenta', passwordActual: pwdPeligro }),
      }, 15000);
      if (!ok) {
        setErrorPwd((data as any)?.error || 'No se pudo eliminar la cuenta.');
        return;
      }
      cerrarSesion('/');
    } catch {
      setErrorPwd('No se pudo eliminar la cuenta.');
    } finally {
      setProcesandoCuenta(false);
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
      <header className="configuracion__cabecera">
        <h1 className="configuracion__titulo">Configuración</h1>
        {exito && (
          <span className="configuracion__aviso-exito" role="status">
            <Check /> {exito}
          </span>
        )}
      </header>

      {error && (
        <div className="configuracion__error" role="alert">
          {error}
        </div>
      )}

      <div className="configuracion__cuerpo">
        <nav className="configuracion__menu" aria-label="Secciones de configuración">
          {PESTAÑAS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPestaña(p.id)}
              aria-current={pestaña === p.id ? 'page' : undefined}
              className={`configuracion__menu-item${pestaña === p.id ? ' configuracion__menu-item--activo' : ''}`}
            >
              {p.label}
            </button>
          ))}
        </nav>

        <div className="configuracion__contenido">
          {pestaña === 'datos' && (
            <section className="datos-personales" aria-labelledby="datos-personales-titulo">
              <h2 className="datos-personales__titulo" id="datos-personales-titulo">Mis Datos Personales</h2>

              <div className="datos-personales__cuerpo">
                <div className="datos-personales__avatar-zona">
                  <div className="datos-personales__avatar-contenedor">
                    {config.avatar ? (
                      <img src={config.avatar} alt="Foto de perfil" className="datos-personales__avatar" />
                    ) : (
                      <div className="datos-personales__avatar-iniciales">
                        {(nombre || user?.nombre || 'U').trim().charAt(0).toUpperCase()}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => inputArchivoRef.current?.click()}
                      className="datos-personales__avatar-boton"
                      aria-label="Cambiar foto de perfil"
                      title="Cambiar foto"
                    >
                      <Camera />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => inputArchivoRef.current?.click()}
                    className="datos-personales__avatar-accion"
                  >
                    Subir nueva foto
                  </button>
                  {config.avatar && (
                    <button
                      type="button"
                      onClick={() => marcar({ avatar: '' })}
                      className="datos-personales__avatar-accion datos-personales__avatar-accion--quitar"
                    >
                      <Trash2 /> Eliminar foto
                    </button>
                  )}
                  <input
                    ref={inputArchivoRef}
                    type="file"
                    accept="image/*"
                    className="datos-personales__entrada-archivo"
                    onChange={(e) => {
                      seleccionarArchivo(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </div>

                <div className="datos-personales__campos">
                  <div className="datos-personales__campo">
                    <label className="datos-personales__etiqueta" htmlFor="config-email">Dirección de correo:</label>
                    <div className="datos-personales__campo-icono">
                      <Mail className="datos-personales__icono" />
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
                    {emailValido && (
                      emailChipVerificado ? (
                        <span className="datos-personales__estado">
                          <Check /> Verificado
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="datos-personales__verificar"
                          onClick={() => abrirVerificacion('email')}
                        >
                          Verificar
                        </button>
                      )
                    )}
                  </div>

                  <div className="datos-personales__campo">
                    <label className="datos-personales__etiqueta" htmlFor="config-telefono">Número de teléfono:</label>
                    <div className="datos-personales__campo-icono">
                      <Phone className="datos-personales__icono" />
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
                      <p className="configuracion__ayuda-error">Usá solo números, espacios y + ( ) -</p>
                    )}
                    {telefonoValido && config.telefono && (
                      telefonoChipVerificado ? (
                        <span className="datos-personales__estado">
                          <Check /> Verificado
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="datos-personales__verificar"
                          onClick={() => abrirVerificacion('telefono')}
                        >
                          Verificar
                        </button>
                      )
                    )}
                  </div>
                </div>

                <aside className="tarjeta-verificacion" aria-live="polite">
                  <p className="tarjeta-verificacion__titulo">Verificación de contacto</p>

                  {verifCanal === null ? (
                    <>
                      <p className="tarjeta-verificacion__texto">
                        Confirmá que tu email y tu teléfono son tuyos. Te enviaremos un código de 6 dígitos.
                      </p>
                      <div className="tarjeta-verificacion__acciones">
                        {!emailVerificado && (
                          <button
                            type="button"
                            className="tarjeta-verificacion__boton"
                            disabled={!emailValido || verifProcesando}
                            onClick={() => abrirVerificacion('email')}
                          >
                            Verificar email
                          </button>
                        )}
                        {!telefonoVerificado && (
                          <button
                            type="button"
                            className="tarjeta-verificacion__boton"
                            disabled={!telefonoValido || !config.telefono || verifProcesando}
                            onClick={() => abrirVerificacion('telefono')}
                          >
                            Verificar teléfono
                          </button>
                        )}
                        {emailChipVerificado && telefonoChipVerificado && (
                          <p className="tarjeta-verificacion__texto tarjeta-verificacion__texto--ok">
                            <Check /> Todo tu contacto está verificado.
                          </p>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="tarjeta-verificacion__texto">
                        {verifFase === 'inicio'
                          ? `Vamos a enviar un código de 6 dígitos a ${destinoVerificacion(verifCanal) || 'tu contacto'}.`
                          : verifMensaje || `Ingresá el código que enviamos a ${destinoVerificacion(verifCanal)}.`}
                      </p>
                      {verifFase === 'codigo' && (
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={verifCodigo}
                          onChange={(e) => setVerifCodigo(e.target.value.replace(/\D/g, ''))}
                          placeholder="Código de 6 dígitos"
                          aria-label="Código de verificación"
                          className="configuracion__entrada tarjeta-verificacion__entrada"
                        />
                      )}
                      {verifError && <p className="tarjeta-verificacion__error" role="alert">{verifError}</p>}
                      <div className="tarjeta-verificacion__acciones">
                        {verifFase === 'inicio' ? (
                          <button
                            type="button"
                            className="tarjeta-verificacion__boton"
                            disabled={verifProcesando}
                            onClick={() => solicitarVerificacion(verifCanal)}
                          >
                            {verifProcesando ? 'Enviando…' : 'Solicitar código'}
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="tarjeta-verificacion__boton"
                              disabled={verifProcesando || verifCodigo.trim().length !== 6}
                              onClick={() => confirmarVerificacion(verifCanal)}
                            >
                              {verifProcesando ? 'Verificando…' : 'Verificar código'}
                            </button>
                            <button
                              type="button"
                              className="tarjeta-verificacion__boton tarjeta-verificacion__boton--secundario"
                              disabled={verifProcesando || reenvioSegundos > 0}
                              onClick={() => solicitarVerificacion(verifCanal)}
                            >
                              {reenvioSegundos > 0
                                ? `Reenviar en ${formatoReloj(reenvioSegundos)}`
                                : 'Reenviar código'}
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          className="tarjeta-verificacion__boton tarjeta-verificacion__boton--secundario"
                          onClick={cerrarVerificacion}
                        >
                          Cerrar
                        </button>
                      </div>
                    </>
                  )}
                </aside>
              </div>

              <div className="datos-personales__preferencias">
                <div>
                  <p className="datos-personales__preferencia-titulo">Moneda predeterminada</p>
                  <p className="datos-personales__preferencia-descripcion">
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

              <div className="tarjeta-perfil-zona">
                <p className="tarjeta-perfil-zona__titulo">Así te ve un visitante</p>
                <div className="tarjeta-perfil">
                  <span className="tarjeta-perfil__ajustes" aria-hidden>
                    <Settings />
                  </span>
                  <div className="tarjeta-perfil__identidad">
                    {config.avatar ? (
                      <img src={config.avatar} alt="Foto de perfil" className="tarjeta-perfil__avatar" />
                    ) : (
                      <div className="tarjeta-perfil__avatar tarjeta-perfil__avatar--iniciales">
                        {(nombre || 'U').trim().charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="tarjeta-perfil__datos">
                      <p className="tarjeta-perfil__nombre">{nombre || user?.nombre || 'Usuario'}</p>
                      {config.mostrar_contacto && email && (
                        <p className="tarjeta-perfil__linea">Dirección de correo: {email}</p>
                      )}
                      {config.mostrar_contacto && config.telefono && (
                        <p className="tarjeta-perfil__linea">Número de teléfono: {config.telefono}</p>
                      )}
                    </div>
                  </div>
                  <div className="tarjeta-perfil__redes">
                    {limpiarInstagram(config.instagram) && config.instagram_publico && (
                      <a
                        href={instagramUrl(limpiarInstagram(config.instagram))}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="tarjeta-perfil__red tarjeta-perfil__red--instagram"
                        aria-label="Instagram"
                        title="Instagram"
                      >
                        <InstagramIcon className="tarjeta-perfil__red-icono" />
                      </a>
                    )}
                    {limpiarTwitter(config.twitter) && config.twitter_publico && (
                      <a
                        href={twitterUrl(limpiarTwitter(config.twitter))}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="tarjeta-perfil__red tarjeta-perfil__red--x"
                        aria-label="X (Twitter)"
                        title="X (Twitter)"
                      >
                        <XIcon className="tarjeta-perfil__red-icono" />
                      </a>
                    )}
                    {limpiarLinkedin(config.linkedin) && config.linkedin_publico && (
                      <a
                        href={linkedinUrl(limpiarLinkedin(config.linkedin))}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="tarjeta-perfil__red tarjeta-perfil__red--linkedin"
                        aria-label="LinkedIn"
                        title="LinkedIn"
                      >
                        <LinkedinIcon className="tarjeta-perfil__red-icono" />
                      </a>
                    )}
                    {limpiarFacebook(config.facebook) && config.facebook_publico && (
                      <a
                        href={facebookUrl(limpiarFacebook(config.facebook))}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="tarjeta-perfil__red tarjeta-perfil__red--facebook"
                        aria-label="Facebook"
                        title="Facebook"
                      >
                        <FacebookIcon className="tarjeta-perfil__red-icono" />
                      </a>
                    )}
                    {config.sitio_web && sitioValido && config.sitio_publico && (
                      <a
                        href={normalizarSitioWeb(config.sitio_web)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="tarjeta-perfil__red tarjeta-perfil__red--web"
                        aria-label="Sitio web"
                        title="Sitio web"
                      >
                        <Globe className="tarjeta-perfil__red-icono" />
                      </a>
                    )}
                    {!config.perfil_publico && (
                      <span className="tarjeta-perfil__privado">Perfil privado</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="configuracion__pie">
                <Button type="button" onClick={guardarGeneral} disabled={!puedeGuardar} isLoading={guardando}>
                  Guardar Cambios
                </Button>
              </div>
            </section>
          )}

          {pestaña === 'redes' && (
            <section className="redes" aria-labelledby="redes-titulo">
              <h2 className="redes__titulo" id="redes-titulo">Redes y Enlaces</h2>

              <div className="redes__lista">
                <div className="redes__fila">
                  <div className="redes__icono-zona">
                    <InstagramIcon className="redes__icono" />
                  </div>
                  <div className="redes__campo">
                    <label className="configuracion__etiqueta" htmlFor="config-instagram" hidden>Instagram</label>
                    <input
                      id="config-instagram"
                      type="text"
                      value={config.instagram}
                      onChange={(e) => marcar({ instagram: e.target.value })}
                      placeholder="@usuario o instagram.com/usuario"
                      className="configuracion__entrada"
                    />
                    {limpiarInstagram(config.instagram) && (
                      <a
                        href={instagramUrl(limpiarInstagram(config.instagram))}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="redes__enlace"
                      >
                        Ver perfil
                      </a>
                    )}
                  </div>
                  <SegmentadoVisibilidad
                    etiqueta="Visibilidad de Instagram"
                    publico={config.instagram_publico}
                    onCambiar={(publico) => marcar({ instagram_publico: publico })}
                  />
                </div>

                <div className="redes__fila">
                  <div className="redes__icono-zona">
                    <XIcon className="redes__icono" />
                  </div>
                  <div className="redes__campo">
                    <label className="configuracion__etiqueta" htmlFor="config-twitter" hidden>X (Twitter)</label>
                    <input
                      id="config-twitter"
                      type="text"
                      value={config.twitter}
                      onChange={(e) => marcar({ twitter: e.target.value })}
                      placeholder="@usuario o x.com/usuario"
                      className="configuracion__entrada"
                    />
                    {limpiarTwitter(config.twitter) && (
                      <a
                        href={twitterUrl(limpiarTwitter(config.twitter))}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="redes__enlace"
                      >
                        Ver perfil
                      </a>
                    )}
                  </div>
                  <SegmentadoVisibilidad
                    etiqueta="Visibilidad de X (Twitter)"
                    publico={config.twitter_publico}
                    onCambiar={(publico) => marcar({ twitter_publico: publico })}
                  />
                </div>

                <div className="redes__fila">
                  <div className="redes__icono-zona">
                    <LinkedinIcon className="redes__icono" />
                  </div>
                  <div className="redes__campo">
                    <label className="configuracion__etiqueta" htmlFor="config-linkedin" hidden>LinkedIn</label>
                    <input
                      id="config-linkedin"
                      type="text"
                      value={config.linkedin}
                      onChange={(e) => marcar({ linkedin: e.target.value })}
                      placeholder="usuario o linkedin.com/in/usuario"
                      className="configuracion__entrada"
                    />
                    {limpiarLinkedin(config.linkedin) && (
                      <a
                        href={linkedinUrl(limpiarLinkedin(config.linkedin))}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="redes__enlace"
                      >
                        Ver perfil
                      </a>
                    )}
                  </div>
                  <SegmentadoVisibilidad
                    etiqueta="Visibilidad de LinkedIn"
                    publico={config.linkedin_publico}
                    onCambiar={(publico) => marcar({ linkedin_publico: publico })}
                  />
                </div>

                <div className="redes__fila">
                  <div className="redes__icono-zona">
                    <FacebookIcon className="redes__icono" />
                  </div>
                  <div className="redes__campo">
                    <label className="configuracion__etiqueta" htmlFor="config-facebook" hidden>Facebook</label>
                    <input
                      id="config-facebook"
                      type="text"
                      value={config.facebook}
                      onChange={(e) => marcar({ facebook: e.target.value })}
                      placeholder="usuario o facebook.com/usuario"
                      className="configuracion__entrada"
                    />
                    {limpiarFacebook(config.facebook) && (
                      <a
                        href={facebookUrl(limpiarFacebook(config.facebook))}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="redes__enlace"
                      >
                        Ver perfil
                      </a>
                    )}
                  </div>
                  <SegmentadoVisibilidad
                    etiqueta="Visibilidad de Facebook"
                    publico={config.facebook_publico}
                    onCambiar={(publico) => marcar({ facebook_publico: publico })}
                  />
                </div>

                <div className="redes__fila">
                  <div className="redes__icono-zona">
                    <Globe className="redes__icono" />
                  </div>
                  <div className="redes__campo">
                    <label className="configuracion__etiqueta" htmlFor="config-sitio-web" hidden>Sitio web</label>
                    <input
                      id="config-sitio-web"
                      type="url"
                      value={config.sitio_web}
                      onChange={(e) => marcar({ sitio_web: e.target.value })}
                      placeholder="tusitio.com"
                      className={`configuracion__entrada${
                        config.sitio_web && !sitioValido ? ' configuracion__entrada--invalida' : ''
                      }`}
                    />
                    {config.sitio_web && sitioValido && (
                      <a
                        href={normalizarSitioWeb(config.sitio_web)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="redes__enlace"
                      >
                        Visitar
                      </a>
                    )}
                    {config.sitio_web && !sitioValido && (
                      <p className="configuracion__ayuda-error">Ingresá una URL válida.</p>
                    )}
                  </div>
                  <SegmentadoVisibilidad
                    etiqueta="Visibilidad del sitio web"
                    publico={config.sitio_publico}
                    onCambiar={(publico) => marcar({ sitio_publico: publico })}
                  />
                </div>
              </div>

              <div className="configuracion__pie">
                <Button type="button" onClick={guardarGeneral} disabled={!puedeGuardar} isLoading={guardando}>
                  Guardar Cambios
                </Button>
              </div>
            </section>
          )}

          {pestaña === 'privacidad' && (
            <section className="privacidad" aria-labelledby="privacidad-titulo">
              <h2 className="privacidad__titulo" id="privacidad-titulo">Privacidad</h2>

              <div className="privacidad__lista">
                <div className="privacidad__grupo">
                  <h3 className="privacidad__titulo-grupo">Visibilidad del perfil</h3>
                  <SegmentadoVisibilidad
                    etiqueta="Visibilidad del perfil"
                    publico={config.perfil_publico}
                    onCambiar={(publico) => marcar({ perfil_publico: publico })}
                  />
                  <p className="privacidad__descripcion">
                    Si tu cuenta es privada, solo vos podrás ver tu perfil y tus tasaciones.
                  </p>
                </div>

                <div className={`privacidad__grupo${config.perfil_publico ? '' : ' privacidad__grupo--deshabilitado'}`}>
                  <h3 className="privacidad__titulo-grupo">Visibilidad de estadísticas</h3>
                  <SegmentadoVisibilidad
                    etiqueta="Visibilidad de estadísticas"
                    publico={config.perfil_publico && config.visibilidad_estadisticas}
                    deshabilitado={!config.perfil_publico}
                    onCambiar={(publico) => marcar({ visibilidad_estadisticas: publico })}
                  />
                  <p className="privacidad__descripcion">
                    Mostrar tus métricas de tasaciones en tu perfil público.
                  </p>
                </div>

                <div className={`privacidad__grupo${config.perfil_publico ? '' : ' privacidad__grupo--deshabilitado'}`}>
                  <h3 className="privacidad__titulo-grupo">Datos de contacto</h3>
                  <SegmentadoVisibilidad
                    etiqueta="Datos de contacto"
                    publico={config.perfil_publico && config.mostrar_contacto}
                    deshabilitado={!config.perfil_publico}
                    onCambiar={(publico) => marcar({ mostrar_contacto: publico })}
                  />
                  <p className="privacidad__descripcion">
                    Mostrar tu email y teléfono en el perfil público.
                  </p>
                </div>
              </div>

              <div className="configuracion__pie">
                <Button type="button" onClick={guardarGeneral} disabled={!puedeGuardar} isLoading={guardando}>
                  Guardar Cambios
                </Button>
              </div>
            </section>
          )}

          {pestaña === 'seguridad' && (
            <section className="seguridad" aria-labelledby="seguridad-titulo">
              <h2 className="seguridad__titulo" id="seguridad-titulo">Cambio de contraseña</h2>

              <div className="seguridad__lista">
                <div className="seguridad__campo">
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

                <div className="seguridad__campo">
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

                <div className="seguridad__campo">
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
                  <p className="configuracion__aviso-exito">
                    <Check /> {exitoPwd}
                  </p>
                )}
              </div>

              <div className="configuracion__pie">
                <Button type="button" onClick={cambiarPassword} disabled={!puedeCambiarPwd} isLoading={guardandoPwd}>
                  Cambiar contraseña
                </Button>
              </div>

              <div className="configuracion__zona-peligro">
                <p className="configuracion__peligro-titulo">Zona de peligro</p>
                <p className="configuracion__peligro-descripcion">
                  Estas acciones afectan permanentemente tu cuenta. Revéalas con cuidado.
                </p>
                <div className="configuracion__peligro-acciones">
                  <button
                    type="button"
                    onClick={() => setConfirmarDesactivar(true)}
                    className="configuracion__boton-peligro"
                  >
                    Desactivar mi cuenta
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmarEliminar(true)}
                    className="configuracion__boton-peligro configuracion__boton-peligro--critico"
                  >
                    Eliminar cuenta definitivamente
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>

      {confirmarDesactivar && (
        <div className="configuracion__modal-fondo" role="dialog" aria-modal="true" aria-label="Desactivar cuenta">
          <div className="configuracion__modal">
            <p className="configuracion__modal-titulo">¿Desactivar tu cuenta?</p>
            <p className="configuracion__modal-texto">
              Tu perfil dejará de ser visible y no podrás iniciar sesión. Tus datos se conservan y se pueden
              restaurar pidiendo soporte.
            </p>
            <div className="configuracion__modal-acciones">
              <button type="button" className="configuracion__modal-cancelar" onClick={() => setConfirmarDesactivar(false)}>
                Cancelar
              </button>
              <button type="button" className="configuracion__boton-peligro" onClick={desactivarCuenta} disabled={procesandoCuenta}>
                {procesandoCuenta ? 'Desactivando…' : 'Sí, desactivar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmarEliminar && (
        <div className="configuracion__modal-fondo" role="dialog" aria-modal="true" aria-label="Eliminar cuenta">
          <div className="configuracion__modal">
            <p className="configuracion__modal-titulo">¿Eliminar tu cuenta definitivamente?</p>
            <p className="configuracion__modal-texto">
              Se borran tu perfil, tu configuración y todas tus tasaciones. Esta acción no se puede deshacer.
              Escribí <strong>ELIMINAR</strong> y confirmá con tu contraseña.
            </p>
            <input
              type="text"
              value={textoConfirmacion}
              onChange={(e) => setTextoConfirmacion(e.target.value)}
              placeholder="Escribí ELIMINAR"
              className="configuracion__entrada"
            />
            <input
              type="password"
              value={pwdPeligro}
              onChange={(e) => setPwdPeligro(e.target.value)}
              placeholder="Contraseña actual"
              autoComplete="current-password"
              className="configuracion__entrada configuracion__modal-espacio"
            />
            <div className="configuracion__modal-acciones">
              <button type="button" className="configuracion__modal-cancelar" onClick={() => { setConfirmarEliminar(false); setTextoConfirmacion(''); setPwdPeligro(''); }}>
                Cancelar
              </button>
              <button
                type="button"
                className="configuracion__boton-peligro configuracion__boton-peligro--critico"
                onClick={eliminarCuenta}
                disabled={procesandoCuenta || textoConfirmacion !== 'ELIMINAR' || pwdPeligro.length === 0}
              >
                {procesandoCuenta ? 'Eliminando…' : 'Eliminar para siempre'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
